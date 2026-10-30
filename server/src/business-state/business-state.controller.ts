import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EventService } from '../event/event.service';
import { journalFinanceProjection } from '../finance/journal-finance-projection';
import { NoteService } from '../note/note.service';
import { NotificationEventService } from '../notification/notification-event.service';
import { PrismaService } from '../prisma.service';
import { ProfileService } from '../profile/profile.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { BusinessStateService } from './business-state.service';

type JsonObject = Record<string, any>;
type AuthenticatedRequest = Request & { auth?: { platformAccountId: string; tenantId: string; role: string } };

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function scheduleChanged(leftValue: unknown, rightValue: unknown) {
  const left = objectValue(leftValue);
  const right = objectValue(rightValue);
  return text(left.date).slice(0, 10) !== text(right.date).slice(0, 10)
    || text(left.workplaceId) !== text(right.workplaceId)
    || text(left.from) !== text(right.from)
    || text(left.to) !== text(right.to);
}

@Controller('business-state')
@UseGuards(JwtAuthGuard)
export class BusinessStateController {
  constructor(
    private readonly businessState: BusinessStateService,
    private readonly events: EventService,
    private readonly notes: NoteService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationEventService,
    private readonly profile: ProfileService,
    private readonly access: SaasAccessService,
  ) {}

  private async journalBundle(auth: AuthenticatedRequest['auth']) {
    const current = auth!;
    const [business, events, notes] = await Promise.all([
      this.businessState.get(current.tenantId),
      this.events.list(current.tenantId),
      this.notes.listProfile(current.tenantId, current.platformAccountId),
    ]);
    return { ...business, events, notes };
  }

  private async journalProfileContext(auth: AuthenticatedRequest['auth']) {
    const current = auth!;
    const read = () => this.prisma.profile.findUnique({
      where: { tenantId_platformAccountId: { tenantId: current.tenantId, platformAccountId: current.platformAccountId } },
      select: {
        name: true,
        surname: true,
        photo: true,
        photoCropX: true,
        photoCropY: true,
        workplaces: {
          where: { deletedAt: null },
          orderBy: [{ position: 'asc' as const }, { createdAt: 'asc' as const }],
          select: {
            key: true,
            name: true,
            color: true,
            city: true,
            currency: true,
            timeZone: true,
            from: true,
            to: true,
            visibleInPublicBooking: true,
          },
        },
      },
    });
    let row = await read();
    if (!row) {
      await this.profile.get(current.tenantId, current.platformAccountId);
      row = await read();
    }
    return {
      profile: {
        key: 'profile',
        name: row?.name || '',
        surname: row?.surname || '',
        photo: row?.photo || '',
        photoCropX: row?.photoCropX ?? 50,
        photoCropY: row?.photoCropY ?? 50,
      },
      workplaces: (row?.workplaces || []).map((workplace) => ({
        key: workplace.key,
        profileId: 'profile',
        name: workplace.name,
        color: workplace.color,
        city: workplace.city,
        currency: workplace.currency,
        timeZone: workplace.timeZone,
        from: workplace.from,
        to: workplace.to,
        visibleInPublicBooking: workplace.visibleInPublicBooking,
      })),
    };
  }

  private async journalOperationalContext(tenantId: string) {
    const operational = await this.businessState.getOperational(tenantId);
    return { days: Array.isArray(operational?.days) ? operational.days : [] };
  }

