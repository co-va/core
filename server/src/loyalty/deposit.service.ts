import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { FinanceService } from '../finance/finance.service';
import {
  depositBenefitMode,
  depositBenefitRate,
  depositTermActiveAt,
  expireDepositInstances,
} from './deposit-state';

type JsonObject = Record<string, any>;
type DepositRow = {
  id: string;
  depositId: string;
  programId: string;
  programName: string;
  personKey: string;
  person: unknown;
  terms: unknown;
  initialAmount: Prisma.Decimal;
  principalBalance: Prisma.Decimal;
  benefitBalance: Prisma.Decimal;
  balance: Prisma.Decimal;
  status: string;
  fundedAt: Date;
  fundingOperationId: string;
  createdAt: Date;
  updatedAt: Date;
};

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

function numberValue(value: unknown) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function money(value: unknown) {
  return Math.round(Math.max(0, numberValue(value)) * 100) / 100;
}

function signedMoney(value: unknown) {
  const number = numberValue(value);
  return Math.round(number * 100) / 100;
}

function requiredOccurredAt(value: unknown) {
  const raw = text(value);
  if (!raw) throw new BadRequestException('Укажите фактическую дату и время операции');
  const date = value instanceof Date ? value : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Некорректная фактическая дата операции');
  return date;
}

function depositAllocations(value: unknown) {
  return arrayValue(value)
    .map((entry) => {
      const row = objectValue(entry);
      return {
        depositId: text(row.depositId ?? row.sourceId ?? row.id),
        amount: money(row.amount),
      };
    })
    .filter((entry) => entry.depositId && entry.amount > 0);
}

function allocationFor(value: unknown, depositId: string) {
  return money(depositAllocations(value)
    .filter((entry) => entry.depositId === depositId)
    .reduce((sum, entry) => sum + entry.amount, 0));
}

