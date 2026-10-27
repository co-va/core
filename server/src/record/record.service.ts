import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { zonedDateTimeToDate } from '../../../core/time/zone.js';
import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import { resolveSelectedRecordProgramPricePercent } from '../loyalty/price-condition';
import { ProcedureService } from '../procedure/procedure.service';
import { TimeService } from '../time/time.service';

type JsonObject = Record<string, any>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function dateValue(value: unknown) {
  return text(value).slice(0, 10);
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function nullableObject(value: unknown): JsonObject | null {
  const source = objectValue(value);
  return Object.keys(source).length ? clone(source) : null;
}

function groupCapacityFromProcedures(items: JsonObject[]) {
  if (!items.length) return 1;
  const capacities = items.map((item) => {
    const enabled = item?.groupBooking?.enabled === true;
    if (!enabled) return 1;
    return Math.max(2, Math.min(999, Math.floor(Number(item?.groupBooking?.capacity) || 2)));
  });
  return capacities.every((value) => value >= 2) ? Math.min(...capacities) : 1;
}

function normalizeGroup(value: unknown, fallbackPerson: unknown, allowedCapacity: number) {
  const capacity = Math.max(1, Math.floor(Number(allowedCapacity) || 1));
  if (capacity < 2) return null;
  const source = objectValue(value);
  const participants: JsonObject[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (participants.length >= capacity) return;
    const person = objectValue(raw);
    const key = text(person.key) || text(person.id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    participants.push({
      key: text(person.key),
      id: text(person.id),
      name: text(person.name),
      surname: text(person.surname),
      phone: text(person.phone),
    });
  };
  arrayValue(source.participants).forEach(push);
  if (!participants.length) push(fallbackPerson);
  return { capacity, participants };
}

@Injectable()
export class RecordService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['BusinessRecord', 'BusinessRecordEvent', 'BookingRequest']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['BusinessRecord', 'BusinessRecordEvent', 'BookingRequest'],before,after,checkOnly); }

  constructor(
    private readonly prisma: PrismaService,
    private readonly time: TimeService,
    private readonly finance: FinanceService,
    private readonly procedures: ProcedureService,
  ) {}

  private subject(person: JsonObject) {
    return {
      personId: text(person?.id),
      personKey: text(person?.key),
      name: text(person?.name),
      surname: text(person?.surname),
    };
  }

  private appointment(record: JsonObject) {
    return {
      date: dateValue(record?.date),
      workplaceId: text(record?.workplaceId),
      from: text(record?.from),
      to: text(record?.to),
    };
  }

  private settlementSources(procedures: JsonObject[], products: JsonObject[]) {
    return [
      ...procedures.map((item) => ({ ...item, sourceType: 'procedure', sourceId: text(item?.id) })),
      ...products.map((item) => ({ ...item, sourceType: 'product', sourceId: text(item?.id) })),
    ];
  }

  private async pricePercent(tenantId: string, person: JsonObject, loyaltyProgram: unknown = null) {
    return (await resolveSelectedRecordProgramPricePercent(this.prisma, tenantId, person, loyaltyProgram)).percent;
  }

  private async validateAvailability(
    tenantId: string,
    { date, workplaceId, from, to }: { date: string; workplaceId: string; from: string; to: string },
    { excludeRecordId = '', excludeRequestId = '' } = {},
  ) {
    const operationalRow = await this.prisma.businessOperationalState.findUnique({ where: { tenantId } });
    const operational = objectValue(operationalRow?.data);
    const day = arrayValue(operational.days)
      .find((item) => text(item?.workplaceId) === workplaceId && dateValue(item?.date) === date);
    if (!day) throw new ConflictException('Эта дата больше не доступна');

    const workplace = await this.prisma.workplace.findUnique({ where: { tenantId_key: { tenantId, key: workplaceId } } });
    const planFrom = text(day?.from) || text(workplace?.from);
    const planTo = text(day?.to) || text(workplace?.to);

    const [records, events, pending] = await Promise.all([
      this.prisma.record.findMany({ where: { tenantId } }),
      this.prisma.recordEvent.findMany({ where: { tenantId } }),
      this.prisma.bookingRequest.findMany({
        where: {
          tenantId,
          workplaceKey: workplaceId,
          date,
          status: 'PENDING',
          ...(excludeRequestId ? { id: { not: excludeRequestId } } : {}),
        },
        select: { id: true, from: true, to: true },
      }),
    ]);
    const cancelled = new Set(events
      .filter((row) => text(objectValue(row.data).type) === 'cancelled')
      .map((row) => row.recordId));

    const recordUsages = records
      .map((row) => objectValue(row.data))
      .filter((record) => {
        const id = text(record?.id);
        return id
          && id !== excludeRecordId
          && !cancelled.has(id)
          && text(record?.workplaceId) === workplaceId
          && dateValue(record?.date) === date;
      })
      .map((record) => ({ id: text(record.id), from: text(record.from), to: text(record.to) }));

    const breaks = arrayValue(operational.breaks)
      .filter((item) => text(item?.workplaceId) === workplaceId && dateValue(item?.date) === date)
      .map((item) => ({ id: text(item?.id), from: text(item?.from), to: text(item?.to) }));

    const pendingUsages = pending.map((item) => ({ id: `booking-request:${item.id}`, from: item.from, to: item.to }));
    const result = this.time.checkAvailability({
      planFrom,
      planTo,
      from,
      to,
      usages: [...recordUsages, ...breaks, ...pendingUsages],
    });
    if (!result.ok) {
      if (result.reason === 'outside-working-time') throw new ConflictException('Время находится вне рабочего графика');
      throw new ConflictException('Это время уже занято');
    }
  }

  async create(tenantId: string, input: JsonObject, position?: number, { createHistory = true } = {}) {
    const id = text(input.id) || randomUUID();
    const sourceRequestId = text(input.sourceRequestId);
    if (sourceRequestId) {
      const existingRows = await this.prisma.record.findMany({ where: { tenantId } });
      const existing = existingRows.find((row) => text(objectValue(row.data).sourceRequestId) === sourceRequestId);
      if (existing) return objectValue(existing.data);
    }
    const existingId = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId: id } } });
    if (existingId) return objectValue(existingId.data);

    const date = dateValue(input.date);
    const workplaceId = text(input.workplaceId);
    const from = text(input.from);

    const requestedProcedures = arrayValue(input.procedures);
    const procedureIds = [...new Set(arrayValue(input.procedureIds).map(text).filter(Boolean).length
      ? arrayValue(input.procedureIds).map(text).filter(Boolean)
      : requestedProcedures.map((item) => text(item?.id)).filter(Boolean))];
    let procedureSnapshots = requestedProcedures.map((item) => clone(objectValue(item)));
    if (procedureIds.length) {
      const canonical = await this.procedures.snapshots(tenantId, workplaceId, procedureIds, date);
      const requestedById = new Map(requestedProcedures.map((item) => [text(item?.id), objectValue(item)]));
      procedureSnapshots = canonical.map((item) => {
        const requested = requestedById.get(item.id);
        const requestedDuration = Number(requested?.duration);
        return {
          ...item,
          duration: Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : item.duration,
        };
      });
    }

    const totalDuration = procedureSnapshots.reduce((sum, item) => sum + Math.max(0, Number(item?.duration || 0)), 0);
    const startMinutes = this.time.timeToMinutes(from);
    const derivedTo = totalDuration > 0 && startMinutes != null
      ? this.time.minutesToTime(startMinutes + totalDuration)
      : '';
    const to = derivedTo || text(input.to);
    await this.validateAvailability(tenantId, { date, workplaceId, from, to }, { excludeRequestId: sourceRequestId });

    const products = arrayValue(input.products).map((item) => clone(objectValue(item)));
    let person = clone(objectValue(input.person));
    const group = normalizeGroup(input.group, person, groupCapacityFromProcedures(procedureSnapshots));
    if (group?.participants?.length) person = clone(group.participants[0]);
    const loyaltyProgram = nullableObject(input.loyaltyProgram);
    const pricePercent = await this.pricePercent(tenantId, person, loyaltyProgram);
    const settlement = this.finance.calculateSettlement(this.settlementSources(procedureSnapshots, products), pricePercent);

    const now = new Date().toISOString();
    const createdAt = text(input.createdAt) || now;
    const actor = clone(objectValue(input.createdBy ?? input.actor));
    const record = {
      id,
      date,
      workplaceId,
      from,
      to,
      person,
      group,
      procedures: procedureSnapshots,
      products,
      loyaltyProgram,
      source: text(input.source) || 'manual',
      sourceRequestId,
      createdBy: actor,
      createdAt,
      updatedAt: text(input.updatedAt) || createdAt,
    };
    const event = {
      id: randomUUID(),
      recordId: id,
      type: 'created',
      category: 'action',
      at: createdAt,
      source: record.source,
      actor,
      subject: this.subject(person),
      payload: { appointment: this.appointment(record) },
    };

    const resolvedPosition = Number.isInteger(position)
      ? Number(position)
      : (await this.prisma.record.count({ where: { tenantId } }));
    if (createHistory) {
      await this.prisma.$transaction([
        this.prisma.record.create({ data: { tenantId, recordId: id, position: resolvedPosition, data: json(record) } }),
        this.prisma.recordEvent.create({ data: { tenantId, eventId: event.id, recordId: id, position: 0, data: json(event) } }),
      ]);
    } else {
      await this.prisma.record.create({ data: { tenantId, recordId: id, position: resolvedPosition, data: json(record) } });
    }
    await this.finance.upsertSettlement(tenantId, 'record', id, settlement);
    return record;
  }

  // Historical input stays inside the Record owner, without current availability,
  // loyalty repricing, inferred duration, booking requests or notification delivery.
  async importHistorical(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    let id = targetId || randomUUID();
    let existing = await tx.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId: id } } });
    if (targetId && !existing) throw new ConflictException('Перенесённая запись не найдена');
    if(input.appendProcedures && !existing) {
      const rows=await tx.record.findMany({where:{tenantId}});
      const matches=rows.filter(row=>{const data=objectValue(row.data);return data.person?.key===input.person?.key && dateValue(data.date)===text(input.date) && data.workplaceId===input.workplaceId && (!input.from || text(data.from)===text(input.from));});
      if(matches.length>1)throw new ConflictException('Не удалось однозначно определить запись.');
      if(matches.length===1){existing=matches[0];id=existing.recordId;}
    }
    const previous = objectValue(existing?.data);
    if (!targetId && !input.appendProcedures) {
      const rows = await tx.record.findMany({ where: { tenantId } });
      const matches = rows.map(row => objectValue(row.data)).filter(record => text(record.person?.key) === text(input.person?.key)
        && dateValue(record.date) === text(input.date) && record.workplaceId === input.workplaceId && text(record.from) === text(input.from)
        && sameJson(arrayValue(record.procedures).map(p => text(p.name)), arrayValue(input.procedures).map(p => text(p.name))));
      if (matches.length) throw new ConflictException('Запись уже существует. Укажите ID записи или ID переноса; автоматическое объединение запрещено.');
    }
    const incomingProcedures = arrayValue(input.procedures).map((raw, index): JsonObject => {
      const item = objectValue(raw);
      if (!text(item.name)) throw new ConflictException('Не указана процедура');
      return { ...item, id: text(item.id) || text(arrayValue(previous.procedures)[index]?.id) || randomUUID() };
    });
    if(input.appendProcedures && incomingProcedures.some(next=>arrayValue(previous.procedures).some(saved=>text(saved.name)===text(next.name) && saved.id!==next.id)))throw new ConflictException('В записи уже есть такая процедура. Для исправления используйте файл результата этого переноса.');
    const procedures=input.appendProcedures ? [...arrayValue(previous.procedures).filter(p=>!incomingProcedures.some(next=>next.id===p.id)),...incomingProcedures] : incomingProcedures;
    const record = { ...previous, id, date: text(input.date), workplaceId: text(input.workplaceId),
      from: input.from!==undefined?text(input.from):text(previous.from), to: input.to!==undefined?text(input.to):text(previous.to), person: clone(input.person), procedures,
      timePrecision: (input.from!==undefined?input.from:previous.from) ? 'minute' : 'date', historicalTransfer: true,
      ...(input.createdAt ? { createdAt: text(input.createdAt) } : {}),
    };
    if (input.from) {
      const workplace = await tx.workplace.findUnique({ where: { tenantId_key: { tenantId, key: text(input.workplaceId) } } });
      const occurredAt = zonedDateTimeToDate(`${input.date}T${input.from}`, workplace?.timeZone)?.toISOString();
      if (occurredAt) await tx.$queryRaw`SELECT set_config('co_va.transfer_time', ${occurredAt}, true)`;
    }
    await tx.record.upsert({ where: { tenantId_recordId: { tenantId, recordId: id } },
      create: { tenantId, recordId: id, position: await tx.record.count({ where: { tenantId } }), data: json(record) }, update: { data: json(record) } });
    await this.finance.importRecordSettlement(tenantId, id, procedures, tx);
    return id;
  }

  async resolveTransferredRecord(tenantId: string, input: JsonObject, tx: Prisma.TransactionClient) {
    const rows = await tx.record.findMany({ where: { tenantId } });
    if (text(input.recordId)) {
      const found = rows.find(row => row.recordId === text(input.recordId));
      if (!found) throw new ConflictException('Не удалось определить запись');
      const record = objectValue(found.data);
      if (input.personKey && record.person?.key !== input.personKey || input.date && dateValue(record.date) !== input.date
        || input.workplaceId && record.workplaceId !== input.workplaceId || input.from && record.from !== input.from) throw new ConflictException('Данные не совпадают с указанной записью');
      if (text(input.procedure)) this.procedures.matchTransferredProcedure(record, input.procedure);
      return record;
    }
    if (!text(input.personKey) || !text(input.date)) throw new ConflictException('Для определения записи укажите человека и дату обслуживания');
    const base = rows.map(row => objectValue(row.data)).filter(record =>
      text(record.person?.key) === text(input.personKey) && dateValue(record.date) === input.date
      && (!input.workplaceId || text(record.workplaceId) === input.workplaceId)
      && (!input.from || text(record.from) === input.from));
    const named = input.procedure ? base.filter(record => arrayValue(record.procedures).some(p => text(p.name) === text(input.procedure))) : base;
    const matches = named.length ? named : base;
    if (matches.length !== 1) throw new ConflictException('Не удалось однозначно определить запись.');
    if (text(input.procedure)) this.procedures.matchTransferredProcedure(matches[0], input.procedure);
    return matches[0];
  }

  async publicOccupancy(tenantId: string) {
    const [rows, eventRows] = await Promise.all([
      this.prisma.record.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.recordEvent.findMany({ where: { tenantId } }),
    ]);
    const cancelled = new Set(eventRows
      .filter((row) => text(objectValue(row.data).type) === 'cancelled')
      .map((row) => row.recordId));
    return rows
      .map((row) => objectValue(row.data))
      .filter((record) => {
        const id = text(record.id);
        return id && !cancelled.has(id);
      })
      .map((record) => ({
        id: text(record.id),
        type: 'record',
        workplaceId: text(record.workplaceId),
        date: dateValue(record.date),
        from: text(record.from),
        to: text(record.to),
      }))
      .filter((item) => item.workplaceId && item.date && item.from && item.to);
  }

  private projectLifecycle(record: JsonObject, events: JsonObject[]) {
    let status = 'active';
    let confirmed = false;
    let attendance = '';
    let confirmedAt = '';
    let attendanceAt = '';
    let cancelledAt = '';
    const ordered = events.slice().sort((left, right) => String(left?.at || '').localeCompare(String(right?.at || '')));
    for (const event of ordered) {
      const type = text(event?.type);
      const at = text(event?.at);
      if (type === 'confirmed') {
        confirmed = true;
        confirmedAt = at;
      } else if (type === 'unconfirmed') {
        confirmed = false;
        confirmedAt = at;
      } else if (type === 'arrived') {
        attendance = 'arrived';
        attendanceAt = at;
      } else if (type === 'no-show') {
        attendance = 'no-show';
        attendanceAt = at;
      } else if (type === 'attendance-cleared') {
        attendance = '';
        attendanceAt = at;
      } else if (type === 'cancelled') {
        status = 'cancelled';
        cancelledAt = at;
      }
    }
    return { status, confirmed, attendance, confirmedAt, attendanceAt, cancelledAt };
  }

  async listForPeople(tenantId: string, people: JsonObject[]) {
    const canonicalPhone = (value: unknown) => {
      const digits = text(value).replace(/\D/g, '');
      if (digits.length === 10) return `7${digits}`;
      if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
      return digits;
    };
    const personKeys = new Set(people.map((person) => text(person?.key)).filter(Boolean));
    const personIds = new Set(people.map((person) => text(person?.id)).filter(Boolean));
    const personPhones = new Set(people.flatMap((person) => [person?.phone, ...arrayValue(person?.phones)])
      .map(canonicalPhone).filter(Boolean));
    const personEmails = new Set(people.flatMap((person) => [person?.email, ...arrayValue(person?.emails)])
      .map((value) => text(value).toLowerCase()).filter(Boolean));
    if (!personKeys.size && !personIds.size && !personPhones.size && !personEmails.size) return [];

    const [rows, eventRows] = await Promise.all([
      this.prisma.record.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.recordEvent.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const byRecord = new Map<string, JsonObject[]>();
    for (const row of eventRows) {
      const list = byRecord.get(row.recordId) || [];
      list.push(objectValue(row.data));
      byRecord.set(row.recordId, list);
    }

    const result: JsonObject[] = [];
    for (const row of rows) {
      const record = objectValue(row.data);
      const person = objectValue(record.person);
      const directMatch = personKeys.has(text(person?.key)) || personIds.has(text(person?.id));
      const groupMatch = arrayValue(objectValue(record.group).participants)
        .map((participant) => objectValue(participant))
        .some((participant) => personKeys.has(text(participant?.key)) || personIds.has(text(participant?.id)));
      const booker = objectValue(objectValue(record.createdBy).booker);
      const bookerPhone = canonicalPhone(booker.phone);
      const bookerEmail = text(booker.email).toLowerCase();
      const bookedByMatch = (bookerPhone && personPhones.has(bookerPhone))
        || (bookerEmail && personEmails.has(bookerEmail));
      if (!directMatch && !groupMatch && !bookedByMatch) continue;
      const events = byRecord.get(text(record.id)) || [];
      const lifecycle = this.projectLifecycle(record, events);
      const pricePercent = await this.pricePercent(tenantId, person, record.loyaltyProgram);
      const fallbackSettlement = this.finance.calculateSettlement(
        this.settlementSources(
          arrayValue(record.procedures).map((item) => objectValue(item)),
          arrayValue(record.products).map((item) => objectValue(item)),
        ),
        pricePercent,
      );
      const unknownPrice = record.historicalTransfer && (!arrayValue(record.procedures).length || arrayValue(record.procedures).some(item => item.cost == null || item.cost === ''));
      const settlement = unknownPrice ? null : await this.finance.settlementForSource(
        tenantId,
        'record',
        text(record.id),
        fallbackSettlement,
      ) || fallbackSettlement;
      const payment = await this.finance.recordSettlementPaymentState(tenantId, text(record.id), settlement);
      result.push({
        ...record,
        ...lifecycle,
        finance: settlement,
        payment,
        history: events,
      });
    }
    return result.sort((left, right) => {
      const a = `${dateValue(left?.date)}T${text(left?.from)}`;
      const b = `${dateValue(right?.date)}T${text(right?.from)}`;
      return b.localeCompare(a);
    });
  }

  async upsertFromOwner(tenantId: string, recordId: string, body: unknown) {
    const source = objectValue(body);
    const incoming = clone(objectValue(source.record ?? source));
    const id = text(recordId);
    incoming.id = id;
    const existing = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId: id } } });
    if (!existing) return this.create(tenantId, incoming, Number(source.position), { createHistory: false });

    const current = objectValue(existing.data);
    const incomingWorkplaceId = text(incoming.workplaceId);
    const date = dateValue(incoming.date);
    const workplaceChanged = text(current.workplaceId) !== incomingWorkplaceId;
    const rawProceduresChanged = !sameJson(arrayValue(current.procedures), arrayValue(incoming.procedures));
    const productsChanged = !sameJson(arrayValue(current.products), arrayValue(incoming.products));
    const personChanged = !sameJson(objectValue(current.person), objectValue(incoming.person));
    const groupChanged = !sameJson(objectValue(current.group), objectValue(incoming.group));
    const programChanged = !sameJson(objectValue(current.loyaltyProgram), objectValue(incoming.loyaltyProgram));
    const refreshProcedures = workplaceChanged || rawProceduresChanged;

    let procedures = arrayValue(current.procedures).map((item) => clone(objectValue(item)));
    if (refreshProcedures) {
      const requested = rawProceduresChanged ? arrayValue(incoming.procedures) : arrayValue(current.procedures);
      const ids = requested.map((item) => text(item?.id)).filter(Boolean);
      const canonical = ids.length ? await this.procedures.snapshots(tenantId, incomingWorkplaceId, ids, date) : [];
      const requestedById = new Map(requested.map((item) => [text(item?.id), objectValue(item)]));
      procedures = canonical.map((item) => {
        const draft = requestedById.get(item.id);
        const requestedDuration = Number(draft?.duration);
        const requestedCost = Number(draft?.cost ?? draft?.price);
        return {
          ...item,
          duration: Number.isFinite(requestedDuration) && requestedDuration > 0 ? requestedDuration : item.duration,
          cost: Number.isFinite(requestedCost) && requestedCost >= 0 ? requestedCost : item.cost,
        };
      });
    }

    const from = text(incoming.from);
    const totalDuration = procedures.reduce((sum, item) => sum + Math.max(0, Number(item?.duration || 0)), 0);
    const startMinutes = this.time.timeToMinutes(from);
    const derivedTo = totalDuration > 0 && startMinutes != null
      ? this.time.minutesToTime(startMinutes + totalDuration)
      : '';
    const to = derivedTo || text(incoming.to);

    const scheduleChanged = dateValue(current.date) !== date
      || workplaceChanged
      || text(current.from) !== from
      || text(current.to) !== to;
    if (scheduleChanged) {
      await this.validateAvailability(tenantId, {
        date,
        workplaceId: incomingWorkplaceId,
        from,
        to,
      }, { excludeRecordId: id });
    }

    const products = productsChanged
      ? arrayValue(incoming.products).map((item) => clone(objectValue(item)))
      : arrayValue(current.products).map((item) => clone(objectValue(item)));
    let person = personChanged ? clone(objectValue(incoming.person)) : clone(objectValue(current.person));
    const groupSource = groupChanged ? incoming.group : current.group;
    const currentGroupCapacity = Math.max(
      1,
      Math.floor(Number(objectValue(current.group).capacity) || groupCapacityFromProcedures(arrayValue(current.procedures).map((item) => objectValue(item)))),
    );
    const allowedGroupCapacity = rawProceduresChanged ? groupCapacityFromProcedures(procedures) : currentGroupCapacity;
    const group = normalizeGroup(groupSource, person, allowedGroupCapacity);
    if (group?.participants?.length) person = clone(group.participants[0]);
    const loyaltyProgram = programChanged ? nullableObject(incoming.loyaltyProgram) : nullableObject(current.loyaltyProgram);

    const currentPerson = objectValue(current.person);
    const currentPricePercent = await this.pricePercent(tenantId, currentPerson, current.loyaltyProgram);
    const currentFallbackSettlement = this.finance.calculateSettlement(
      this.settlementSources(
        arrayValue(current.procedures).map((item) => objectValue(item)),
        arrayValue(current.products).map((item) => objectValue(item)),
      ),
      currentPricePercent,
    );
    const currentSettlement = await this.finance.settlementForSource(
      tenantId,
      'record',
      id,
      currentFallbackSettlement,
    ) || currentFallbackSettlement;

    const nextSettlementSources = this.settlementSources(procedures, products);
    const nextPricePercent = await this.pricePercent(tenantId, person, loyaltyProgram);
    const settlement = personChanged
      ? this.finance.calculateSettlement(nextSettlementSources, nextPricePercent)
      : (refreshProcedures || productsChanged || programChanged)
        ? this.finance.repriceSettlement(nextSettlementSources, currentSettlement, nextPricePercent)
        : null;

    const { finance: _financeProjection, ...currentRecord } = current;
    const stored = {
      ...currentRecord,
      date,
      workplaceId: incomingWorkplaceId,
      from,
      to,
      person,
      group,
      procedures,
      products,
      loyaltyProgram,
      updatedAt: text(incoming.updatedAt) || new Date().toISOString(),
      createdAt: text(current.createdAt),
      createdBy: clone(objectValue(current.createdBy)),
      source: text(current.source),
      sourceRequestId: text(current.sourceRequestId),
    };

    await this.prisma.record.update({
      where: { tenantId_recordId: { tenantId, recordId: id } },
      data: {
        position: Number.isInteger(Number(source.position)) ? Number(source.position) : existing.position,
        data: json(stored),
      },
    });
    if (settlement) await this.finance.upsertSettlement(tenantId, 'record', id, settlement);
    return stored;
  }
}
