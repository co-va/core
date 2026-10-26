import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { calculateSettlement as calculateCanonicalSettlement } from '../../../core/finance/rules.js';
import { PrismaService } from '../prisma.service';
import {
  consumeDepositAllocations,
  restoreDepositAllocations,
} from '../loyalty/deposit-state';
import { resolvePersonPricePercent } from '../loyalty/price-condition';
import {
  applyPersonalAccountMovement,
  personalAccountMoney,
  personalAccountSpendAvailability,
  syncPersonalAccountDebt,
} from '../loyalty/personal-account-state';
import { FinanceService } from './finance.service';

type JsonObject = Record<string, any>;
type Source = { type: string; id: string };

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function numberValue(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function money(value: unknown) {
  return Math.round(Math.max(0, numberValue(value)) * 100) / 100;
}

function percent(value: unknown) {
  return Math.max(0, Math.min(100, numberValue(value)));
}

function requiredOccurredAt(value: unknown) {
  const raw = text(value);
  if (!raw) throw new BadRequestException('Укажите фактическую дату и время операции');
  const date = value instanceof Date ? value : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Некорректная фактическая дата операции');
  return date;
}

function isRetryableTransactionError(error: unknown) {
  const code = text(objectValue(error).code);
  return code === 'P2034' || code === '40001';
}

function sourceValue(value: unknown): Source {
  const source = objectValue(value);
  return { type: text(source.type), id: text(source.id) };
}

function personKey(value: unknown) {
  const person = objectValue(value);
  return text(person.key ?? person.personKey ?? person.id);
}

function allocationsValue(value: unknown) {
  return arrayValue(value)
    .map((entry) => {
      const row = objectValue(entry);
      return {
        walletId: text(row.walletId),
        walletName: text(row.walletName),
        amount: money(row.amount),
      };
    })
    .filter((entry) => entry.walletId && entry.amount > 0);
}

function depositAllocationsValue(value: unknown) {
  return arrayValue(value)
    .map((entry) => {
      const row = objectValue(entry);
      return {
        depositId: text(row.depositId ?? row.sourceId ?? row.id),
        name: text(row.name ?? row.label),
        amount: money(row.amount),
        principalAmount: money(row.principalAmount),
        benefitAmount: money(row.benefitAmount),
      };
    })
    .filter((entry) => entry.depositId && entry.amount > 0);
}

function canonicalSettlementInput(value: unknown, pricePercent: number) {
  const source = objectValue(value);
  const rows = arrayValue(source.items);
  if (!rows.length) throw new BadRequestException('У оплаты отсутствует расчёт');
  const items = rows.map((value) => {
    const row = objectValue(value);
    const price = money(row.price ?? row.cost);
    const correctionModeValue = text(row.correctionMode);
    const correctionMode = ['percent', 'money', 'none'].includes(correctionModeValue) ? correctionModeValue : 'none';
    const correctionPercent = percent(row.correctionPercent);
    const correctionMoney = Math.min(price, money(row.correctionMoney));
    return {
      sourceType: text(row.sourceType) || 'procedure',
      sourceId: text(row.sourceId ?? row.id),
      name: text(row.name),
      price,
      correctionMode,
      correctionPercent,
      correctionMoney,
    };
  });
  return calculateCanonicalSettlement(items, { pricePercent });
}

function splitCashComponents(allocations: JsonObject[], serviceAmount: number, tips: number) {
  let serviceLeft = money(serviceAmount);
  let tipsLeft = money(tips);
  const entries: JsonObject[] = [];
  for (const allocation of allocations) {
    let walletLeft = money(allocation.amount);
    const service = Math.min(walletLeft, serviceLeft);
    if (service > 0) {
      entries.push({ walletId: allocation.walletId, walletName: allocation.walletName, amount: service, component: 'service' });
      walletLeft = money(walletLeft - service);
      serviceLeft = money(serviceLeft - service);
    }
    const tip = Math.min(walletLeft, tipsLeft);
    if (tip > 0) {
      entries.push({ walletId: allocation.walletId, walletName: allocation.walletName, amount: tip, component: 'tips' });
      tipsLeft = money(tipsLeft - tip);
    }
  }
  if (serviceLeft > 0.009 || tipsLeft > 0.009) throw new BadRequestException('Сумма по кошелькам не совпадает с оплатой');
  return entries;
}

@Injectable()
export class PaymentSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
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

  private async serviceNet(tx: Prisma.TransactionClient, tenantId: string, source: Source) {
    const rows = await tx.financeOperation.findMany({
      where: {
        tenantId,
        sourceType: source.type,
        sourceId: source.id,
        status: 'completed',
        kind: { in: ['payment', 'refund'] },
      },
      select: { kind: true, data: true },
    });
    return money(rows.reduce((sum, row) => {
      const amount = money(objectValue(row.data).serviceAmount);
      return sum + (row.kind === 'refund' ? -amount : amount);
    }, 0));
  }

  private async personalAccountUsed(tx: Prisma.TransactionClient, tenantId: string, source: Source) {
    const rows = await tx.financeOperation.findMany({
      where: {
        tenantId,
        sourceType: source.type,
        sourceId: source.id,
        status: 'completed',
        kind: { in: ['payment', 'refund'] },
      },
      select: { kind: true, data: true },
    });
    return money(rows.reduce((sum, row) => {
      const data = objectValue(row.data);
      return sum + (row.kind === 'payment'
        ? money(data.personalAccountAmount)
        : -money(data.personalAccountRestored));
    }, 0));
  }

  private async saveSettlement(tx: Prisma.TransactionClient, tenantId: string, source: Source, settlement: JsonObject) {
    await tx.financeSettlement.upsert({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: source.type, sourceId: source.id } },
      create: { tenantId, sourceType: source.type, sourceId: source.id, data: json(settlement) },
      update: { data: json(settlement) },
    });
  }

  private async createOperation(tx: Prisma.TransactionClient, tenantId: string, input: {
    operationId: string;
    kind: 'payment' | 'refund';
    source: Source;
    originalOperationId?: string;
    occurredAt: Date;
    data: JsonObject;
    entries: JsonObject[];
  }) {
    const operation = await tx.financeOperation.create({
      data: {
        tenantId,
        operationId: input.operationId,
        kind: input.kind,
        status: 'completed',
        sourceType: input.source.type,
        sourceId: input.source.id,
        originalOperationId: text(input.originalOperationId),
        occurredAt: input.occurredAt,
        data: json(input.data),
      },
    });
    for (const entry of input.entries) {
      await tx.financeLedgerEntry.create({
        data: {
          tenantId,
          financeOperationId: operation.id,
          entryId: randomUUID(),
          walletId: text(entry.walletId),
          direction: text(entry.direction),
          economicType: text(entry.economicType),
          amount: money(entry.amount),
          occurredAt: input.occurredAt,
          sourceType: input.source.type,
          sourceId: input.source.id,
          data: json({
            walletName: text(entry.walletName),
            component: text(entry.component),
          }),
        },
      });
    }
    return operation;
  }

  async recordPayment(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const source = sourceValue(input.source);
    if (!source.type || !source.id) throw new BadRequestException('У оплаты отсутствует источник');
    const person = clone(objectValue(input.person));
    const ownerKey = personKey(person);
    const allocations = allocationsValue(input.allocations);
    const requestedDepositAllocations = depositAllocationsValue(input.depositAllocations);
    const personalAccountAmount = money(input.personalAccountAmount);
    if (!allocations.length && !requestedDepositAllocations.length && personalAccountAmount <= 0) {
      throw new BadRequestException('Не выбран источник оплаты');
    }
    if (personalAccountAmount > 0 && !ownerKey) throw new BadRequestException('Для Личного счёта выберите человека');

    const cashAllocated = money(allocations.reduce((sum, entry) => sum + entry.amount, 0));
    const depositAllocated = money(requestedDepositAllocations.reduce((sum, entry) => sum + entry.amount, 0));
    const tips = Math.min(cashAllocated, money(input.tips));
    const cashServiceAmount = money(cashAllocated - tips);
    const defaultService = money(cashServiceAmount + depositAllocated + personalAccountAmount);
    const serviceAmount = money(input.serviceAmount == null ? defaultService : input.serviceAmount);
    if ((serviceAmount <= 0 && tips <= 0) || money(serviceAmount + tips) !== money(cashAllocated + depositAllocated + personalAccountAmount)) {
      throw new BadRequestException('Сумма оплаты не совпадает с распределением по источникам');
    }

    const occurredAt = requiredOccurredAt(input.occurredAt);
    const operationId = randomUUID();
    let remainingDue = 0;
    await this.serializable(async (tx) => {
      const condition = await resolvePersonPricePercent(tx, tenantId, person, occurredAt);
      const settlement = canonicalSettlementInput(input.settlement, condition.percent);
      const paid = await this.serviceNet(tx, tenantId, source);
      const due = Math.max(0, money(settlement.planTotal - paid));
      if (serviceAmount > due + 0.009) throw new BadRequestException('Оплата превышает остаток к оплате');

      let canonicalPersonKey = ownerKey;
      if (personalAccountAmount > 0) {
        const availability = await personalAccountSpendAvailability(tx, tenantId, ownerKey, settlement.planTotal);
        const alreadyUsed = await this.personalAccountUsed(tx, tenantId, source);
        const totalLimit = money(settlement.planTotal * availability.spendLimitPercent / 100);
        const remainingLimit = Math.max(0, money(totalLimit - alreadyUsed));
        const allowed = Math.min(availability.balance, remainingLimit, due);
        if (personalAccountAmount > allowed + 0.009) {
          throw new BadRequestException(`С Личного счёта для этой операции доступно не более ${allowed}`);
        }
        canonicalPersonKey = availability.personKey;
      }

      const depositAllocations = await consumeDepositAllocations(tx, tenantId, requestedDepositAllocations, ownerKey, occurredAt);
      if (personalAccountAmount > 0) {
        await applyPersonalAccountMovement(tx, {
          eventId: `personal-account:${operationId}`,
          tenantId,
          personKey: canonicalPersonKey,
          kind: 'payment',
          direction: 'OUT',
          amount: personalAccountAmount,
          sourceType: source.type,
          sourceId: source.id,
          occurredAt,
          data: { operationId, workplace: text(input.workplace) },
        });
      }

      await this.saveSettlement(tx, tenantId, source, settlement);
      const components = splitCashComponents(allocations, cashServiceAmount, tips);
      await this.createOperation(tx, tenantId, {
        operationId,
        kind: 'payment',
        source,
        occurredAt,
        data: {
          workplace: text(input.workplace),
          person: { ...person, ...(canonicalPersonKey ? { key: canonicalPersonKey } : {}) },
          allocations,
          depositAllocations,
          personalAccountAmount,
          priceCondition: condition.source ? clone(condition.source) : null,
          cashTotal: cashAllocated,
          cashServiceAmount,
          total: money(serviceAmount + tips),
          serviceAmount,
          tips,
          settlement,
        },
        entries: components.map((entry) => ({
          ...entry,
          direction: 'IN',
          economicType: entry.component === 'tips' ? 'TIPS' : 'SERVICE_REVENUE',
        })),
      });

      remainingDue = Math.max(0, money(due - serviceAmount));
      if (input.finalizeDebt === true && ownerKey) {
        await syncPersonalAccountDebt(tx, {
          tenantId,
          personKey: canonicalPersonKey || ownerKey,
          sourceType: source.type,
          sourceId: source.id,
          outstandingAmount: remainingDue,
          occurredAt,
          data: { settlement, workplace: text(input.workplace), paymentOperationId: operationId },
        });
      }
    });

    const [operation, settlementRow] = await Promise.all([
      this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId } } }),
      this.prisma.financeSettlement.findUnique({
        where: { tenantId_sourceType_sourceId: { tenantId, sourceType: source.type, sourceId: source.id } },
      }),
    ]);
    if (!operation || !settlementRow) throw new NotFoundException('Оплата сохранена, но результат операции не найден');

    return {
      financePatch: {
        settlement: {
          source: { type: settlementRow.sourceType, id: settlementRow.sourceId },
          settlement: clone(settlementRow.data),
          recordedAt: settlementRow.createdAt.toISOString(),
          updatedAt: settlementRow.updatedAt.toISOString(),
        },
        operation: {
          operationId: operation.operationId,
          kind: operation.kind,
          status: operation.status,
          source: { type: operation.sourceType, id: operation.sourceId },
          originalOperationId: text(operation.originalOperationId),
          occurredAt: operation.occurredAt.toISOString(),
          recordedAt: operation.createdAt.toISOString(),
          data: clone(operation.data),
        },
      },
      payment: { due: remainingDue, state: remainingDue <= 0.009 ? 'paid' : 'partial' },
    };
  }

  async recordRefund(tenantId: string, operationIdValue: string, body: unknown) {
    const operationId = text(operationIdValue);
    const payment = await this.prisma.financeOperation.findUnique({
      where: { tenantId_operationId: { tenantId, operationId } },
    });
    if (!payment || payment.kind !== 'payment') throw new NotFoundException('Оплата не найдена');
    if (payment.status === 'cancelled') throw new BadRequestException('Отменённую оплату вернуть нельзя');

    const paymentData = objectValue(payment.data);
    const refunds = await this.prisma.financeOperation.findMany({
      where: { tenantId, kind: 'refund', originalOperationId: operationId, status: 'completed' },
    });
    const refundedTips = money(refunds.reduce((sum, row) => sum + money(objectValue(row.data).tips), 0));
    const refundedService = money(refunds.reduce((sum, row) => sum + money(objectValue(row.data).serviceAmount), 0));
    const tipsRemaining = Math.max(0, money(paymentData.tips - refundedTips));
    const serviceRemaining = Math.max(0, money(paymentData.serviceAmount - refundedService));
    const remaining = money(tipsRemaining + serviceRemaining);
    if (remaining <= 0.009) throw new BadRequestException('Оплата уже возвращена полностью');

    const input = objectValue(body);
    const requested = Math.min(remaining, money(input.amount == null ? remaining : input.amount));
    if (requested <= 0) throw new BadRequestException('Некорректная сумма возврата');
    const serviceAmount = Math.min(requested, serviceRemaining);
    const tips = Math.min(money(requested - serviceAmount), tipsRemaining);

    const originalDeposits = depositAllocationsValue(paymentData.depositAllocations);
    const restoredByDeposit = new Map<string, { amount: number; principalAmount: number; benefitAmount: number }>();
    for (const refund of refunds) {
      for (const allocation of depositAllocationsValue(objectValue(refund.data).depositAllocations)) {
        const previous = restoredByDeposit.get(allocation.depositId) || { amount: 0, principalAmount: 0, benefitAmount: 0 };
        restoredByDeposit.set(allocation.depositId, {
          amount: money(previous.amount + allocation.amount),
          principalAmount: money(previous.principalAmount + allocation.principalAmount),
          benefitAmount: money(previous.benefitAmount + allocation.benefitAmount),
        });
      }
    }

    let sourceLeft = serviceAmount;
    const restoredDeposits: JsonObject[] = [];
    for (const original of originalDeposits) {
      const previous = restoredByDeposit.get(original.depositId) || { amount: 0, principalAmount: 0, benefitAmount: 0 };
      const originalPrincipal = original.principalAmount || original.amount;
      const originalBenefit = original.benefitAmount;
      const principalAvailable = Math.max(0, money(originalPrincipal - previous.principalAmount));
      const benefitAvailable = Math.max(0, money(originalBenefit - previous.benefitAmount));
      const available = money(principalAvailable + benefitAvailable);
      const restore = Math.min(sourceLeft, available);
      const principalAmount = Math.min(restore, principalAvailable);
      const benefitAmount = Math.min(money(restore - principalAmount), benefitAvailable);
      if (restore > 0) restoredDeposits.push({ ...original, amount: restore, principalAmount, benefitAmount });
      sourceLeft = money(sourceLeft - restore);
      if (sourceLeft <= 0.009) break;
    }

    const originalPersonalAccount = money(paymentData.personalAccountAmount);
    const alreadyRestoredPersonalAccount = money(refunds.reduce((sum, row) => sum + money(objectValue(row.data).personalAccountRestored), 0));
    const personalAccountAvailable = Math.max(0, money(originalPersonalAccount - alreadyRestoredPersonalAccount));
    const personalAccountRestored = Math.min(sourceLeft, personalAccountAvailable);
    sourceLeft = money(sourceLeft - personalAccountRestored);

    const cashServiceAmount = sourceLeft;
    const cashRefund = money(cashServiceAmount + tips);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    if (cashRefund > 0.009 && !walletId) throw new BadRequestException('Не выбран кошелёк возврата');
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const refundId = randomUUID();
    const person = clone(objectValue(paymentData.person));
    const ownerKey = personKey(person);

    await this.serializable(async (tx) => {
      await restoreDepositAllocations(tx, tenantId, restoredDeposits, occurredAt);
      if (personalAccountRestored > 0) {
        if (!ownerKey) throw new BadRequestException('У оплаты отсутствует человек Личного счёта');
        await applyPersonalAccountMovement(tx, {
          eventId: `personal-account:${refundId}`,
          tenantId,
          personKey: ownerKey,
          kind: 'payment-refund',
          direction: 'IN',
          amount: personalAccountRestored,
          sourceType: payment.sourceType,
          sourceId: payment.sourceId,
          occurredAt,
          data: { operationId: refundId, originalOperationId: payment.operationId },
        });
      }

      await this.createOperation(tx, tenantId, {
        operationId: refundId,
        kind: 'refund',
        source: { type: payment.sourceType, id: payment.sourceId },
        originalOperationId: payment.operationId,
        occurredAt,
        data: {
          workplace: text(paymentData.workplace),
          person,
          walletId,
          walletName,
          total: money(serviceAmount + tips),
          cashTotal: cashRefund,
          cashServiceAmount,
          serviceAmount,
          tips,
          depositAllocations: restoredDeposits,
          personalAccountRestored,
          reason: text(input.reason),
          settlement: clone(objectValue(paymentData.settlement)),
        },
        entries: [
          ...(cashServiceAmount > 0 ? [{ walletId, walletName, amount: cashServiceAmount, component: 'service', direction: 'OUT', economicType: 'SERVICE_REFUND' }] : []),
          ...(tips > 0 ? [{ walletId, walletName, amount: tips, component: 'tips', direction: 'OUT', economicType: 'TIPS_REFUND' }] : []),
        ],
      });

      if (input.finalizeDebt === true && ownerKey) {
        const settlement = objectValue(paymentData.settlement);
        const net = await this.serviceNet(tx, tenantId, { type: payment.sourceType, id: payment.sourceId });
        const due = Math.max(0, money(settlement.planTotal - net));
        await syncPersonalAccountDebt(tx, {
          tenantId,
          personKey: ownerKey,
          sourceType: payment.sourceType,
          sourceId: payment.sourceId,
          outstandingAmount: due,
          occurredAt,
          data: { settlement, workplace: text(paymentData.workplace), refundOperationId: refundId },
        });
      }
    });

    return this.finance.snapshot(tenantId);
  }
}