@Injectable()
export class DepositService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: FinanceService,
  ) {}

  private async rows(tenantId: string, personKeyValue = '') {
    await expireDepositInstances(this.prisma, tenantId);
    await this.ensureCardSequences(tenantId);
    return this.prisma.loyaltyDepositInstance.findMany({
      where: { tenantId, ...(personKeyValue ? { personKey: personKeyValue } : {}) },
      orderBy: [{ fundedAt: 'desc' }, { createdAt: 'desc' }],
    });
  }

  private async ensureCardSequences(tenantId: string) {
    const rows = await this.prisma.loyaltyDepositInstance.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { depositId: 'asc' }],
    });
    const counters = new Map<string, number>();
    for (const row of rows) {
      const terms = objectValue(row.terms);
      const existing = Math.max(0, Math.trunc(numberValue(terms.cardSequence)));
      if (existing > 0) counters.set(row.programId, Math.max(counters.get(row.programId) || 0, existing));
    }
    for (const row of rows) {
      const terms = objectValue(row.terms);
      if (Math.max(0, Math.trunc(numberValue(terms.cardSequence))) > 0) continue;
      const next = (counters.get(row.programId) || 0) + 1;
      counters.set(row.programId, next);
      await this.prisma.loyaltyDepositInstance.update({
        where: { id: row.id },
        data: { terms: { ...clone(terms), cardSequence: next } as Prisma.InputJsonValue },
      });
    }
  }

  private async operations(tenantId: string) {
    return this.prisma.financeOperation.findMany({
      where: { tenantId, kind: { in: ['deposit-funding', 'deposit-withdrawal', 'payment', 'refund'] } },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private history(row: DepositRow, operations: any[]) {
    const id = row.depositId;
    const terms = objectValue(row.terms);
    const mode = depositBenefitMode(terms);
    const rate = depositBenefitRate(terms);
    const items: JsonObject[] = [];

    for (const operation of operations) {
      if (!operation || operation.status !== 'completed') continue;
      const data = objectValue(operation.data);
      const occurredAt = operation.occurredAt instanceof Date ? operation.occurredAt : new Date(operation.occurredAt);

      if (operation.kind === 'deposit-funding' && operation.sourceType === 'deposit' && operation.sourceId === id) {
        const amount = money(data.amount ?? data.total);
        if (amount > 0) items.push({
          operationId: operation.operationId,
          kind: 'deposit-funding', amount, direction: 'IN',
          occurredAt: occurredAt.toISOString(), status: operation.status,
          walletId: text(data.walletId), walletName: text(data.walletName),
          source: { type: operation.sourceType, id: operation.sourceId },
        });
        if (mode === 'accrual' && rate > 0) {
          const gain = money(amount * rate / 100);
          if (gain > 0) items.push({
            operationId: `${operation.operationId}:benefit`,
            kind: 'deposit-benefit', amount: gain, direction: 'IN',
            occurredAt: occurredAt.toISOString(), status: operation.status,
            source: { type: 'deposit', id },
          });
        }
        continue;
      }

      if (operation.kind === 'deposit-withdrawal' && operation.sourceType === 'deposit' && operation.sourceId === id) {
        const amount = money(data.amount ?? data.total);
        if (amount > 0) items.push({
          operationId: operation.operationId,
          kind: 'deposit-withdrawal', amount, direction: 'OUT',
          occurredAt: occurredAt.toISOString(), status: operation.status,
          source: { type: operation.sourceType, id: operation.sourceId },
        });
        continue;
      }

      if (operation.kind === 'payment') {
        const used = allocationFor(data.depositAllocations, id);
        if (used > 0) items.push({
          operationId: operation.operationId,
          kind: 'payment', amount: used, direction: 'OUT',
          occurredAt: occurredAt.toISOString(), status: operation.status,
          source: { type: operation.sourceType, id: operation.sourceId },
        });
        continue;
      }

      if (operation.kind === 'refund') {
        const restored = allocationFor(data.depositAllocations, id);
        if (restored > 0) items.push({
          operationId: operation.operationId,
          kind: 'refund', amount: restored, direction: 'IN',
          occurredAt: occurredAt.toISOString(), status: operation.status,
          source: { type: operation.sourceType, id: operation.sourceId },
        });
      }
    }

    return items.sort((left, right) => String(left.occurredAt).localeCompare(String(right.occurredAt)));
  }

  private dto(row: DepositRow, operations: any[]) {
    const principalBalance = money(row.principalBalance);
    const benefitBalance = money(row.benefitBalance);
    const balance = money(row.balance);
    const terms = objectValue(row.terms);
    const mode = depositBenefitMode(terms);
    const presentation = objectValue(terms.presentation);
    return {
      depositId: row.depositId,
      programId: row.programId,
      programName: row.programName,
      person: objectValue(row.person),
      cardSequence: Math.max(0, Math.trunc(numberValue(terms.cardSequence))),
      visibleToPersonOverride: typeof presentation.visibleToPerson === 'boolean' ? presentation.visibleToPerson : null,
      fundedAmount: money(row.initialAmount),
      principalBalance,
      benefitBalance,
      refundableAmount: row.status === 'active' ? principalBalance : 0,
      balance,
      terms,
      benefitMode: mode,
      discountPercent: mode === 'discount' && row.status === 'active' && depositTermActiveAt(terms, new Date()) ? depositBenefitRate(terms) : 0,
      status: row.status,
      canRefund: row.status === 'active' && principalBalance > 0.009 && depositTermActiveAt(terms, new Date()),
      fundedAt: row.fundedAt.toISOString(),
      fundingOperationId: row.fundingOperationId,
      history: this.history(row, operations),
    };
  }

  async list(tenantId: string, personKeyValue = '') {
    const [rows, operations] = await Promise.all([
      this.rows(tenantId, text(personKeyValue)),
      this.operations(tenantId),
    ]);
    return rows.map((row) => this.dto(row as DepositRow, operations));
  }

  async get(tenantId: string, depositId: string) {
    const id = text(depositId);
    await expireDepositInstances(this.prisma, tenantId, id);
    await this.ensureCardSequences(tenantId);
    const row = await this.prisma.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: id } },
    });
    if (!row) throw new NotFoundException('Депозит не найден');
    return this.dto(row as DepositRow, await this.operations(tenantId));
  }

  async fund(tenantId: string, body: unknown) {
    const result = await this.finance.recordDepositFunding(tenantId, body);
    const depositId = text(objectValue(result).depositId);
    if (!depositId) throw new NotFoundException('Созданный депозит не найден');
    await this.ensureCardSequences(tenantId);
    return this.get(tenantId, depositId);
  }

  private assertFundingTarget(row: DepositRow, nextFundedAmount: number) {
    const terms = objectValue(row.terms);
    const target = money(terms.amount);
    const fixed = text(terms.amountMode) === 'fixed' || (!text(terms.amountMode) && target > 0);
    if (fixed && target > 0 && nextFundedAmount > target + 0.009) {
      throw new BadRequestException(`По этой программе можно внести не более ${target}`);
    }
  }

  private fundingBenefit(terms: JsonObject, amount: number) {
    return depositBenefitMode(terms) === 'accrual'
      ? money(amount * depositBenefitRate(terms) / 100)
      : 0;
  }

  private async createFundingOperation(
    tx: Prisma.TransactionClient,
    tenantId: string,
    row: DepositRow,
    operationId: string,
    amount: number,
    walletId: string,
    walletName: string,
    occurredAt: Date,
  ) {
    const data = {
      depositId: row.depositId,
      programId: row.programId,
      programName: row.programName || 'Депозит',
      person: clone(objectValue(row.person)),
      amount,
      total: amount,
      walletId,
      walletName,
      terms: clone(objectValue(row.terms)),
    };
    const operation = await tx.financeOperation.create({
      data: {
        tenantId,
        operationId,
        kind: 'deposit-funding',
        status: 'completed',
        sourceType: 'deposit',
        sourceId: row.depositId,
        originalOperationId: '',
        occurredAt,
        data: data as Prisma.InputJsonValue,
      },
    });
    await tx.financeLedgerEntry.create({
      data: {
        tenantId,
        financeOperationId: operation.id,
        entryId: randomUUID(),
        walletId,
        direction: 'IN',
        economicType: 'DEPOSIT_RECEIVED',
        amount,
        occurredAt,
        sourceType: 'deposit',
        sourceId: row.depositId,
        data: {
          walletName,
          component: 'deposit-funding',
          relatedOperationId: '',
          articleId: '',
          articleName: '',
          lineName: row.programName || 'Депозит',
          quantity: null,
          unitPrice: null,
          note: row.personKey,
        } as Prisma.InputJsonValue,
      },
    });
  }

  async fundExisting(tenantId: string, depositId: string, body: unknown) {
    const id = text(depositId);
    const input = objectValue(body);
    const amount = money(input.amount);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    if (!id) throw new BadRequestException('Депозит не найден');
    if (amount <= 0) throw new BadRequestException('Введите сумму пополнения');
    if (!walletId) throw new BadRequestException('Выберите кошелёк, куда приняты деньги');
    const operationId = randomUUID();

    await this.prisma.$transaction(async (tx) => {
      await expireDepositInstances(tx, tenantId, id);
      const row = await tx.loyaltyDepositInstance.findUnique({
        where: { tenantId_depositId: { tenantId, depositId: id } },
      }) as DepositRow | null;
      if (!row) throw new NotFoundException('Депозит не найден');
      if (row.status !== 'active' || !depositTermActiveAt(row.terms, occurredAt)) {
        throw new BadRequestException('Этот депозит сейчас нельзя пополнить');
      }
      const nextFunded = money(money(row.initialAmount) + amount);
      this.assertFundingTarget(row, nextFunded);
      const terms = objectValue(row.terms);
      const benefit = this.fundingBenefit(terms, amount);
      await tx.loyaltyDepositInstance.update({
        where: { id: row.id },
        data: {
          initialAmount: nextFunded,
          principalBalance: money(money(row.principalBalance) + amount),
          benefitBalance: money(money(row.benefitBalance) + benefit),
          balance: money(money(row.balance) + amount + benefit),
          status: 'active',
        },
      });
      await this.createFundingOperation(tx, tenantId, row, operationId, amount, walletId, walletName, occurredAt);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return this.get(tenantId, id);
  }

  private async fundingOperation(tx: Prisma.TransactionClient, tenantId: string, depositId: string, operationId: string) {
    const operation = await tx.financeOperation.findUnique({
      where: { tenantId_operationId: { tenantId, operationId } },
      include: { ledgerEntries: true },
    });
    if (!operation || operation.kind !== 'deposit-funding' || operation.sourceType !== 'deposit' || operation.sourceId !== depositId) {
      throw new NotFoundException('Внесение не найдено');
    }
    return operation;
  }

  private async syncFundingHead(tx: Prisma.TransactionClient, tenantId: string, depositId: string) {
    const first = await tx.financeOperation.findFirst({
      where: { tenantId, kind: 'deposit-funding', sourceType: 'deposit', sourceId: depositId, status: 'completed' },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });
    if (!first) return;
    await tx.loyaltyDepositInstance.update({
      where: { tenantId_depositId: { tenantId, depositId } },
      data: { fundedAt: first.occurredAt, fundingOperationId: first.operationId },
    });
  }

  async correctFunding(tenantId: string, depositId: string, operationId: string, body: unknown) {
    const id = text(depositId);
    const input = objectValue(body);
    const nextAmount = money(input.amount);
    const nextWalletId = text(input.walletId);
    const nextWalletName = text(input.walletName);
    const nextOccurredAt = requiredOccurredAt(input.occurredAt);
    if (nextAmount <= 0) throw new BadRequestException('Введите сумму внесения');
    if (!nextWalletId) throw new BadRequestException('Выберите кошелёк, куда приняты деньги');

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.loyaltyDepositInstance.findUnique({
        where: { tenantId_depositId: { tenantId, depositId: id } },
      }) as DepositRow | null;
      if (!row) throw new NotFoundException('Депозит не найден');
      const operation = await this.fundingOperation(tx, tenantId, id, text(operationId));
      const previous = objectValue(operation.data);
      const previousAmount = money(previous.amount ?? previous.total);
      const delta = signedMoney(nextAmount - previousAmount);
      const terms = objectValue(row.terms);
      const benefitDelta = depositBenefitMode(terms) === 'accrual'
        ? signedMoney(delta * depositBenefitRate(terms) / 100)
        : 0;
      const nextFunded = signedMoney(money(row.initialAmount) + delta);
      const nextPrincipal = signedMoney(money(row.principalBalance) + delta);
      const nextBenefit = signedMoney(money(row.benefitBalance) + benefitDelta);
      const nextBalance = signedMoney(money(row.balance) + delta + benefitDelta);
      if (nextFunded <= 0 || nextPrincipal < -0.009 || nextBenefit < -0.009 || nextBalance < -0.009) {
        throw new BadRequestException('Это внесение уже частично использовано. Для полной отмены удалите карту целиком.');
      }
      this.assertFundingTarget(row, nextFunded);
      await tx.loyaltyDepositInstance.update({
        where: { id: row.id },
        data: {
          initialAmount: money(nextFunded),
          principalBalance: money(nextPrincipal),
          benefitBalance: money(nextBenefit),
          balance: money(nextBalance),
        },
      });
      await tx.financeLedgerEntry.deleteMany({ where: { tenantId, financeOperationId: operation.id } });
      await tx.financeOperation.update({
        where: { id: operation.id },
        data: {
          occurredAt: nextOccurredAt,
          data: {
            ...clone(previous), amount: nextAmount, total: nextAmount,
            walletId: nextWalletId, walletName: nextWalletName,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.financeLedgerEntry.create({
        data: {
          tenantId,
          financeOperationId: operation.id,
          entryId: randomUUID(),
          walletId: nextWalletId,
          direction: 'IN',
          economicType: 'DEPOSIT_RECEIVED',
          amount: nextAmount,
          occurredAt: nextOccurredAt,
          sourceType: 'deposit',
          sourceId: id,
          data: {
            walletName: nextWalletName, component: 'deposit-funding', relatedOperationId: '',
            articleId: '', articleName: '', lineName: row.programName || 'Депозит', quantity: null, unitPrice: null, note: row.personKey,
          } as Prisma.InputJsonValue,
        },
      });
      await this.syncFundingHead(tx, tenantId, id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.get(tenantId, id);
  }

  async deleteFunding(tenantId: string, depositId: string, operationId: string) {
    const id = text(depositId);
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.loyaltyDepositInstance.findUnique({
        where: { tenantId_depositId: { tenantId, depositId: id } },
      }) as DepositRow | null;
      if (!row) throw new NotFoundException('Депозит не найден');
      const operation = await this.fundingOperation(tx, tenantId, id, text(operationId));
      const fundingCount = await tx.financeOperation.count({
        where: { tenantId, kind: 'deposit-funding', sourceType: 'deposit', sourceId: id, status: 'completed' },
      });
      if (fundingCount <= 1) throw new BadRequestException('Последнее внесение удаляется вместе с картой депозита');
      const data = objectValue(operation.data);
      const amount = money(data.amount ?? data.total);
      const terms = objectValue(row.terms);
      const benefit = this.fundingBenefit(terms, amount);
      const nextFunded = signedMoney(money(row.initialAmount) - amount);
      const nextPrincipal = signedMoney(money(row.principalBalance) - amount);
      const nextBenefit = signedMoney(money(row.benefitBalance) - benefit);
      const nextBalance = signedMoney(money(row.balance) - amount - benefit);
      if (nextPrincipal < -0.009 || nextBenefit < -0.009 || nextBalance < -0.009) {
        throw new BadRequestException('Это внесение уже частично использовано. Для полной отмены удалите карту целиком.');
      }
      await tx.loyaltyDepositInstance.update({
        where: { id: row.id },
        data: {
          initialAmount: money(nextFunded), principalBalance: money(nextPrincipal),
          benefitBalance: money(nextBenefit), balance: money(nextBalance),
        },
      });
      await tx.financeLedgerEntry.deleteMany({ where: { tenantId, financeOperationId: operation.id } });
      await tx.financeOperation.delete({ where: { id: operation.id } });
      await this.syncFundingHead(tx, tenantId, id);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.get(tenantId, id);
  }

  async updateSettings(tenantId: string, depositId: string, body: unknown) {
    const id = text(depositId);
    const input = objectValue(body);
    const row = await this.prisma.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: id } },
    });
    if (!row) throw new NotFoundException('Депозит не найден');
    const terms = objectValue(row.terms);
    const presentation = objectValue(terms.presentation);
    const nextPresentation = { ...clone(presentation) };
    if (input.visibleToPerson === null) delete nextPresentation.visibleToPerson;
    else if (typeof input.visibleToPerson === 'boolean') nextPresentation.visibleToPerson = input.visibleToPerson;
    await this.prisma.loyaltyDepositInstance.update({
      where: { id: row.id },
      data: { terms: { ...clone(terms), presentation: nextPresentation } as Prisma.InputJsonValue },
    });
    return this.get(tenantId, id);
  }

  async withdraw(tenantId: string, depositId: string, body: unknown) {
    const id = text(depositId);
    const current = await this.get(tenantId, id);
    if (!current.canRefund || current.refundableAmount <= 0.009) {
      throw new BadRequestException(current.status === 'expired'
        ? 'Срок депозита закончился. Возврат после окончания срока недоступен.'
        : 'У депозита нет реальных денег к возврату');
    }
    const input = objectValue(body);
    await this.finance.recordDepositWithdrawal(tenantId, id, {
      ...input,
      amount: current.refundableAmount,
    });
    return this.get(tenantId, id);
  }

  private async hardDeleteWith(tx: Prisma.TransactionClient, tenantId: string, depositId: string) {
    const id = text(depositId);
    if (!id) return;

    const row = await tx.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: id } },
    });
    if (!row) return;

    const operations = await tx.financeOperation.findMany({
      where: { tenantId, kind: { in: ['payment', 'refund'] } },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
    });

    for (const operation of operations) {
      const data = objectValue(operation.data);
      const allocations = arrayValue(data.depositAllocations).map((value) => clone(objectValue(value)));
      const removed = money(allocations.reduce((sum, allocation) => {
        const allocationId = text(allocation.depositId ?? allocation.sourceId ?? allocation.id);
        return sum + (allocationId === id ? money(allocation.amount) : 0);
      }, 0));
      if (removed <= 0.009) continue;

      const nextAllocations = allocations.filter((allocation) => text(allocation.depositId ?? allocation.sourceId ?? allocation.id) !== id);
      const nextService = Math.max(0, money(money(data.serviceAmount) - removed));
      const tips = money(data.tips);
      const nextData = {
        ...clone(data),
        depositAllocations: nextAllocations,
        serviceAmount: nextService,
        total: money(nextService + tips),
      };

      if (money(nextData.total) <= 0.009 && money(data.cashTotal) <= 0.009) {
        await tx.financeOperation.delete({ where: { id: operation.id } });
      } else {
        await tx.financeOperation.update({ where: { id: operation.id }, data: { data: nextData as Prisma.InputJsonValue } });
      }
    }

    await tx.financeOperation.deleteMany({
      where: {
        tenantId,
        sourceType: 'deposit',
        sourceId: id,
        kind: { in: ['deposit-funding', 'deposit-withdrawal'] },
      },
    });
    await tx.loyaltyDepositInstance.delete({ where: { id: row.id } });
  }

  async hardDelete(tenantId: string, depositId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.hardDeleteWith(tx, tenantId, depositId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { deleted: true, depositId: text(depositId) };
  }

  async hardDeleteProgram(tenantId: string, programId: string) {
    const id = text(programId);
    if (!id) throw new BadRequestException('Депозитная программа не найдена');
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.loyaltyDepositInstance.findMany({
        where: { tenantId, programId: id },
        orderBy: { createdAt: 'asc' },
        select: { depositId: true },
      });
      for (const row of rows) await this.hardDeleteWith(tx, tenantId, row.depositId);
      await tx.loyaltyDepositProgram.deleteMany({ where: { tenantId, programId: id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { deleted: true, programId: id };
  }
}
