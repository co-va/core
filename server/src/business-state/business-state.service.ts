import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { normalizeUEI as normalizeUEIValue } from '../../../core/uei-format.js';
import { normalizePhone } from '../../../core/phone/index.js';
import { randomUUID } from 'node:crypto';
import { resolveTransferredPerson } from './person-transfer';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ProcedureService } from '../procedure/procedure.service';
import { RecordService } from '../record/record.service';

type JsonObject = Record<string, any>;
type BusinessBundle = {
  people: JsonObject[];
  uei: { entities: JsonObject; relations: JsonObject; revoked: any[] };
  records: JsonObject[];
  recordEvents: JsonObject[];
};

type OperationalBundle = {
  days: JsonObject[];
  procedures: JsonObject[];
  procedureHistory: JsonObject[];
  bookingSettings: JsonObject | null;
};

const OPERATIONAL_DATASETS = new Set(['days', 'procedures', 'procedureHistory', 'bookingSettings']);

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function positionValue(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeRows(value: unknown, key: string, label: string): JsonObject[] {
  const rows = (Array.isArray(value) ? value : []).map((item) => clone(objectValue(item)));
  const ids = rows.map((row) => text(row[key]));
  if (ids.some((id) => !id)) throw new BadRequestException(`${label}: отсутствует ${key}`);
  if (new Set(ids).size !== ids.length) throw new BadRequestException(`${label}: дублирующийся ${key}`);
  rows.forEach((row, index) => { row[key] = ids[index]; });
  return rows;
}

function normalizeUEI(value: unknown) {
  const source = objectValue(value);
  return {
    entities: clone(objectValue(source.entities)),
    relations: clone(objectValue(source.relations)),
    revoked: Array.isArray(source.revoked) ? clone(source.revoked) : [],
  };
}

function normalizeBundle(value: unknown): BusinessBundle {
  const source = objectValue(value);
  return {
    people: normalizeRows(source.people, 'key', 'Люди'),
    uei: normalizeUEI(source.uei),
    records: normalizeRows(source.records, 'id', 'Записи'),
    recordEvents: normalizeRows(source.recordEvents, 'id', 'История записей'),
  };
}

function normalizeOperational(value: unknown): OperationalBundle {
  const source = objectValue(value);
  const bookingSettings = source.bookingSettings && typeof source.bookingSettings === 'object' && !Array.isArray(source.bookingSettings)
    ? clone(objectValue(source.bookingSettings))
    : null;
  return {
    days: (Array.isArray(source.days) ? source.days : []).map((item) => clone(objectValue(item))),
    procedures: (Array.isArray(source.procedures) ? source.procedures : []).map((item) => clone(objectValue(item))),
    procedureHistory: (Array.isArray(source.procedureHistory) ? source.procedureHistory : []).map((item) => clone(objectValue(item))),
    bookingSettings,
  };
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value: BusinessBundle) {
  return JSON.stringify(stable(value));
}

function canonicalJson(value: unknown) {
  return JSON.stringify(stable(value));
}

function canonicalOperational(value: OperationalBundle) {
  return JSON.stringify(stable(value));
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function accountIdsFromPerson(person: JsonObject) {
  return uniqueStrings(Array.isArray(person.accounts) ? person.accounts : []);
}

function phoneDigits(value: unknown) {
  return text(value).replace(/\D/g, '');
}

function phonesMatch(left: unknown, right: unknown) {
  const a = phoneDigits(left);
  const b = phoneDigits(right);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.length === 11 && b.length === 11 && a.slice(1) === b.slice(1)
    && ((a.startsWith('7') && b.startsWith('8')) || (a.startsWith('8') && b.startsWith('7')));
}

function personHasPhone(person: JsonObject, phone: unknown) {
  return (Array.isArray(person.phones) ? person.phones : []).some((value) => phonesMatch(value, phone));
}

@Injectable()
export class BusinessStateService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['Person', 'UeiState', 'BusinessOperationalState']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['Person', 'UeiState', 'BusinessOperationalState'],before,after,checkOnly); }

  constructor(
    private readonly prisma: PrismaService,
    private readonly records: RecordService,
    private readonly procedures: ProcedureService,
  ) {}

  private async bundle(tenantId: string) {
    const [people, identity, records, recordEvents] = await Promise.all([
      this.prisma.person.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ueiState.findUnique({ where: { tenantId } }),
      this.prisma.record.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.recordEvent.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return {
      people: people.map((row) => clone(row.data)),
      uei: normalizeUEI(identity?.data || {}),
      records: records.map((row) => clone(row.data)),
      recordEvents: recordEvents.map((row) => clone(row.data)),
    };
  }

  async get(tenantId: string) {
    return this.bundle(tenantId);
  }

  async upsertPerson(tenantId: string, key: string, body: unknown) {
    const source = objectValue(body);
    const person = clone(objectValue(source.person ?? source));
    const normalizedKey = text(key);
    if (!normalizedKey) throw new BadRequestException('У Person отсутствует key');
    person.key = normalizedKey;
    await this.prisma.person.upsert({
      where: { tenantId_key: { tenantId, key: normalizedKey } },
      create: { tenantId, key: normalizedKey, position: positionValue(source.position), data: json(person) },
      update: { position: positionValue(source.position), data: json(person) },
    });
    return person;
  }

  async importPerson(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient, ownership: JsonObject = {}) {
    input={...input,...(input.birthday!==undefined?{birthDate:input.birthday}:{})};
    if(input.gender){const genders:JsonObject={'Мужской':'male','Женский':'female',male:'male',female:'female'};if(!genders[input.gender])throw new BadRequestException('Не удалось определить пол');input.gender=genders[input.gender];}
    const rows = await tx.person.findMany({ where: { tenantId } });
    const identityRow = await tx.ueiState.findUnique({ where: { tenantId } });
    const identity = normalizeUEI(identityRow?.data || {});
    const savedUei = text(identity.relations[`person:${targetId}`]);
    const mayCorrectUei = !!targetId && ownership.uei && ownership.uei === savedUei;
    const resolved = resolveTransferredPerson(rows.map(row => objectValue(row.data)), identity,
      mayCorrectUei ? { ...input, uei: undefined } : input, targetId);
    if (!text(input.name) && !resolved.person) throw new BadRequestException('Не указано имя');
    const previous = resolved.person;
    const key = previous?.key || randomUUID();
    const person: JsonObject = { ...(previous || {}), key };
    for (const field of ['name', 'surname', 'createdAt','birthDate','gender']) {
      if (input[field] === undefined) continue;
      const value = text(input[field]); const current = text(previous?.[field]);
      const ownsCurrent = ownership[field] !== undefined && ownership[field] === current;
      if (previous && current && current !== value && !ownsCurrent) throw new ConflictException(`Нельзя изменить ${field === 'name' ? 'имя' : field === 'surname' ? 'фамилию' : 'дату создания'}: значение не принадлежит этому переносу. Проверьте данные.`);
      person[field] = value;
      if (!previous || !current || ownsCurrent) ownership[field] = value;
      else delete ownership[field];
    }
    for (const [field, collection] of [['phone', 'phones'], ['email', 'emails']]) {
      if (input[field] === undefined) continue;
      const normalize = field === 'phone' ? normalizePhone : text;
      const value = normalize(input[field]);
      const values: any[] = Array.isArray(previous?.[collection]) ? previous[collection] : [];
      const owned = text(ownership[field]);
      const retained = values.filter(item => !owned || normalize(item) !== owned);
      const independent = retained.some(item => normalize(item) === value);
      if (value && !independent) retained.push(value);
      person[collection] = retained;
      if (value && !independent) ownership[field] = value; else delete ownership[field];
    }
    if (mayCorrectUei && input.uei !== undefined) {
      const next = text(input.uei) ? normalizeUEIValue(input.uei) : '';
      if (next === '0000') throw new ConflictException('0000 не является действительным UEI');
      const used = identity.entities[next];
      if (next && used && (used.members || []).some((member: string) => member !== `person:${key}`)) throw new ConflictException('UEI конфликтует с уже сохранённым UEI');
      if (next !== savedUei) {
        const old = identity.entities[savedUei];
        if (old && (old.members || []).some((member: string) => member !== `person:${key}`)) throw new ConflictException('UEI имеет независимые связи. Проверьте данные.');
        delete identity.entities[savedUei]; delete identity.relations[`person:${key}`];
      }
      resolved.uei = next;
      ownership.uei = next;
    }
    if (resolved.uei && !identity.relations[`person:${key}`]) {
      const used = identity.entities[resolved.uei];
      if (used && (used.members || []).some((member: string) => member !== `person:${key}`)) throw new ConflictException('UEI конфликтует с уже сохранённым UEI');
      identity.entities[resolved.uei] = used || { uei: resolved.uei, owner: { type: 'person', id: key }, members: [`person:${key}`], history: [], reserved: true };
      identity.relations[`person:${key}`] = resolved.uei;
      ownership.uei = resolved.uei;
    }
    if(input.additionalPhone!==undefined) {
      const additional=normalizePhone(input.additionalPhone);if(!additional)throw new BadRequestException('Неверный формат дополнительного телефона');
      resolveTransferredPerson(rows.map(row=>objectValue(row.data)),identity,{phone:input.additionalPhone},key);
      const values=Array.isArray(person.phones)?person.phones:[];const previousAdditional=text(ownership.additionalPhone);
      const phones=values.filter((value:unknown)=>!previousAdditional || normalizePhone(value)!==previousAdditional);
      if(!phones.some((value:unknown)=>normalizePhone(value)===additional)){phones.push(additional);ownership.additionalPhone=additional;}else delete ownership.additionalPhone;
      person.phones=phones;
    }
    await tx.person.upsert({ where: { tenantId_key: { tenantId, key } },
      create: { tenantId, key, position: rows.length, data: json(person) }, update: { data: json(person) } });
    await tx.ueiState.upsert({ where: { tenantId }, create: { tenantId, data: json(identity) }, update: { data: json(identity) } });
    return key;
  }

  async resolveTransferPerson(tenantId: string, input: JsonObject, tx: Prisma.TransactionClient) {
    const rows = await tx.person.findMany({ where: { tenantId } });
    const identityRow = await tx.ueiState.findUnique({ where: { tenantId } });
    const resolved = resolveTransferredPerson(rows.map(row => objectValue(row.data)), normalizeUEI(identityRow?.data || {}), input);
    if (!resolved.person) throw new BadRequestException('Не удалось однозначно определить человека');
    return resolved.person;
  }

  async importSchedule(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    const row = await tx.businessOperationalState.findUnique({ where: { tenantId } });
    const bundle = normalizeOperational(row?.data || {});
    const existing = bundle.days.filter(day => text(day.workplaceId) === text(input.workplaceId) && text(day.date).slice(0, 10) === input.date);
    if (!targetId && existing.length) throw new ConflictException('График на эту дату уже существует. Укажите ID переноса для корректировки.');
    const id = targetId || randomUUID();
    const day = { ...input, id };
    const position = bundle.days.findIndex(day => day.id === id);
    if (targetId && position < 0) throw new BadRequestException('Перенесённый день графика не найден');
    if (position < 0) bundle.days.push(day); else bundle.days[position] = day;
    await tx.businessOperationalState.upsert({ where: { tenantId }, create: { tenantId, data: json(bundle) }, update: { data: json(bundle) } });
    return id;
  }

  async deletePerson(tenantId: string, key: string) {
    const normalizedKey = text(key);
    const result = await this.prisma.person.deleteMany({ where: { tenantId, key: normalizedKey } });
    return { deleted: result.count };
  }

  async updateUEI(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const uei = normalizeUEI(source.uei ?? source);
    await this.prisma.ueiState.upsert({
      where: { tenantId },
      create: { tenantId, data: json(uei) },
      update: { data: json(uei) },
    });
    return uei;
  }

  async upsertRecord(tenantId: string, recordId: string, body: unknown) {
    const id = text(recordId);
    if (!id) throw new BadRequestException('У записи отсутствует id');
    return this.records.upsertFromOwner(tenantId, id, body);
  }

  async deleteRecord(tenantId: string, recordId: string) {
    const id = text(recordId);
    return this.prisma.$transaction(async (tx) => {
      const financeOperations = await tx.financeOperation.deleteMany({ where: { tenantId, sourceType: 'record', sourceId: id } });
      const settlements = await tx.financeSettlement.deleteMany({ where: { tenantId, sourceType: 'record', sourceId: id } });
      const events = await tx.recordEvent.deleteMany({ where: { tenantId, recordId: id } });
      const record = await tx.record.deleteMany({ where: { tenantId, recordId: id } });
      return { deleted: record.count, deletedEvents: events.count, deletedFinanceOperations: financeOperations.count, deletedSettlements: settlements.count };
    });
  }

  async deleteRecordEvents(tenantId: string, recordId: string) {
    const result = await this.prisma.recordEvent.deleteMany({ where: { tenantId, recordId: text(recordId) } });
    return { deleted: result.count };
  }

  async upsertRecordEvent(tenantId: string, eventId: string, body: unknown) {
    const source = objectValue(body);
    const event = clone(objectValue(source.event ?? source));
    const id = text(eventId);
    const recordId = text(event.recordId);
    if (!id || !recordId) throw new BadRequestException('У события записи отсутствует id или recordId');
    event.id = id;
    event.recordId = recordId;
    const existing = await this.prisma.recordEvent.findUnique({ where: { tenantId_eventId: { tenantId, eventId: id } } });
    if (existing) {
      const sameRecord = existing.recordId === recordId;
      const sameData = canonicalJson(objectValue(existing.data)) === canonicalJson(event);
      if (!sameRecord || !sameData) throw new ConflictException('Событие Record неизменяемо и не может быть переписано');
      return clone(objectValue(existing.data));
    }
    if (text(event.type) === 'created') {
      const recordEvents = await this.prisma.recordEvent.findMany({ where: { tenantId, recordId } });
      const created = recordEvents.find((row) => text(objectValue(row.data).type) === 'created');
      if (created) return clone(objectValue(created.data));
    }
    await this.prisma.recordEvent.create({ data: { tenantId, eventId: id, recordId, position: positionValue(source.position), data: json(event) } });
    return event;
  }

  private async ensureOperationalState(tenantId: string) {
    return this.prisma.businessOperationalState.upsert({
      where: { tenantId },
      create: { tenantId, data: json(normalizeOperational({})) },
      update: {},
    });
  }

  private async operationalBundle(tenantId: string) {
    const row = await this.ensureOperationalState(tenantId);
    return normalizeOperational(row.data);
  }

  async getOperational(tenantId: string) {
    return this.operationalBundle(tenantId);
  }

  async updateOperationalDataset(tenantId: string, dataset: string, body: unknown) {
    const key = text(dataset);
    if (!OPERATIONAL_DATASETS.has(key)) throw new BadRequestException('Неизвестный набор рабочих данных');
    const row = await this.ensureOperationalState(tenantId);
    const current = normalizeOperational(row.data);
    const source = objectValue(body);
    const value = source.value;
    if (key === 'bookingSettings') current.bookingSettings = value && typeof value === 'object' && !Array.isArray(value) ? clone(objectValue(value)) : null;
    else (current as any)[key] = Array.isArray(value) ? clone(value) : [];
    await this.prisma.businessOperationalState.update({ where: { tenantId }, data: { data: json(current) } });
    return current;
  }

  async publicOperational(tenantId: string) {
    const row = await this.ensureOperationalState(tenantId);
    const current = normalizeOperational(row.data);
    const workplaceIds = uniqueStrings(current.procedures.flatMap((procedure) =>
      (Array.isArray(procedure.workplaces) ? procedure.workplaces : [])
        .map((assignment) => assignment?.workplaceId ?? assignment?.key ?? assignment?.id),
    ));
    return {
      ...current,
      procedures: this.procedures.publicBookingCatalog(current.procedures, workplaceIds),
    };
  }

  async bookingIdentityForAccount(tenantId: string, accountId: string) {
    const id = text(accountId);
    const [rows, identityRow] = await Promise.all([
      this.prisma.person.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ueiState.findUnique({ where: { tenantId } }),
    ]);
    const people = rows.map((row) => ({ row, person: objectValue(row.data) }));
    const matched = people.find(({ person }) => accountIdsFromPerson(person).includes(id)) || null;
    if (!matched) return { person: null, matchedPerson: null, uei: '', memberPeople: [], accountIds: id ? [id] : [] };

    const identity = normalizeUEI(identityRow?.data || {});
    const matchedKey = text(matched.person.key || matched.row.key);
    const uei = text(identity.relations[`person:${matchedKey}`]);
    const entity = uei ? objectValue(identity.entities[uei]) : {};
    const memberKeys = uei
      ? uniqueStrings((Array.isArray(entity.members) ? entity.members : [])
          .map((value) => text(value))
          .filter((value) => value.startsWith('person:'))
          .map((value) => value.slice(7)))
      : [matchedKey];
    const memberPeople = people.filter(({ row, person }) => memberKeys.includes(text(person.key || row.key)));
    const ownerKey = objectValue(entity.owner).type === 'person' ? text(objectValue(entity.owner).id) : '';
    const primary = memberPeople.find(({ row, person }) => text(person.key || row.key) === ownerKey) || matched;
    const accountIds = uniqueStrings(memberPeople.flatMap(({ person }) => accountIdsFromPerson(person)));
    return {
      person: primary.person,
      matchedPerson: matched.person,
      uei,
      memberPeople: memberPeople.map(({ person }) => person),
      accountIds: accountIds.length ? accountIds : [id],
    };
  }

  async accountIdsForIdentity(tenantId: string, phoneValue: unknown, ueiValue: unknown) {
    const phone = text(phoneValue);
    const requestedUei = text(ueiValue);
    if (!phone && !requestedUei) return [];
    const [rows, identityRow] = await Promise.all([
      this.prisma.person.findMany({ where: { tenantId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.ueiState.findUnique({ where: { tenantId } }),
    ]);
    const people = rows.map((row) => ({ row, person: objectValue(row.data) }));
    const identity = normalizeUEI(identityRow?.data || {});
    const memberKeys = new Set<string>();
    const addUeiMembers = (uei: string) => {
      const entity = objectValue(identity.entities[uei]);
      for (const member of Array.isArray(entity.members) ? entity.members : []) {
        const value = text(member);
        if (value.startsWith('person:')) memberKeys.add(value.slice(7));
      }
    };
    if (requestedUei) addUeiMembers(requestedUei);
    if (phone) {
      for (const { row, person } of people) {
        if (!personHasPhone(person, phone)) continue;
        const key = text(person.key || row.key);
        if (!key) continue;
        memberKeys.add(key);
        const linkedUei = text(identity.relations[`person:${key}`]);
        if (linkedUei) addUeiMembers(linkedUei);
      }
    }
    return uniqueStrings(
      people
        .filter(({ row, person }) => memberKeys.has(text(person.key || row.key)))
        .flatMap(({ person }) => accountIdsFromPerson(person)),
    );
  }
}
