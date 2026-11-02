import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PersonalAccountFinanceService } from '../finance/personal-account-finance.service';
import { PrismaService } from '../prisma.service';
import {
  listPersonalAccountsWithActivity,
  personalAccountSnapshot,
  resolvePersonalAccountIdentity,
  updatePersonalAccountSettingsWith,
} from './personal-account-state';

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, number) * 100) / 100 : 0;
}

function percent(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 100) / 100)) : 100;
}

function isRetryableTransactionError(error: unknown) {
  const code = text(objectValue(error).code);
  return code === 'P2034' || code === '40001';
}

@Injectable()
export class PersonalAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: PersonalAccountFinanceService,
  ) {}

  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        lastError = error;
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
      }
    }
    throw lastError;
  }

  list(tenantId: string) {
    return listPersonalAccountsWithActivity(this.prisma, tenantId);
  }

  get(tenantId: string, personKey: string) {
    return personalAccountSnapshot(this.prisma, tenantId, personKey);
  }

  updateSettings(tenantId: string, personKey: string, body: unknown) {
    return this.serializable((tx) => updatePersonalAccountSettingsWith(tx, tenantId, personKey, body));
  }

  fund(tenantId: string, personKey: string, body: unknown) {
    return this.finance.fund(tenantId, { ...objectValue(body), personKey });
  }

  withdraw(tenantId: string, personKey: string, body: unknown) {
    return this.finance.withdraw(tenantId, { ...objectValue(body), personKey });
  }

  pay(tenantId: string, personKey: string, body: unknown) {
    return this.finance.pay(tenantId, { ...objectValue(body), personKey });
  }

  refundPayment(tenantId: string, paymentOperationId: string, body: unknown) {
    return this.finance.refundPayment(tenantId, paymentOperationId, body);
  }

  finalizeDebt(tenantId: string, personKey: string, body: unknown) {
    return this.finance.finalizeDebt(tenantId, { ...objectValue(body), personKey });
  }

  settleDebt(tenantId: string, debtId: string, body: unknown) {
    return this.finance.settleDebt(tenantId, debtId, body);
  }

  async endUserSummary(tenantId: string, personKeyValue: string) {
    const identity = await resolvePersonalAccountIdentity(this.prisma, tenantId, personKeyValue).catch(() => null);
    if (!identity?.primaryKey) return null;
    const personKey = identity.primaryKey;
    const rows = await this.prisma.$queryRaw<Array<{
      balance: unknown;
      spendLimitPercent: unknown;
      visibleToEndUser: boolean;
    }>>`
      SELECT "balance", "spendLimitPercent", "visibleToEndUser"
      FROM "LoyaltyPersonalAccount"
      WHERE "tenantId" = ${tenantId} AND "personKey" = ${personKey}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || !row.visibleToEndUser) return null;
    const [movements, debts] = await Promise.all([
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM "LoyaltyPersonalAccountMovement"
        WHERE "tenantId" = ${tenantId} AND "personKey" = ${personKey}
      `,
      this.prisma.$queryRaw<Array<{ count: bigint; total: unknown }>>`
        SELECT COUNT(*)::bigint AS "count", COALESCE(SUM("outstandingAmount"), 0) AS "total"
        FROM "LoyaltyPersonalAccountDebt"
        WHERE "tenantId" = ${tenantId} AND "personKey" = ${personKey}
      `,
    ]);
    const movementCount = Number(movements[0]?.count || 0);
    const debtCount = Number(debts[0]?.count || 0);
    const balance = money(row.balance);
    const debtTotal = money(debts[0]?.total);
    if (!movementCount && !debtCount && balance <= 0.009 && debtTotal <= 0.009) return null;
    return {
      balance,
      debtTotal,
      spendLimitPercent: percent(row.spendLimitPercent),
    };
  }

  async endUserView(tenantId: string, personKey: string) {
    const snapshot = await personalAccountSnapshot(this.prisma, tenantId, personKey);
    if (!snapshot.visibleToEndUser) return null;
    return {
      balance: snapshot.balance,
      debtTotal: snapshot.debtTotal,
      spendLimitPercent: snapshot.spendLimitPercent,
      movements: Array.isArray(snapshot.movements) ? snapshot.movements.map((movement: Record<string, any>) => ({
        id: movement.id,
        kind: movement.kind,
        direction: movement.direction,
        amount: movement.amount,
        occurredAt: movement.occurredAt,
        balanceAfter: movement.balanceAfter,
      })) : [],
      debts: Array.isArray(snapshot.debts) ? snapshot.debts.map((debt: Record<string, any>) => ({
        id: debt.id,
        originalAmount: debt.originalAmount,
        outstandingAmount: debt.outstandingAmount,
        occurredAt: debt.occurredAt,
        closedAt: debt.closedAt,
        status: debt.status,
      })) : [],
    };
  }
}
