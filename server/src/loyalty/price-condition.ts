import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { describePriceConditionConflict, resolvePersonPriceCondition } from '../../../core/loyalty/price-condition.js';
import { activeDepositPriceSources, depositPersonKey, selectedDepositPriceSource } from './deposit-state';

type JsonObject = Record<string, any>;
type Db = PrismaService | Prisma.TransactionClient;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

// Deposit terms are calendar dates, not payment-operation timestamps.
export function visitDatePriceMoment(value: unknown): Date {
  const day = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequestException('Некорректная дата визита');
  const at = new Date(day + 'T12:00:00.000Z');
  if (Number.isNaN(at.getTime()) || at.toISOString().slice(0, 10) !== day) {
    throw new BadRequestException('Некорректная дата визита');
  }
  return at;
}

export async function resolvePersonPricePercent(
  db: Db,
  tenantId: string,
  personValue: unknown,
  at = new Date(),
  extraSources: JsonObject[] = [],
) {
  const key = depositPersonKey(personValue);
  const programSources = key ? await activeDepositPriceSources(db, tenantId, key, at) : [];
  const condition = resolvePersonPriceCondition(null, [...programSources, ...extraSources]);
  if (condition.conflict) {
    throw new BadRequestException(`Программная процентная скидка задваивается: ${describePriceConditionConflict(condition)}. Оставьте один программный источник процентного условия.`);
  }
  return condition;
}

export async function resolveSelectedRecordProgramPricePercent(
  db: Db,
  tenantId: string,
  personValue: unknown,
  selectedProgramValue: unknown,
  at = new Date(),
) {
  const selected = objectValue(selectedProgramValue);
  // An assigned deposit is automatic unless an explicit different program
  // selection overrides it. Only one active percentage source is permitted.
  if (!text(selected.type)) return resolvePersonPricePercent(db, tenantId, personValue, at);
  if (text(selected.type) !== 'deposit') return resolvePersonPriceCondition(null, []);
  const personKey = depositPersonKey(personValue);
  const source = personKey
    ? await selectedDepositPriceSource(db, tenantId, personKey, text(selected.assignmentId), at)
    : null;
  return resolvePersonPriceCondition(null, source ? [source] : []);
}
