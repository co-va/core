import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';

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

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}:${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}`;
}

function knownPrice(item: JsonObject) {
  return item.cost !== '' && item.cost != null && Number.isFinite(Number(item.cost));
}

function historicalMoment(record: JsonObject) {
  const explicit = text(record.createdAt);
  if (explicit && Number.isFinite(new Date(explicit).getTime())) return new Date(explicit).toISOString();
  return new Date().toISOString();
}

@Injectable()
export class RecordImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  async importHistorical(tenantId: string, inputValue: unknown, position?: number) {
    const input = clone(objectValue(inputValue));
    const id = text(input.id);
    const date = text(input.date).slice(0, 10);
    const workplaceId = text(input.workplaceId);
    const from = text(input.from);
    if (!id) throw new BadRequestException('У записи отсутствует id');
    if (!date) throw new BadRequestException('неверная дата');
    if (!workplaceId) throw new BadRequestException('не найдено рабочее пространство');

    const existing = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId: id } } });
    if (existing) return { record: clone(objectValue(existing.data)), duplicate: true };

    const procedures = arrayValue(input.procedures).map((value, index) => {
      const item = clone(objectValue(value));
      return {
        ...item,
        id: text(item.id) || stableId('import-procedure-snapshot', [id, index, text(item.name)]),
        name: text(item.name),
        duration: Math.max(0, Number(item.duration) || 0),
        cost: knownPrice(item) ? Number(item.cost) : '',
      };
    });
    const products = arrayValue(input.products).map((value, index) => {
      const item = clone(objectValue(value));
      return {
        ...item,
        id: text(item.id) || stableId('import-product-snapshot', [id, index, text(item.name)]),
        name: text(item.name),
        cost: knownPrice(item) ? Number(item.cost) : '',
      };
    });
    const pricingKnown = [...procedures, ...products].every((item) => knownPrice(item));
    const createdAt = historicalMoment(input);
    const person = clone(objectValue(input.person));
    const provenance: JsonObject = {
      type: 'import',
      ...objectValue(input.provenance),
    };
    const record = {
      id,
      date,
      workplaceId,
      from,
      to: text(input.to),
      person,
      group: input.group && typeof input.group === 'object' ? clone(input.group) : null,
      procedures,
      products,
      loyaltyProgram: null,
      source: 'import',
      sourceRequestId: '',
      createdBy: {},
      createdAt,
      updatedAt: text(input.updatedAt) || createdAt,
      pricingKnown,
      provenance,
    };
    const createdEvent = {
      id: stableId('record-event', [id, 'created', provenance.importKey || createdAt]),
      recordId: id,
      type: 'created',
      category: 'action',
      at: createdAt,
      source: 'import',
      actor: {},
      subject: {
        personId: text(person.id),
        personKey: text(person.key),
        name: text(person.name),
        surname: text(person.surname),
      },
      payload: { appointment: { date, workplaceId, from, to: text(input.to) } },
      provenance,
    };
    const resolvedPosition = Number.isInteger(position)
      ? Number(position)
      : await this.prisma.record.count({ where: { tenantId } });

    await this.prisma.$transaction([
      this.prisma.record.create({ data: { tenantId, recordId: id, position: resolvedPosition, data: json(record) } }),
      this.prisma.recordEvent.create({ data: { tenantId, eventId: createdEvent.id, recordId: id, position: 0, data: json(createdEvent) } }),
    ]);

    const settlement = this.finance.calculateSettlement([
      ...procedures.map((item) => ({ ...item, sourceType: 'procedure', sourceId: text(item.id) })),
      ...products.map((item) => ({ ...item, sourceType: 'product', sourceId: text(item.id) })),
    ], 0);
    await this.finance.upsertSettlement(tenantId, 'record', id, {
      ...settlement,
      provenance,
      pricingKnown,
    });
    return { record, duplicate: false, createdEventId: createdEvent.id };
  }
}
