import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { calculateSettlement as calculateCanonicalSettlement } from '../../../core/finance/rules.js';
import { PrismaService } from '../prisma.service';
import { resolvePersonPricePercent } from '../loyalty/price-condition';
import {
  applyPersonalAccountMovement,
  updatePersonalAccountSettingsWith,
  personalAccountDebtById,
  personalAccountMoney,
  personalAccountSnapshot,
  personalAccountSpendAvailability,
  reducePersonalAccountDebt,
  syncPersonalAccountDebt,
} from '../loyalty/personal-account-state';

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

function text(value: unknown) {
  return String(value ?? '').trim();
}

function sourceValue(value: unknown): Source {
  const source = objectValue(value);
  return { type: text(source.type), id: text(source.id) };
}

function requiredOccurredAt(value: unknown) {
  const raw = text(value);
  if (!raw) throw new BadRequestException('Укажите фактическую дату и время операции');
  const date = value instanceof Date ? value : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new BadRequestException('Некорректная фактическая дата операции');
  return date;
}

function optionalOccurredAt(value: unknown, fallback = new Date()) {
  const raw = text(value);
  if (!raw) return fallback;
  const date = value instanceof Date ? value : new Date(raw);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

function isRetryableTransactionError(error: unknown) {
  const code = text(objectValue(error).code);
  return code === 'P2034' || code === '40001';
}

function settlementPlanTotal(value: unknown) {
  return personalAccountMoney(objectValue(value).planTotal);
}

@Injectable()
export class PersonalAccountFinanceService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['LoyaltyPersonalAccount', 'LoyaltyPersonalAccountMovement', 'LoyaltyPersonalAccountDebt']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['LoyaltyPersonalAccount', 'LoyaltyPersonalAccountMovement', 'LoyaltyPersonalAccountDebt'],before,after,checkOnly); }

  async importHistorical(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    const operationId=targetId || randomUUID();const personKey=text(input.personKey);
    const action=text(input.accountAction);const amount=personalAccountMoney(input.accountAmount);
    if (!personKey) throw new BadRequestException('Не удалось определить человека для личного счёта');
    if (input.spendLimitPercent!==undefined || input.visibleToEndUser!==undefined) await updatePersonalAccountSettingsWith(tx,tenantId,personKey,input);
    if (!action) return personKey;
    if (!input.occurredAt || amount<=0) throw new BadRequestException('Укажите дату и сумму операции личного счёта');
    const occurredAt=requiredOccurredAt(input.occurredAt);
    if (targetId && await tx.financeOperation.findUnique({where:{tenantId_operationId:{tenantId,operationId}}})) throw new BadRequestException('Операция личного счёта уже выполнена. Отмените её сеанс перед заменой суммы.');
    const source=input.recordId?{type:'record',id:text(input.recordId)}:{type:'personal-account',id:operationId};
    if(action==='Долг') { await syncPersonalAccountDebt(tx,{tenantId,personKey,sourceType:source.type,sourceId:source.id,outstandingAmount:amount,occurredAt,data:{note:text(input.note)}});return operationId; }
    let settledDebt: any=null;
    if(action==='Погашение долга') {
      const debts=await tx.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "LoyaltyPersonalAccountDebt" WHERE "tenantId"=${tenantId} AND "personKey"=${personKey} AND "outstandingAmount">0`;
      if(debts.length!==1)throw new BadRequestException('Не удалось однозначно определить задолженность');
      settledDebt=await personalAccountDebtById(tx,tenantId,debts[0].id,true);
      await reducePersonalAccountDebt(tx,tenantId,debts[0].id,amount,occurredAt);
    } else {
      const kinds:JsonObject={'Пополнение':['funding','IN'],'Возврат':['withdrawal','OUT'],'Оплата':['payment','OUT']};
      const kind=kinds[action];if(!kind)throw new BadRequestException('Неизвестная операция личного счёта');
      if(action==='Оплата'&&!input.recordId)throw new BadRequestException('Не удалось определить запись для оплаты личным счётом');
      await applyPersonalAccountMovement(tx,{eventId:`personal-account:${operationId}`,tenantId,personKey,kind:kind[0],direction:kind[1],amount,sourceType:source.type,sourceId:source.id,occurredAt,data:{operationId,note:text(input.note)}});
    }
    if(settledDebt){
      await this.createMoneyFact(tx,tenantId,{operationId,kind:'payment',sourceType:settledDebt.sourceType,sourceId:settledDebt.sourceId,occurredAt,walletId:input.walletId,walletName:input.walletName,direction:'IN',economicType:'SERVICE_REVENUE',amount,data:{debtId:settledDebt.id,debtPayment:true,personKey,person:{key:personKey},amount,walletId:input.walletId,walletName:input.walletName,allocations:[{walletId:input.walletId,walletName:input.walletName,amount}],cashTotal:amount,cashServiceAmount:amount,total:amount,serviceAmount:amount,tips:0}});
    } else if(action==='Оплата') {
      await tx.financeOperation.create({data:{tenantId,operationId,kind:'payment',status:'completed',sourceType:source.type,sourceId:source.id,occurredAt,data:{person:{key:personKey},serviceAmount:amount,total:amount,cashTotal:0,tips:0,personalAccountAmount:amount}}});
    } else {
      if(!text(input.walletId))throw new BadRequestException('Не указан кошелёк операции личного счёта');
      await this.createMoneyFact(tx,tenantId,{operationId,kind:action==='Пополнение'?'personal-account-funding':action==='Возврат'?'personal-account-withdrawal':'personal-account-debt-settlement',sourceType:'personal-account',sourceId:personKey,occurredAt,walletId:input.walletId,walletName:input.walletName,direction:action==='Возврат'?'OUT':'IN',economicType:action==='Возврат'?'PERSONAL_ACCOUNT_LIABILITY_OUT':'PERSONAL_ACCOUNT_LIABILITY_IN',amount,data:{personKey,amount,walletId:input.walletId,walletName:input.walletName,note:text(input.note)}});
    }
    return operationId;
  }

  constructor(private readonly prisma: PrismaService) {}

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

  private async createMoneyFact(tx: Prisma.TransactionClient, tenantId: string, input: {
    operationId: string;
    kind: string;
    sourceType: string;
    sourceId: string;
    occurredAt: Date;
    walletId: string;
    walletName: string;
    direction: 'IN' | 'OUT';
    economicType: string;
    amount: number;
    data: JsonObject;
  }) {
    const operation = await tx.financeOperation.create({
      data: {
        tenantId,
        operationId: input.operationId,
        kind: input.kind,
        status: 'completed',
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        occurredAt: input.occurredAt,
        data: input.data as Prisma.InputJsonValue,
      },
    });
    await tx.financeLedgerEntry.create({
      data: {
        tenantId,
        financeOperationId: operation.id,
        entryId: randomUUID(),
        walletId: input.walletId,
        direction: input.direction,
        economicType: input.economicType,
        amount: input.amount,
        occurredAt: input.occurredAt,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        data: {
          walletName: input.walletName,
          component: input.kind,
          personalAccount: true,
        } as Prisma.InputJsonValue,
      },
    });
    return operation;
  }

  private async settlementWith(
    tx: Prisma.TransactionClient,
    tenantId: string,
    source: Source,
    person: unknown,
    inputSettlement: unknown,
    occurredAt: Date,
  ) {
    const stored = await tx.financeSettlement.findUnique({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: source.type, sourceId: source.id } },
    });
    if (stored) return clone(objectValue(stored.data));

    const requested = objectValue(inputSettlement);
    const items = arrayValue(requested.items);
    if (!items.length) throw new BadRequestException('У оплаты отсутствует расчёт');
    const condition = await resolvePersonPricePercent(tx, tenantId, person, occurredAt);
    const settlement = calculateCanonicalSettlement(items, { pricePercent: condition.percent });
    await tx.financeSettlement.upsert({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: source.type, sourceId: source.id } },
      create: { tenantId, sourceType: source.type, sourceId: source.id, data: clone(settlement) as Prisma.InputJsonValue },
      update: { data: clone(settlement) as Prisma.InputJsonValue },
    });
    return clone(settlement);
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
    return personalAccountMoney(rows.reduce((sum, row) => {
      const data = objectValue(row.data);
      const amount = personalAccountMoney(data.serviceAmount);
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
    return personalAccountMoney(rows.reduce((sum, row) => {
      const data = objectValue(row.data);
      return sum + (row.kind === 'payment'
        ? personalAccountMoney(data.personalAccountAmount)
        : -personalAccountMoney(data.personalAccountRestored));
    }, 0));
  }

  async fund(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const personKey = text(input.personKey);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    const amount = personalAccountMoney(input.amount);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    if (!personKey) throw new BadRequestException('Не выбран человек');
    if (!walletId) throw new BadRequestException('Выберите кошелёк');
    if (amount <= 0) throw new BadRequestException('Введите сумму пополнения');
    const operationId = randomUUID();
    await this.serializable(async (tx) => {
      const movement = await applyPersonalAccountMovement(tx, {
        eventId: `personal-account:${operationId}`,
        tenantId,
        personKey,
        kind: 'funding',
        direction: 'IN',
        amount,
        sourceType: 'finance-operation',
        sourceId: operationId,
        occurredAt,
        data: { walletId, walletName, note: text(input.note), method: text(input.method), provider: text(input.provider), providerPaymentId: text(input.providerPaymentId) },
      });
      await this.createMoneyFact(tx, tenantId, {
        operationId,
        kind: 'personal-account-funding',
        sourceType: 'personal-account',
        sourceId: String((movement as any).personKey || personKey),
        occurredAt,
        walletId,
        walletName,
        direction: 'IN',
        economicType: 'PERSONAL_ACCOUNT_LIABILITY_IN',
        amount,
        data: {
          personKey: String((movement as any).personKey || personKey), amount, walletId, walletName,
          note: text(input.note), method: text(input.method), provider: text(input.provider), providerPaymentId: text(input.providerPaymentId),
        },
      });
    });
    return personalAccountSnapshot(this.prisma, tenantId, personKey);
  }

  async withdraw(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const personKey = text(input.personKey);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    const amount = personalAccountMoney(input.amount);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    if (!personKey) throw new BadRequestException('Не выбран человек');
    if (!walletId) throw new BadRequestException('Выберите кошелёк возврата');
    if (amount <= 0) throw new BadRequestException('Введите сумму возврата');
    const operationId = randomUUID();
    await this.serializable(async (tx) => {
      const movement = await applyPersonalAccountMovement(tx, {
        eventId: `personal-account:${operationId}`,
        tenantId,
        personKey,
        kind: 'withdrawal',
        direction: 'OUT',
        amount,
        sourceType: 'finance-operation',
        sourceId: operationId,
        occurredAt,
        data: { walletId, walletName, reason: text(input.reason), method: text(input.method), provider: text(input.provider), providerPaymentId: text(input.providerPaymentId) },
      });
      await this.createMoneyFact(tx, tenantId, {
        operationId,
        kind: 'personal-account-withdrawal',
        sourceType: 'personal-account',
        sourceId: String((movement as any).personKey || personKey),
        occurredAt,
        walletId,
        walletName,
        direction: 'OUT',
        economicType: 'PERSONAL_ACCOUNT_LIABILITY_OUT',
        amount,
        data: {
          personKey: String((movement as any).personKey || personKey), amount, walletId, walletName,
          reason: text(input.reason), method: text(input.method), provider: text(input.provider), providerPaymentId: text(input.providerPaymentId),
        },
      });
    });
    return personalAccountSnapshot(this.prisma, tenantId, personKey);
  }

  async pay(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const personKey = text(input.personKey);
    const source = sourceValue(input.source);
    const amount = personalAccountMoney(input.amount);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const person = { ...objectValue(input.person), key: personKey || text(objectValue(input.person).key) };
    if (!person.key) throw new BadRequestException('Не выбран человек');
    if (!source.type || !source.id) throw new BadRequestException('У оплаты отсутствует источник');
    if (amount <= 0) throw new BadRequestException('Введите сумму списания');

    let nextDue = 0;
    await this.serializable(async (tx) => {
      const settlement = await this.settlementWith(tx, tenantId, source, person, input.settlement, occurredAt);
      const planTotal = settlementPlanTotal(settlement);
      if (planTotal <= 0) throw new BadRequestException('У оплаты отсутствует сумма к оплате');
      const paid = await this.serviceNet(tx, tenantId, source);
      const due = Math.max(0, personalAccountMoney(planTotal - paid));
      if (amount > due + 0.009) throw new BadRequestException('Оплата превышает остаток к оплате');

      const availability = await personalAccountSpendAvailability(tx, tenantId, person.key, planTotal);
      const used = await this.personalAccountUsed(tx, tenantId, source);
      const fullLimit = personalAccountMoney(planTotal * availability.spendLimitPercent / 100);
      const remainingLimit = Math.max(0, personalAccountMoney(fullLimit - used));
      const allowed = Math.min(availability.balance, remainingLimit, due);
      if (amount > allowed + 0.009) throw new BadRequestException(`С Личного счёта для этой операции доступно не более ${allowed}`);

      const operationId = randomUUID();
      const movement = await applyPersonalAccountMovement(tx, {
        eventId: `personal-account:${operationId}`,
        tenantId,
        personKey: person.key,
        kind: 'payment',
        direction: 'OUT',
        amount,
        sourceType: source.type,
        sourceId: source.id,
        occurredAt,
        data: { operationId, workplace: text(input.workplace) },
      });
      await tx.financeOperation.create({
        data: {
          tenantId,
          operationId,
          kind: 'payment',
          status: 'completed',
          sourceType: source.type,
          sourceId: source.id,
          occurredAt,
          data: {
            workplace: text(input.workplace),
            person: { ...person, key: String((movement as any).personKey || person.key) },
            allocations: [],
            depositAllocations: [],
            personalAccountAmount: amount,
            cashTotal: 0,
            cashServiceAmount: 0,
            total: amount,
            serviceAmount: amount,
            tips: 0,
            settlement,
          } as Prisma.InputJsonValue,
        },
      });
      nextDue = Math.max(0, personalAccountMoney(due - amount));
    });
    return {
      account: await personalAccountSnapshot(this.prisma, tenantId, person.key),
      payment: { due: nextDue, state: nextDue <= 0.009 ? 'paid' : 'partial' },
    };
  }

  async refundPayment(tenantId: string, paymentOperationIdValue: unknown, body: unknown) {
    const paymentOperationId = text(paymentOperationIdValue);
    const input = objectValue(body);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const payment = await this.prisma.financeOperation.findUnique({
      where: { tenantId_operationId: { tenantId, operationId: paymentOperationId } },
    });
    if (!payment || payment.kind !== 'payment' || payment.status !== 'completed') throw new NotFoundException('Оплата не найдена');
    const paymentData = objectValue(payment.data);
    const original = personalAccountMoney(paymentData.personalAccountAmount);
    if (original <= 0) throw new BadRequestException('Эта оплата не использовала Личный счёт');
    const refunds = await this.prisma.financeOperation.findMany({
      where: { tenantId, kind: 'refund', originalOperationId: paymentOperationId, status: 'completed' },
      select: { data: true },
    });
    const restored = personalAccountMoney(refunds.reduce((sum, row) => sum + personalAccountMoney(objectValue(row.data).personalAccountRestored), 0));
    const remaining = Math.max(0, personalAccountMoney(original - restored));
    const amount = Math.min(remaining, personalAccountMoney(input.amount == null ? remaining : input.amount));
    if (amount <= 0) throw new BadRequestException('Оплата уже возвращена полностью');
    const person = objectValue(paymentData.person);
    const personKey = text(person.key || person.personKey || person.id);
    if (!personKey) throw new BadRequestException('У оплаты отсутствует человек');
    const refundId = randomUUID();
    await this.serializable(async (tx) => {
      await applyPersonalAccountMovement(tx, {
        eventId: `personal-account:${refundId}`,
        tenantId,
        personKey,
        kind: 'refund',
        direction: 'IN',
        amount,
        sourceType: payment.sourceType,
        sourceId: payment.sourceId,
        occurredAt,
        data: { paymentOperationId, reason: text(input.reason) },
      });
      await tx.financeOperation.create({
        data: {
          tenantId,
          operationId: refundId,
          kind: 'refund',
          status: 'completed',
          sourceType: payment.sourceType,
          sourceId: payment.sourceId,
          originalOperationId: paymentOperationId,
          occurredAt,
          data: {
            workplace: text(paymentData.workplace), person: clone(person),
            total: amount, serviceAmount: amount, tips: 0,
            personalAccountRestored: amount,
            reason: text(input.reason), settlement: clone(objectValue(paymentData.settlement)),
          } as Prisma.InputJsonValue,
        },
      });
    });
    return personalAccountSnapshot(this.prisma, tenantId, personKey);
  }

  async finalizeDebt(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const personKey = text(input.personKey);
    const source = sourceValue(input.source);
    if (!personKey) throw new BadRequestException('Не выбран человек');
    if (!source.type || !source.id) throw new BadRequestException('У задолженности отсутствует источник');
    let due = 0;
    await this.serializable(async (tx) => {
      const stored = await tx.financeSettlement.findUnique({
        where: { tenantId_sourceType_sourceId: { tenantId, sourceType: source.type, sourceId: source.id } },
      });
      if (!stored) throw new BadRequestException('У операции отсутствует расчёт');
      const settlement = objectValue(stored.data);
      const total = settlementPlanTotal(settlement);
      const paid = await this.serviceNet(tx, tenantId, source);
      due = Math.max(0, personalAccountMoney(total - paid));
      await syncPersonalAccountDebt(tx, {
        tenantId,
        personKey,
        sourceType: source.type,
        sourceId: source.id,
        outstandingAmount: due,
        occurredAt: optionalOccurredAt(input.sourceOccurredAt, optionalOccurredAt(input.occurredAt)),
        data: { settlement: clone(settlement), workplace: text(input.workplace) },
      });
    });
    return {
      account: await personalAccountSnapshot(this.prisma, tenantId, personKey),
      debt: { outstandingAmount: due, state: due <= 0.009 ? 'closed' : 'open' },
    };
  }

  async settleDebt(tenantId: string, debtIdValue: unknown, body: unknown) {
    const input = objectValue(body);
    const debtId = text(debtIdValue);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    const amount = personalAccountMoney(input.amount);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    if (!debtId) throw new BadRequestException('Задолженность не выбрана');
    if (!walletId) throw new BadRequestException('Выберите кошелёк');
    if (amount <= 0) throw new BadRequestException('Введите сумму оплаты');
    let personKey = '';
    await this.serializable(async (tx) => {
      const debt = await personalAccountDebtById(tx, tenantId, debtId, true);
      if (!debt) throw new BadRequestException('Задолженность не найдена');
      personKey = debt.personKey;
      const operationId = randomUUID();
      await reducePersonalAccountDebt(tx, tenantId, debtId, amount, occurredAt);
      await this.createMoneyFact(tx, tenantId, {
        operationId,
        kind: 'payment',
        sourceType: debt.sourceType,
        sourceId: debt.sourceId,
        occurredAt,
        walletId,
        walletName,
        direction: 'IN',
        economicType: 'SERVICE_REVENUE',
        amount,
        data: {
          debtId, debtPayment: true, personKey, person: { key: personKey }, amount,
          walletId, walletName, allocations: [{ walletId, walletName, amount }],
          cashTotal: amount, cashServiceAmount: amount, total: amount, serviceAmount: amount, tips: 0,
          originalSourceType: debt.sourceType, originalSourceId: debt.sourceId,
          note: text(input.note), method: text(input.method), provider: text(input.provider), providerPaymentId: text(input.providerPaymentId),
        },
      });
    });
    return personalAccountSnapshot(this.prisma, tenantId, personKey);
  }
}
