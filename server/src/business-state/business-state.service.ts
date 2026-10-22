import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { normalizeUEI as normalizeUEIValue } from '../../../core/uei-format.js';
import { normalizePhone } from '../../../core/phone/index.js';
import { randomUUID } from 'node:crypto';
import { resolveTransferredPerson } from './person-transfer';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
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

  private async operationalBundle(tenantId: string): Promise<OperationalBundle> {
    const row = await this.prisma.businessOperationalState.findUnique({ where: { tenantId } });
    return normalizeOperational(row?.data || {});
  }

  async get(tenantId: string) {
    return this.bundle(tenantId);
  }

  async getOperational(tenantId: string) {
    return this.operationalBundle(tenantId);
  }

  async putOperationalDataset(tenantId: string, dataset: string, body: unknown) {
    const key = text(dataset);
    if (!OPERATIONAL_DATASETS.has(key)) throw new BadRequestException('Неизвестный operational dataset');
    const source = objectValue(body);
    const current = await this.operationalBundle(tenantId);
    const next = normalizeOperational({ ...current, [key]: source.value });
    if (canonicalOperational(current) === canonicalOperational(next)) return { ok: true, value: current };
    await this.prisma.businessOperationalState.upsert({
      where: { tenantId },
      create: { tenantId, data: json(next) },
      update: { data: json(next) },
    });
    return { ok: true, value: next };
  }

  async put(tenantId: string, value: unknown) {
    const next = normalizeBundle(value);
    const current = await this.bundle(tenantId);
    if (canonical(current) === canonical(next)) return current;
    await this.prisma.$transaction(async (tx) => {
      await tx.person.deleteMany({ where: { tenantId } });
      await tx.ueiState.deleteMany({ where: { tenantId } });
      await this.records.replaceAll(tx, tenantId, next.records, next.recordEvents);
      if (next.people.length) {
        await tx.person.createMany({ data: next.people.map((person, position) => ({ tenantId, key: person.key, position, data: json(person) })) });
      }
      await tx.ueiState.create({ data: { tenantId, data: json(next.uei) } });
    });
    return this.bundle(tenantId);
  }

  async putPerson(tenantId: string, key: string, body: unknown) {
    const source = objectValue(body);
    const person = clone(objectValue(source.person));
    if (text(person.key) !== text(key)) throw new BadRequestException('Ключ человека не совпадает');
    const position = positionValue(source.position);
    const normalized = normalizeRows([person], 'key', 'Люди')[0];
    await this.prisma.person.upsert({
      where: { tenantId_key: { tenantId, key: normalized.key } },
      create: { tenantId, key: normalized.key, position, data: json(normalized) },
      update: { position, data: json(normalized) },
    });
    return { ok: true };
  }

  async deletePerson(tenantId: string, key: string) {
    await this.prisma.person.deleteMany({ where: { tenantId, key: text(key) } });
    return { ok: true };
  }

  async putUei(tenantId: string, body: unknown) {
    const source = objectValue(body);
    const uei = normalizeUEI(source.uei);
    await this.prisma.ueiState.upsert({
      where: { tenantId },
      create: { tenantId, data: json(uei) },
      update: { data: json(uei) },
    });
    return { ok: true };
  }

  async putRecord(tenantId: string, id: string, body: unknown) {
    return this.records.putRecord(this.prisma, tenantId, id, body);
  }

  async deleteRecord(tenantId: string, id: string) {
    return this.records.deleteRecord(this.prisma, tenantId, id);
  }

  async putRecordEvent(tenantId: string, id: string, body: unknown) {
    return this.records.putRecordEvent(this.prisma, tenantId, id, body);
  }

  async deleteRecordEvents(tenantId: string, recordId: string) {
    return this.records.deleteRecordEvents(this.prisma, tenantId, recordId);
  }

  async transferContact(tenantId: string, input: { name?: unknown; phone?: unknown; uei?: unknown; sourceId?: unknown } = {}) {
    const bundle = await this.bundle(tenantId);
    const incoming = {
      name: text(input.name),
      phone: normalizePhone(text(input.phone)),
      uei: text(input.uei).toUpperCase(),
      sourceId: text(input.sourceId),
    };
    if (!incoming.name && !incoming.phone && !incoming.uei) throw new BadRequestException('Для переноса человека нужны имя, телефон или UEI');

    const people = bundle.people.map((person) => clone(person));
    const uei = normalizeUEIValue(bundle.uei);
    const resolution = resolveTransferredPerson({ people, uei }, incoming);
    if (resolution.status === 'ambiguous') {
      throw new ConflictException({
        code: 'TRANSFER_PERSON_AMBIGUOUS',
        message: 'Найдено несколько возможных совпадений. Нужен выбор пользователя.',
        candidates: resolution.candidates,
      });
    }

    const existing = resolution.status === 'matched' ? people.find((person) => person.key === resolution.personKey) || null : null;
    const person = existing || {
      key: `person_${randomUUID()}`,
      id: '',
      uei: '',
      name: '',
      phone: '',
      phones: [],
      email: '',
      telegram: '',
      discountPercent: 0,
      visits: 0,
      totalSpent: 0,
      lastVisit: '',
      contacts: [],
      programs: [],
      notes: '',
      documents: [],
      consentHistory: [],
      accounts: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const mergeName = incoming.name && !text(person.name) ? incoming.name : text(person.name);
    const mergePhone = incoming.phone && !personHasPhone(person, incoming.phone) ? incoming.phone : '';
    const phones = uniqueStrings([...(Array.isArray(person.phones) ? person.phones : []), person.phone, mergePhone]);
    const nextPerson = {
      ...person,
      name: mergeName,
      phone: text(person.phone) || phones[0] || '',
      phones,
      updatedAt: new Date().toISOString(),
    };

    let nextUei = normalizeUEIValue(uei);
    if (incoming.uei) {
      const current = nextUei.entities[incoming.uei];
      if (current && current !== nextPerson.key) {
        throw new ConflictException({
          code: 'TRANSFER_UEI_CONFLICT',
          message: 'UEI уже связан с другим человеком.',
          candidates: [current, nextPerson.key],
        });
      }
      nextUei.entities[incoming.uei] = nextPerson.key;
      if (!text(nextPerson.uei)) nextPerson.uei = incoming.uei;
    }

    if (!existing) people.push(nextPerson);
    else people[people.findIndex((item) => item.key === nextPerson.key)] = nextPerson;

    await this.put(tenantId, { ...bundle, people, uei: nextUei });
    return { status: resolution.status, person: nextPerson, matchedBy: resolution.matchedBy || [] };
  }
}
