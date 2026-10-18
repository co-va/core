import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { describePriceConditionConflict, resolvePersonPriceCondition } from '../../../core/loyalty/price-condition.js';
import { activeDepositPriceSources, depositPersonKey } from './deposit-state';

type JsonObject = Record<string, any>;
type Db = PrismaService | Prisma.TransactionClient;

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
