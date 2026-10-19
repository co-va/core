import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type JsonObject = Record<string, any>;
type Db = PrismaService | Prisma.TransactionClient;

type DepositAllocation = {
  depositId: string;
  name: string;
  amount: number;
  principalAmount: number;
  benefitAmount: number;
};

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

export function depositMoney(value: unknown) {
  return Math.round(Math.max(0, numberValue(value)) * 100) / 100;
}

export function depositBenefitMode(value: unknown) {
  const terms = objectValue(value);
  const type = text(terms.benefitType).toLowerCase();
  if (type === 'discount') return 'discount';
  if (type === 'accrual') return 'accrual';
  return 'none';
}

export function depositBenefitRate(value: unknown) {
  const terms = objectValue(value);
  return Math.max(0, Math.min(100, numberValue(terms.benefitValue)));
}

export function depositTermActiveAt(value: unknown, at: Date) {
  const terms = objectValue(value);
  const mode = text(terms.termMode).toLowerCase();
  if (mode !== 'dated' && mode !== 'fixed') return true;
  const day = at.toISOString().slice(0, 10);
  const start = text(terms.termStartDate).slice(0, 10);
  const end = text(terms.termEndDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && day < start) return false;
  return day <= end;
}

export function depositPersonKey(value: unknown) {
  const person = objectValue(value);
  return text(person.key ?? person.personKey ?? person.id);
}

function normalizedDepositAllocations(values: unknown) {
  return (Array.isArray(values) ? values : [])
    .map((value) => {
      const row = objectValue(value);
      return {
        depositId: text(row.depositId ?? row.sourceId ?? row.id),
        name: text(row.name ?? row.label),
        amount: depositMoney(row.amount),
        principalAmount: depositMoney(row.principalAmount),
        benefitAmount: depositMoney(row.benefitAmount),
      };
    })
    .filter((row) => row.depositId && row.amount > 0);
}

export async function expireDepositInstances(db: Db, tenantId: string, depositId = '') {
  const rows = await db.loyaltyDepositInstance.findMany({
    where: {
      tenantId,
      status: 'active',
      ...(depositId ? { depositId } : {}),
    },
  });
  const now = new Date();
  for (const row of rows) {
    if (depositTermActiveAt(row.terms, now)) continue;
    await db.loyaltyDepositInstance.update({
      where: { id: row.id },
      data: {
        principalBalance: 0,
        benefitBalance: 0,
        balance: 0,
        status: 'expired',
      },
    });
  }
}

export async function createDepositInstance(db: Db, tenantId: string, input: {
  depositId: string;
  programId: string;
  programName: string;
  person: JsonObject;
  terms: JsonObject;
  amount: number;
  occurredAt: Date;
  fundingOperationId: string;
}) {
  const amount = depositMoney(input.amount);
  const mode = depositBenefitMode(input.terms);
  const benefit = mode === 'accrual'
    ? depositMoney(amount * depositBenefitRate(input.terms) / 100)
    : 0;
  return db.loyaltyDepositInstance.create({
    data: {
      id: input.depositId,
      tenantId,
      depositId: input.depositId,
      programId: input.programId,
      programName: input.programName,
      personKey: depositPersonKey(input.person),
      person: input.person as Prisma.InputJsonValue,
      terms: input.terms as Prisma.InputJsonValue,
      initialAmount: amount,
      principalBalance: amount,
      benefitBalance: benefit,
      balance: depositMoney(amount + benefit),
      status: 'active',
      fundedAt: input.occurredAt,
      fundingOperationId: input.fundingOperationId,
    },
  });
}

export async function activeDepositPriceSources(db: Db, tenantId: string, personKey: string, at: Date) {
  if (!personKey) return [];
  await expireDepositInstances(db, tenantId);
  const rows = await db.loyaltyDepositInstance.findMany({
    where: { tenantId, personKey, status: 'active' },
    orderBy: [{ fundedAt: 'asc' }, { createdAt: 'asc' }],
  });
  return rows
    .filter((row) => depositTermActiveAt(row.terms, at)
      && depositBenefitMode(row.terms) === 'discount'
      && depositBenefitRate(row.terms) > 0)
    .map((row) => ({
      type: 'program',
      programType: 'deposit',
      depositId: row.depositId,
      programId: row.programId,
      name: row.programName || 'Депозит',
      percent: depositBenefitRate(row.terms),
    }));
}

export async function selectedDepositPriceSource(
  db: Db,
  tenantId: string,
  personKey: string,
  depositId: string,
  at: Date,
) {
  const id = text(depositId);
  if (!id) return null;
  await expireDepositInstances(db, tenantId, id);
  const row = await db.loyaltyDepositInstance.findUnique({
    where: { tenantId_depositId: { tenantId, depositId: id } },
  });
  if (!row) throw new BadRequestException('Выбранный депозит не найден');
  if (personKey && row.personKey !== personKey) throw new BadRequestException('Выбранный депозит принадлежит другому человеку');
  if (row.status !== 'active' || !depositTermActiveAt(row.terms, at)) {
    throw new BadRequestException(`Депозит «${row.programName || 'Депозит'}» недоступен`);
  }
  if (depositBenefitMode(row.terms) !== 'discount') return null;
  const rate = depositBenefitRate(row.terms);
  if (rate <= 0) return null;
  return {
    type: 'program',
    programType: 'deposit',
    depositId: row.depositId,
    programId: row.programId,
    name: row.programName || 'Депозит',
    percent: rate,
  };
}

