import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { NotificationEventService } from '../notification/notification-event.service';
import { PersonIdentityService } from '../online-booking/person-identity.service';
import { PrismaService } from '../prisma.service';
import { RecordService } from '../record/record.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { TimeService } from '../time/time.service';
import { AccountRecordService } from './account-record.service';

function text(value: unknown) {
  return String(value ?? '').trim();
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function priceNumber(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function hasPriceValue(value: unknown) {
  return value !== '' && value != null;
}

function procedurePrice(procedure: Record<string, any>, assignment: Record<string, any>) {
  const assigned = assignment?.cost;
  const base = procedure?.cost;
  const hasAssigned = assigned && typeof assigned === 'object' && !assigned.free && (
    hasPriceValue(assigned.amount)
    || hasPriceValue(assigned.from)
    || hasPriceValue(assigned.to)
  );
  const cost = hasAssigned ? assigned : base;
  if (cost == null || cost?.free) return { minimum: 0, variable: false, free: true };
  if (typeof cost === 'number' || typeof cost === 'string') {
    return { minimum: priceNumber(cost), variable: false, free: false };
  }
  if (hasPriceValue(cost.amount)) {
    return { minimum: priceNumber(cost.amount), variable: false, free: false };
  }
  if (hasPriceValue(cost.from)) {
    return { minimum: priceNumber(cost.from), variable: true, free: false };
  }
  return { minimum: 0, variable: hasPriceValue(cost.to), free: false };
}

@Injectable()
export class AccountContactRecordService {
  constructor(
    private readonly accountRecords: AccountRecordService,
    private readonly notificationEvents: NotificationEventService,
    private readonly prisma: PrismaService,
    private readonly records: RecordService,
    private readonly time: TimeService,
    private readonly access: SaasAccessService,
    private readonly personIdentity: PersonIdentityService,
  ) {}

  async context(tenantId: string, accountId: string, workplace = '') {
    await this.access.assertRealOperationsAllowed(tenantId);
    if (!(await this.accountRecords.canRecord(tenantId, accountId))) {
      throw new ForbiddenException('Запись недоступна');
    }

    const [sourceWorkplaces, operationalRow, recordOccupancy, eventOccupancy] = await Promise.all([
      this.prisma.workplace.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          key: true,
          name: true,
          city: true,
          address: true,
          timeZone: true,
          from: true,
          to: true,
          visibleInPublicBooking: true,
        },
      }),
      this.prisma.businessOperationalState.findUnique({ where: { tenantId } }),
      this.records.publicOccupancy(tenantId),
      this.prisma.event.findMany({
        where: { tenantId },
        select: { id: true, workplaceId: true, date: true, from: true, to: true },
      }),
    ]);

    const requestedWorkplace = text(workplace);
    const selected = requestedWorkplace
      ? sourceWorkplaces.find((item) => text(item.key) === requestedWorkplace)
      : null;
    if (requestedWorkplace && !selected) throw new BadRequestException('Рабочее пространство не найдено');

    const generalWorkplaces = sourceWorkplaces.filter((item) => item.visibleInPublicBooking !== false);
    const workplaces = selected ? [selected] : generalWorkplaces;
    const allowedKeys = new Set(workplaces.map((item) => text(item.key)).filter(Boolean));
    const operational = objectValue(operationalRow?.data);

    const procedures = arrayValue(operational.procedures).flatMap((rawProcedure) => {
      const procedure = objectValue(rawProcedure);
      const assignments = arrayValue(procedure.workplaces)
        .map((rawAssignment) => objectValue(rawAssignment))
        .filter((assignment) => allowedKeys.has(text(assignment.workplaceId ?? assignment.key ?? assignment.id)))
        .map((assignment) => {
          const workplaceId = text(assignment.workplaceId ?? assignment.key ?? assignment.id);
          return { workplaceId, price: procedurePrice(procedure, assignment) };
        });
      if (!assignments.length) return [];
      return [{
        id: text(procedure.id),
        name: text(procedure.name),
        duration: Math.max(0, Number(procedure.duration) || 0),
        workplaces: assignments,
      }];
    });

    const days = arrayValue(operational.days)
      .filter((day) => allowedKeys.has(text(day?.workplaceId)))
      .map((day) => ({
        workplaceId: text(day?.workplaceId),
        date: text(day?.date).slice(0, 10),
        from: text(day?.from),
        to: text(day?.to),
      }));

    const breaks = arrayValue(operational.breaks)
      .filter((item) => allowedKeys.has(text(item?.workplaceId)))
      .map((item) => ({
        id: text(item?.id),
        type: 'break',
        workplaceId: text(item?.workplaceId),
        date: text(item?.date).slice(0, 10),
        from: text(item?.from),
        to: text(item?.to),
      }));

    const events = eventOccupancy
      .filter((item) => allowedKeys.has(text(item.workplaceId)))
      .map((item) => ({
        id: text(item.id),
        type: 'event',
        workplaceId: text(item.workplaceId),
        date: text(item.date).slice(0, 10),
        from: text(item.from),
        to: text(item.to),
      }));

    return {
      workplaces: workplaces.map((item) => ({
        key: text(item.key),
        name: text(item.name),
        city: text(item.city),
        address: text(item.address),
        timeZone: text(item.timeZone),
        from: text(item.from),
        to: text(item.to),
      })),
      procedures,
      days,
      occupancy: [
        ...recordOccupancy.filter((item) => allowedKeys.has(text(item?.workplaceId))),
        ...events,
        ...breaks,
      ],
      settings: {
        slotStep: Math.max(0, Number(objectValue(operational.bookingSettings).slotStep) || 0),
      },
    };
  }

  async create(tenantId: string, accountId: string, body: Record<string, any>) {
    await this.access.assertRealOperationsAllowed(tenantId);
    if (!(await this.accountRecords.canRecord(tenantId, accountId))) {
      throw new ForbiddenException('Запись недоступна');
    }

    const workplaceKey = text(body?.workplaceKey);
    const date = text(body?.date).slice(0, 10);
    const from = text(body?.from);
    const procedureIds = [...new Set(arrayValue(body?.procedureIds).map(text).filter(Boolean))];
    if (!workplaceKey || !date || this.time.timeToMinutes(from) == null || !procedureIds.length) {
      throw new BadRequestException('Не выбраны рабочее пространство, дата, время или процедуры');
    }

    const [account, workplace] = await Promise.all([
      this.prisma.account.findUnique({ where: { id: accountId } }),
      this.prisma.workplace.findFirst({ where: { tenantId, key: workplaceKey, deletedAt: null } }),
    ]);
    if (!account) throw new UnauthorizedException('Аккаунт не найден');
    if (!workplace) throw new BadRequestException('Рабочее пространство недоступно');
    if (this.time.isPastZonedStart(date, from, workplace.timeZone)) {
      throw new ConflictException('Это время уже прошло');
    }

    const binding = await this.personIdentity.bindFirstAccess(tenantId, account as Record<string, any>);
    const person = objectValue(binding.person);
    const personSnapshot = {
      key: text(person.key),
      id: text(person.id),
      accountId: account.id,
      name: text(account.name),
      surname: text(account.surname),
      phone: text(account.phone),
      email: text(account.email),
      telegramId: text(account.telegramId),
      discountPercent: Math.max(0, Number(person.discountPercent) || 0),
    };

    const record = await this.records.create(tenantId, {
      date,
      workplaceId: workplaceKey,
      from,
      person: personSnapshot,
      procedureIds,
      source: 'account-journal',
      createdBy: { type: 'account', accountId: account.id, profileId: '' },
    });
    const recordId = text(record?.id);

    void Promise.allSettled([
      this.notificationEvents.createEventForTenantOwner(tenantId, {
        type: 'booking.created',
        entityType: 'record',
        entityId: recordId,
        context: { date, time: from, workplace: workplaceKey },
        metadata: { recordId, recordIds: recordId ? [recordId] : [], date, time: from, workplaceKey, source: 'account-journal' },
      }),
      this.notificationEvents.createEventForPerson(tenantId, { accountId }, {
        type: 'booking.created',
        entityType: 'record',
        entityId: recordId,
        context: { date, time: from, workplace: workplaceKey, record: { id: recordId } },
      }),
    ]);

    return {
      ...record,
      recordId,
      recordIds: recordId ? [recordId] : [],
    };
  }
}