  private async notifyRecordEvent(tenantId: string, type: string, recordValue: unknown) {
    const record = objectValue(recordValue);
    const person = objectValue(record.person);
    if (!text(record.id) || (!text(person.phone) && !text(person.accountId) && !Array.isArray(person.accounts))) return;
    const workplaceKey = text(record.workplaceId);
    const workplace = workplaceKey
      ? await this.prisma.workplace.findUnique({ where: { tenantId_key: { tenantId, key: workplaceKey } } }).catch(() => null)
      : null;
    await this.notifications.createEventForPerson(tenantId, person, {
      type,
      entityType: 'record',
      entityId: text(record.id),
      context: {
        date: text(record.date).slice(0, 10),
        time: text(record.from),
        workplace: text(workplace?.name) || workplaceKey,
        record: { id: text(record.id) },
      },
    });
  }

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.businessState.get(request.auth!.tenantId);
  }

  @Get('journal')
  journal(@Req() request: AuthenticatedRequest) {
    return this.journalBundle(request.auth);
  }

  @Get('journal-bootstrap')
  async journalBootstrap(@Req() request: AuthenticatedRequest) {
    const auth = request.auth!;
    const [journal, profileContext, operationalContext, finance, access] = await Promise.all([
      this.journalBundle(auth),
      this.journalProfileContext(auth),
      this.journalOperationalContext(auth.tenantId),
      journalFinanceProjection(this.prisma, auth.tenantId),
      this.access.resolveTenantAccess(auth.tenantId),
    ]);
    return { journal, profileContext, operationalContext, finance, access };
  }

  @Get('records')
  async records(@Req() request: AuthenticatedRequest) {
    const tenantId = request.auth!.tenantId;
    const [records, recordEvents] = await Promise.all([
      this.prisma.record.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.recordEvent.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      records: records.map((row) => objectValue(row.data)),
      recordEvents: recordEvents.map((row) => objectValue(row.data)),
    };
  }

  @Put('people/:key')
  upsertPerson(@Req() request: AuthenticatedRequest, @Param('key') key: string, @Body() body: unknown) {
    return this.businessState.upsertPerson(request.auth!.tenantId, key, body);
  }

  @Delete('people/:key')
  deletePerson(@Req() request: AuthenticatedRequest, @Param('key') key: string) {
    return this.businessState.deletePerson(request.auth!.tenantId, key);
  }

  @Put('uei')
  updateUEI(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.businessState.updateUEI(request.auth!.tenantId, body);
  }

  @Put('records/:recordId')
  async upsertRecord(@Req() request: AuthenticatedRequest, @Param('recordId') recordId: string, @Body() body: unknown) {
    const tenantId = request.auth!.tenantId;
    const existing = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId } } });
    const saved = await this.businessState.upsertRecord(tenantId, recordId, body);
    const eventType = !existing
      ? 'booking.created'
      : scheduleChanged(existing.data, saved) ? 'booking.rescheduled' : '';
    if (eventType) {
      await this.notifyRecordEvent(tenantId, eventType, saved).catch(() => null);
    }
    return saved;
  }

  @Delete('records/:recordId')
  async deleteRecord(@Req() request: AuthenticatedRequest, @Param('recordId') recordId: string) {
    const tenantId = request.auth!.tenantId;
    const existing = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId } } });
    const result = await this.businessState.deleteRecord(tenantId, recordId);
    if (existing) await this.notifyRecordEvent(tenantId, 'booking.deleted', existing.data).catch(() => null);
    return result;
  }

  @Delete('records/:recordId/events')
  deleteRecordEvents(@Req() request: AuthenticatedRequest, @Param('recordId') recordId: string) {
    return this.businessState.deleteRecordEvents(request.auth!.tenantId, recordId);
  }

  @Put('record-events/:eventId')
  async upsertRecordEvent(@Req() request: AuthenticatedRequest, @Param('eventId') eventId: string, @Body() body: unknown) {
    const tenantId = request.auth!.tenantId;
    const existed = await this.prisma.recordEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId } } });
    const saved = await this.businessState.upsertRecordEvent(tenantId, eventId, body);
    const eventType = text(objectValue(saved).type);
    const notificationType = eventType === 'cancelled'
      ? 'booking.cancelled'
      : eventType === 'confirmed'
        ? 'booking.confirmed'
        : eventType === 'no-show'
          ? 'booking.no-show'
          : '';
    if (!existed && notificationType) {
      const recordId = text(objectValue(saved).recordId);
      const record = recordId
        ? await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId } } })
        : null;
      if (record) await this.notifyRecordEvent(tenantId, notificationType, record.data).catch(() => null);
    }
    return saved;
  }

  @Get('operational')
  operational(@Req() request: AuthenticatedRequest) {
    return this.businessState.getOperational(request.auth!.tenantId);
  }

  @Put('operational/:dataset')
  updateOperational(@Req() request: AuthenticatedRequest, @Param('dataset') dataset: string, @Body() body: unknown) {
    return this.businessState.updateOperationalDataset(request.auth!.tenantId, dataset, body);
  }
}