export async function consumeDepositAllocations(db: Db, tenantId: string, values: unknown, expectedPersonKey: string, occurredAt: Date) {
  const requested = normalizedDepositAllocations(values);
  const seen = new Set<string>();
  const result: DepositAllocation[] = [];

  for (const request of requested) {
    if (seen.has(request.depositId)) throw new BadRequestException('Один депозит нельзя указать дважды');
    seen.add(request.depositId);
    await expireDepositInstances(db, tenantId, request.depositId);
    const row = await db.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: request.depositId } },
    });
    if (!row) throw new BadRequestException('Депозит не найден');
    if (expectedPersonKey && row.personKey !== expectedPersonKey) throw new BadRequestException('Депозит принадлежит другому человеку');
    if (row.status !== 'active' || !depositTermActiveAt(row.terms, occurredAt)) {
      throw new BadRequestException(`Депозит «${row.programName || 'Депозит'}» недоступен для оплаты`);
    }
    const principal = depositMoney(row.principalBalance);
    const benefit = depositMoney(row.benefitBalance);
    const available = depositMoney(row.balance);
    if (request.amount > available + 0.009) throw new BadRequestException(`На депозите «${row.programName || 'Депозит'}» недостаточно средств`);

    const principalAmount = Math.min(principal, request.amount);
    const benefitAmount = Math.min(benefit, depositMoney(request.amount - principalAmount));
    const nextPrincipal = depositMoney(principal - principalAmount);
    const nextBenefit = depositMoney(benefit - benefitAmount);
    const nextBalance = depositMoney(nextPrincipal + nextBenefit);
    const mode = depositBenefitMode(row.terms);
    const nextStatus = nextBalance <= 0.009 && mode !== 'discount' ? 'closed' : 'active';

    await db.loyaltyDepositInstance.update({
      where: { id: row.id },
      data: {
        principalBalance: nextPrincipal,
        benefitBalance: nextBenefit,
        balance: nextBalance,
        status: nextStatus,
      },
    });
    result.push({
      depositId: row.depositId,
      name: request.name || `${row.programName || 'Депозит'} · остаток ${available}`,
      amount: request.amount,
      principalAmount: depositMoney(principalAmount),
      benefitAmount: depositMoney(benefitAmount),
    });
  }
  return result;
}

export async function restoreDepositAllocations(db: Db, tenantId: string, values: unknown, at: Date) {
  const allocations = normalizedDepositAllocations(values);
  for (const allocation of allocations) {
    const row = await db.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: allocation.depositId } },
    });
    if (!row) throw new BadRequestException('Депозит для возврата не найден');
    if (!depositTermActiveAt(row.terms, at) || row.status === 'expired') continue;
    const principal = depositMoney(row.principalBalance);
    const benefit = depositMoney(row.benefitBalance);
    const principalRestore = Math.min(allocation.amount, allocation.principalAmount || allocation.amount);
    const benefitRestore = Math.min(depositMoney(allocation.amount - principalRestore), allocation.benefitAmount);
    const nextPrincipal = depositMoney(principal + principalRestore);
    const nextBenefit = depositMoney(benefit + benefitRestore);
    const nextBalance = depositMoney(nextPrincipal + nextBenefit);
    await db.loyaltyDepositInstance.update({
      where: { id: row.id },
      data: {
        principalBalance: nextPrincipal,
        benefitBalance: nextBenefit,
        balance: nextBalance,
        status: 'active',
      },
    });
  }
}

export async function reconsumeDepositAllocations(db: Db, tenantId: string, values: unknown, expectedPersonKey: string, at: Date) {
  const allocations = normalizedDepositAllocations(values);
  for (const allocation of allocations) {
    await expireDepositInstances(db, tenantId, allocation.depositId);
    const row = await db.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: allocation.depositId } },
    });
    if (!row) throw new BadRequestException('Депозит для отмены возврата не найден');
    if (expectedPersonKey && row.personKey !== expectedPersonKey) throw new BadRequestException('Депозит принадлежит другому человеку');
    if (row.status !== 'active' || !depositTermActiveAt(row.terms, at)) throw new BadRequestException('Депозит больше недоступен');
    const principal = depositMoney(row.principalBalance);
    const benefit = depositMoney(row.benefitBalance);
    const principalUse = allocation.principalAmount;
    const benefitUse = allocation.benefitAmount;
    if (principalUse > principal + 0.009 || benefitUse > benefit + 0.009) throw new BadRequestException('Состояние депозита изменилось и не позволяет отменить возврат');
    const nextPrincipal = depositMoney(principal - principalUse);
    const nextBenefit = depositMoney(benefit - benefitUse);
    const nextBalance = depositMoney(nextPrincipal + nextBenefit);
    const mode = depositBenefitMode(row.terms);
    await db.loyaltyDepositInstance.update({
      where: { id: row.id },
      data: {
        principalBalance: nextPrincipal,
        benefitBalance: nextBenefit,
        balance: nextBalance,
        status: nextBalance <= 0.009 && mode !== 'discount' ? 'closed' : 'active',
      },
    });
  }
}

export async function closeDepositForRefund(db: Db, tenantId: string, depositId: string, amount: number, at: Date) {
  await expireDepositInstances(db, tenantId, depositId);
  const row = await db.loyaltyDepositInstance.findUnique({
    where: { tenantId_depositId: { tenantId, depositId } },
  });
  if (!row) throw new BadRequestException('Депозит не найден');
  if (row.status !== 'active' || !depositTermActiveAt(row.terms, at)) throw new BadRequestException('Возврат по этому депозиту недоступен');
  const principal = depositMoney(row.principalBalance);
  const requested = depositMoney(amount);
  if (Math.abs(requested - principal) > 0.009) throw new BadRequestException('Возврат должен закрывать весь остаток реальных денег депозита');
  await db.loyaltyDepositInstance.update({
    where: { id: row.id },
    data: {
      principalBalance: 0,
      benefitBalance: 0,
      balance: 0,
      status: 'closed',
    },
  });
  return row;
}
