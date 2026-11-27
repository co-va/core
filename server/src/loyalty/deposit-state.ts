import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { depositHistoricalLedger } from './deposit-history';

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

// Price-condition benefit is a non-cash fact. Keep the existing net allocation
// contract: gross charge minus conditional benefit equals the actual payment.
export function depositDiscountForPayment(conditionValue: unknown, settlementValue: unknown, netValue: unknown, paidBeforeValue: unknown = 0) {
  const condition = objectValue(conditionValue);
  const settlement = objectValue(settlementValue);
  const depositId = text(condition.depositId);
  if (condition.programType !== 'deposit' || !depositId) return null;
  const netAmount = depositMoney(netValue);
  const total = depositMoney(settlement.planTotal);
  const benefit = depositMoney(settlement.pricePercentTotal);
  if (!total || !netAmount || !benefit) return null;
  const before = Math.min(total, depositMoney(paidBeforeValue));
  const after = Math.min(total, depositMoney(before + netAmount));
  const benefitAmount = depositMoney(depositMoney(benefit * after / total) - depositMoney(benefit * before / total));
  return { depositId, netAmount, benefitAmount, grossAmount: depositMoney(netAmount + benefitAmount),
    articleId: 'system-deposit-benefit-granted', articleName: 'Предоставление выгоды по депозиту' };
}

export function savedDepositDiscount(dataValue: unknown) {
  const data = objectValue(dataValue);
  const saved = objectValue(data.depositDiscount);
  if (text(saved.depositId)) {
    const netAmount = depositMoney(saved.netAmount);
    const benefitAmount = depositMoney(saved.benefitAmount);
    return { depositId: text(saved.depositId), netAmount, benefitAmount, grossAmount: depositMoney(netAmount + benefitAmount),
      articleId: 'system-deposit-benefit-granted', articleName: 'Предоставление выгоды по депозиту' };
  }
  // Old native payments already carry the server-selected source and settlement.
  // Never infer an assignment from an imported discount without a source ID.
  return depositDiscountForPayment(data.priceCondition, data.settlement, data.serviceAmount);
}

export function depositDiscountForRefund(paymentData: unknown, netValue: unknown, refundedBeforeValue: unknown = 0) {
  const original = savedDepositDiscount(paymentData);
  if (!original || !original.netAmount) return null;
  const before = Math.min(original.netAmount, depositMoney(refundedBeforeValue));
  const netAmount = Math.min(depositMoney(netValue), depositMoney(original.netAmount - before));
  if (!netAmount) return null;
  const after = depositMoney(before + netAmount);
  const benefitAmount = depositMoney(depositMoney(original.benefitAmount * after / original.netAmount)
    - depositMoney(original.benefitAmount * before / original.netAmount));
  return { depositId: original.depositId, netAmount, benefitAmount, grossAmount: depositMoney(netAmount + benefitAmount),
    articleId: 'system-deposit-benefit-reversed', articleName: 'Аннулирование выгоды по депозиту' };
}

export function depositConditionalBenefit(operations: unknown, depositId: string) {
  const rows = Array.isArray(operations) ? operations.filter(row => row?.status === 'completed') : [];
  const refunds = new Map<string, number>();
  for (const row of rows) {
    if (row.kind !== 'refund') continue;
    const id = text(row.originalOperationId);
    if (!id) continue;
    refunds.set(id, depositMoney((refunds.get(id) || 0) + depositMoney(objectValue(row.data).serviceAmount)));
  }
  let benefit = 0;
  for (const row of rows) {
    if (row.kind !== 'payment') continue;
    const discount = savedDepositDiscount(row.data);
    if (!discount || discount.depositId !== depositId) continue;
    const reversed = depositDiscountForRefund(row.data, refunds.get(text(row.operationId)) || 0);
    benefit = depositMoney(benefit + Math.max(0, discount.benefitAmount - (reversed?.benefitAmount || 0)));
  }
  return benefit;
}

// Canonical real/benefit view of discount deposits. The existing materialized
// balance and allocations remain the NET spendability contract; the two
// components below are replayed from immutable facts (including old payments).
// Never put conditional benefit movements in the physical wallet ledger.
export function depositDiscountAccounting(operations: unknown, depositId: string) {
  const rows = (Array.isArray(operations) ? operations : []).filter(row => row?.status === 'completed')
    .slice().sort((a,b) => new Date(a.occurredAt || 0).getTime() - new Date(b.occurredAt || 0).getTime()
      || new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const signed = (v:number) => Math.round(v * 100) / 100;
  const entries = new Map<string, { depositId:string; netAmount:number; grossAmount:number; realDelta:number;
    benefitDelta:number; benefitGranted:number; benefitUsed:number; benefitRestored:number; benefitReversed:number;
    realAfter:number; benefitAfter:number; articleId:string; articleName:string }>();
  const returned = new Map<string,number>();
  const balances=new Map<string,{realBalance:number;benefitBalance:number}>();
  let real=0, bonus=0, creditNet=0, hasFunding=false, complete=true, withdrawn=false;
  for (const row of rows) {
    const data=objectValue(row.data), id=text(row.operationId);
    const own=row.sourceType==='deposit' && text(row.sourceId)===depositId;
    if (row.kind==='deposit-funding' && own) {
      if (withdrawn) complete=false;
      real=signed(real+depositMoney(data.amount ?? data.total)); hasFunding=true;
      if(id)balances.set(id,{realBalance:real,benefitBalance:bonus});
      continue;
    }
    if (row.kind==='deposit-withdrawal' && own) { real=0; bonus=0; withdrawn=true; if(id)balances.set(id,{realBalance:0,benefitBalance:0}); continue; }
    if (!['payment','refund','deposit-import-spend'].includes(row.kind)) continue;
    const allocations=Array.isArray(data.depositAllocations)?data.depositAllocations:[];
    const netAmount=depositMoney(allocations.reduce((sum:number, raw:unknown)=>{
      const a=objectValue(raw);
      return sum+(text(a.depositId ?? a.sourceId ?? a.id)===depositId?depositMoney(a.amount):0);
    },0));
    if (!netAmount) continue;
    if (withdrawn) complete=false;
    const oldReal=real, oldBonus=bonus;
    let grossAmount=netAmount, benefitGranted=0, benefitUsed=0, benefitRestored=0, benefitReversed=0;
    if (row.kind==='refund') {
      const originalId=text(row.originalOperationId), original=entries.get(originalId);
      const before=returned.get(originalId)||0;
      if (!original || before+netAmount>original.netAmount+0.009) {
        // Missing historical linkage is not evidence of a cash refund split.
        complete=false; real=signed(real+netAmount);
      } else {
        const after=depositMoney(before+netAmount);
        const part=(value:number)=>signed(depositMoney(value*after/original.netAmount)-depositMoney(value*before/original.netAmount));
        benefitReversed=part(original.benefitGranted);
        grossAmount=depositMoney(netAmount+benefitReversed);
        const realRestored=Math.min(grossAmount,part(-original.realDelta));
        benefitRestored=depositMoney(grossAmount-realRestored);
        real=signed(real+realRestored);
        bonus=signed(bonus+benefitRestored-benefitReversed);
        // If a later service already used the credited benefit, its reversal
        // comes out of the restored amount, not out of newly invented cash.
        if (bonus<0) { real=signed(real+bonus); bonus=0; }
        returned.set(originalId,after);
        creditNet=signed(creditNet-benefitReversed);
      }
    } else {
      const discount=savedDepositDiscount(data);
      if (discount?.depositId===depositId && discount.netAmount>0) {
        benefitGranted=depositMoney(discount.benefitAmount*Math.min(netAmount,discount.netAmount)/discount.netAmount);
      } else if (!discount && depositMoney(objectValue(data.settlement).pricePercentTotal)>0 && !objectValue(data.priceCondition).type) {
        // Historical automatic discount without a saved program cannot be
        // assigned to this deposit by guessing.
        complete=false;
      }
      grossAmount=depositMoney(netAmount+benefitGranted);
      const realSpent=Math.min(Math.max(0,real),grossAmount);
      benefitUsed=depositMoney(grossAmount-realSpent);
      real=signed(real-realSpent);
      bonus=signed(bonus+benefitGranted-benefitUsed);
      creditNet=signed(creditNet+benefitGranted);
    }
    if (real< -0.009 || bonus< -0.009) complete=false;
    if(id)balances.set(id,{realBalance:real,benefitBalance:bonus});
    if (id) entries.set(id,{depositId,netAmount,grossAmount,realDelta:signed(real-oldReal),
      benefitDelta:signed(bonus-oldBonus),benefitGranted,benefitUsed,benefitRestored,benefitReversed,
      realAfter:real,benefitAfter:bonus,
      articleId:row.kind==='refund'?'system-deposit-payment-refund':'system-deposit-spend',
      articleName:row.kind==='refund'?'Возврат на депозит':'Списание с депозита'});
  }
  return { realBalance:depositMoney(real), benefitBalance:depositMoney(bonus),
    creditedBenefit:depositMoney(creditNet), complete:complete&&hasFunding, entries, balances };
}

export function depositRefundQuote(row: { depositId: string; terms: unknown; principalBalance: unknown; benefitBalance: unknown; balance: unknown }, operations: unknown) {
  const principal = depositMoney(row.principalBalance);
  const accrued = depositMoney(row.benefitBalance);
  const balanceBefore = depositMoney(row.balance);
  if (depositBenefitMode(row.terms) !== 'discount') {
    return {refundableAmount:principal,conditionalBenefit:0,conditionalWrittenOff:0,
      benefitWrittenOff:accrued,balanceBefore,realBalance:principal,conditionalBenefitBalance:0,accountingComplete:true};
  }
  const conditionalBenefit=depositConditionalBenefit(operations,row.depositId);
  const projection=depositDiscountAccounting(operations,row.depositId);
  const accountingComplete=projection.complete && Math.abs(projection.realBalance+projection.benefitBalance-balanceBefore)<0.009;
  const externalBenefit=Math.max(0,depositMoney(conditionalBenefit-projection.creditedBenefit));
  const refundableAmount=accountingComplete
    ? depositMoney(projection.realBalance-Math.min(projection.realBalance,externalBenefit))
    : depositMoney(principal-Math.min(principal,conditionalBenefit));
  const conditionalWrittenOff=depositMoney(balanceBefore-refundableAmount);
  return {refundableAmount,conditionalBenefit,conditionalWrittenOff,
    benefitWrittenOff:conditionalWrittenOff,balanceBefore,
    realBalance:accountingComplete?projection.realBalance:null,
    conditionalBenefitBalance:accountingComplete?projection.benefitBalance:null,accountingComplete};
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

// Historical visibility is based on effective date, not a present-day status.
// Materialized balances/status may have been cleared by expiry after the visit.
function depositWasFundedAt(row: { fundedAt?: Date | string }, at: Date) {
  const funded = row.fundedAt && typeof (row.fundedAt as Date).toISOString === 'function'
    ? (row.fundedAt as Date).toISOString() : text(row.fundedAt);
  return !funded || funded.slice(0, 10) <= at.toISOString().slice(0, 10);
}

function depositPriceEligibleAt(row: { status: string; fundedAt?: Date | string; terms: unknown }, at: Date) {
  const status = text(row.status);
  // A previously expired deposit is valid for pricing a PAST visit inside
  // its term, never for a visit today or in the future.
  const today = new Date().toISOString().slice(0, 10);
  const historical = at.toISOString().slice(0, 10) < today;
  const end = text(objectValue(row.terms).termEndDate).slice(0, 10);
  // A row expired before the end of its configured term is not a
  // historically valid discount just because its visit date is in the past.
  const naturallyExpired = /^\d{4}-\d{2}-\d{2}$/.test(end) && end < today;
  return (status === 'active' || (historical && status === 'expired' && naturallyExpired))
    && depositWasFundedAt(row, at)
    && depositTermActiveAt(row.terms, at);
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
        principalAmount: row.principalAmount == null ? Math.max(0, depositMoney(depositMoney(row.amount) - depositMoney(row.benefitAmount))) : depositMoney(row.principalAmount),
        benefitAmount: row.benefitAmount == null ? Math.max(0, depositMoney(depositMoney(row.amount) - depositMoney(row.principalAmount == null ? row.amount : row.principalAmount))) : depositMoney(row.benefitAmount),
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
    const terms = objectValue(row.terms);
    const mode = text(terms.termMode).toLowerCase();
    const end = text(terms.termEndDate).slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    // A future start is NOT expiry. "По" is inclusive: expire only
    // after its last day; keep money untouched and block use until start.
    if (!['dated', 'fixed'].includes(mode)
      || !/^\d{4}-\d{2}-\d{2}$/.test(end)
      || today <= end) continue;
    await db.loyaltyDepositInstance.update({
      where: { id: row.id },
      // An ended term disables NEW use; it does not spend or erase the
      // unconsumed balance. The amount remains an auditable financial fact.
      data: { status: 'expired' },
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

// One canonical projection of an active deposit into its price-condition source.
// Shared by settlement and batched /account/contacts reads; never use visibility
// flags here because a price condition is independent of deposit-card visibility.
export function depositPriceSourcesFromRows(
  rows: Array<{ personKey: string; status: string; fundedAt?: Date | string; terms: unknown; depositId: string; programId: string; programName: string }>,
  personKey: string,
  at: Date,
) {
  if (!personKey) return [];
  return rows
    .filter((row) => row.personKey === personKey
      && depositPriceEligibleAt(row, at)
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

export async function activeDepositPriceSources(db: Db, tenantId: string, personKey: string, at: Date) {
  if (!personKey) return [];
  await expireDepositInstances(db, tenantId);
  const historical = at.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10);
  const rows = await db.loyaltyDepositInstance.findMany({
    where: { tenantId, personKey, status: historical ? { in: ['active', 'expired'] } : 'active' },
    orderBy: [{ fundedAt: 'asc' }, { createdAt: 'asc' }],
  });
  return depositPriceSourcesFromRows(rows, personKey, at);
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
  if (!depositPriceEligibleAt(row, at)) {
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

export async function consumeDepositAllocations(
  db: Db, tenantId: string, values: unknown, expectedPersonKey: string,
  occurredAt: Date, historical = false, visitAt: Date | null = null,
) {
  // The visit controls entitlement; the operation date controls when the
  // payment was actually recorded. These dates must not be conflated.
  const eligibilityAt = visitAt || occurredAt;
  const visitDay = eligibilityAt.toISOString().slice(0, 10);
  const historicalVisit = visitDay < new Date().toISOString().slice(0, 10);
  const historicalCutoff = new Date(visitDay + 'T23:59:59.999Z');
  const requested = normalizedDepositAllocations(values);
  const seen = new Set<string>();
  const result: DepositAllocation[] = [];

  for (const request of requested) {
    if (seen.has(request.depositId)) throw new BadRequestException('Один депозит нельзя указать дважды');
    seen.add(request.depositId);
    if(!historical) await expireDepositInstances(db, tenantId, request.depositId);
    const row = await db.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: request.depositId } },
    });
    if (!row) throw new BadRequestException('Депозит не найден');
    if (expectedPersonKey && row.personKey !== expectedPersonKey) throw new BadRequestException('Депозит принадлежит другому человеку');
    // A past visit can be settled after the deposit has expired today.
    // Never reopen its expired status; reconstruct dated spendable funds
    // from FinanceOperation and ensure later payments
    // cannot become overdrawn as a result of backfilled spending.
    if (historical && row.status === 'expired'
      && depositPriceEligibleAt(row, eligibilityAt)) {
      if (!depositWasFundedAt(row, eligibilityAt) || !depositWasFundedAt(row, occurredAt)) {
        throw new BadRequestException('Оплата раньше первого внесения депозита невозможна');
      }
      const operations = await db.financeOperation.findMany({
        where: { tenantId, kind: { in: ['deposit-funding', 'deposit-withdrawal', 'payment', 'refund'] } },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      });
      let historical;
      try {
        historical = depositHistoricalLedger(operations, row.depositId, row.terms, historicalCutoff, request.amount);
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Недостаточно средств на дату визита');
      }
      const split = historical.allocation;
      if (!split) throw new BadRequestException('Не удалось определить списание по депозиту');
      result.push({
        depositId: row.depositId,
        name: request.name || (row.programName || 'Депозит') + ' · историческая оплата',
        amount: split.amount,
        principalAmount: split.principalAmount,
        benefitAmount: split.benefitAmount,
      });
      continue;
    }
    if (row.status !== 'active' || !depositPriceEligibleAt(row, eligibilityAt)
      || !depositWasFundedAt(row, occurredAt)) {
      throw new BadRequestException(`Депозит «${row.programName || 'Депозит'}» недоступен для оплаты`);
    }
    const principal = depositMoney(row.principalBalance);
    const benefit = depositMoney(row.benefitBalance);
    const available = depositMoney(row.balance);
    // An old visit cannot consume top-ups received after that date. Check
    // the entire ledger, including subsequent payments, for negative balances.
    let historicalSplit: { amount: number; principalAmount: number; benefitAmount: number } | null = null;
    if (historicalVisit) {
      const operations = await db.financeOperation.findMany({
        where: { tenantId, kind: { in: ['deposit-funding', 'deposit-withdrawal', 'payment', 'refund'] } },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }],
      });
      try {
        historicalSplit = depositHistoricalLedger(
          operations, row.depositId, row.terms, historicalCutoff, request.amount,
        ).allocation;
      } catch (error) {
        throw new BadRequestException(error instanceof Error ? error.message : 'Недостаточно средств на дату визита');
      }
      if (!historicalSplit) throw new BadRequestException('Не удалось определить историческое списание');
    }
    if (request.amount > available + 0.009) throw new BadRequestException(`На депозите «${row.programName || 'Депозит'}» недостаточно средств`);

    if (historicalSplit
      && (historicalSplit.principalAmount > principal + 0.009
        || historicalSplit.benefitAmount > benefit + 0.009)) {
      throw new BadRequestException('Историческое списание превышает текущий остаток депозита');
    }
    const principalAmount = historicalSplit
      ? historicalSplit.principalAmount : Math.min(principal, request.amount);
    const benefitAmount = historicalSplit
      ? historicalSplit.benefitAmount : Math.min(benefit, depositMoney(request.amount - principalAmount));
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
    if (row.status === 'closed') {
      const withdrawal = await db.financeOperation.findFirst({ where: { tenantId, kind: 'deposit-withdrawal',
        sourceType: 'deposit', sourceId: row.depositId, status: 'completed' }, select: { id: true } });
      if (withdrawal) throw new BadRequestException('Депозит расторгнут. Возврат на закрытый депозит недоступен.');
    }
    if (!depositTermActiveAt(row.terms, at) || row.status === 'expired') continue;
    const principal = depositMoney(row.principalBalance);
    const benefit = depositMoney(row.benefitBalance);
    const principalRestore = Math.min(allocation.amount, allocation.principalAmount);
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

export async function assertDepositDiscountRefundAllowed(db: Db, tenantId: string, paymentData: unknown) {
  const discount=savedDepositDiscount(paymentData);
  if(!discount) return;
  const withdrawal=await db.financeOperation.findFirst({where:{tenantId,kind:'deposit-withdrawal',sourceType:'deposit',
    sourceId:discount.depositId,status:'completed'},select:{data:true}});
  if(withdrawal&&depositMoney(objectValue(withdrawal.data).conditionalBenefitWrittenOff)>0)
    throw new BadRequestException('Депозит расторгнут с аннулированием выгоды. Для возврата услуги требуется сверка документа расторжения.');
}

export async function closeDepositForRefund(db: Db, tenantId: string, depositId: string, amount: number, at: Date) {
  await expireDepositInstances(db, tenantId, depositId);
  const row = await db.loyaltyDepositInstance.findUnique({
    where: { tenantId_depositId: { tenantId, depositId } },
  });
  if (!row) throw new BadRequestException('Депозит не найден');
  if (row.status !== 'active' || !depositTermActiveAt(row.terms, at)) throw new BadRequestException('Возврат по этому депозиту недоступен');
  const operations = depositBenefitMode(row.terms) === 'discount'
    ? await db.financeOperation.findMany({ where: { tenantId, status: 'completed', kind: { in: ['deposit-funding','deposit-withdrawal','deposit-import-spend','payment', 'refund'] } } }) : [];
  const quote = depositRefundQuote(row, operations);
  if (!quote.accountingComplete) throw new BadRequestException('Невозможно подтвердить денежную и бонусную части исторических операций депозита. Возврат заблокирован до сверки.');
  const requested = depositMoney(amount);
  if (requested <= 0 || Math.abs(requested - quote.refundableAmount) > 0.009)
    throw new BadRequestException('Сумма возврата должна соответствовать остатку после аннулирования выгоды');
  await db.loyaltyDepositInstance.update({
    where: { id: row.id },
    data: {
      principalBalance: 0,
      benefitBalance: 0,
      balance: 0,
      status: 'closed',
    },
  });
  return { ...row, ...quote };
}
