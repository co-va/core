import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { calculateSettlement as calculateCanonicalSettlement, repriceSettlement as repriceCanonicalSettlement } from '../../../core/finance/rules.js';
import {
  closeDepositForRefund,
  consumeDepositAllocations,
  createDepositInstance,
  depositBenefitMode,
  expireDepositInstances,
  depositBenefitRate,
  depositTermActiveAt,
  restoreDepositAllocations,
  reconsumeDepositAllocations,
} from '../loyalty/deposit-state';
import { resolvePersonPricePercent } from '../loyalty/price-condition';

type JsonObject = Record<string, any>;
type Db = PrismaService | Prisma.TransactionClient;

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

function sourceValue(value: unknown) {
  const source = objectValue(value);
  return { type: text(source.type), id: text(source.id) };
}

function normalizeSettlement(value: unknown) {
  const source = objectValue(value);
  const items = arrayValue(source.items).map((item) => {
    const row = objectValue(item);
    const price = money(row.price ?? row.cost);
    const correctionModeValue = text(row.correctionMode);
    const correctionMode = ['percent', 'money', 'none'].includes(correctionModeValue) ? correctionModeValue : 'none';
    const correctionPercent = percent(row.correctionPercent);
    const correctionMoney = Math.min(price, money(row.correctionMoney));
    const correctedPrice = Math.min(price, money(row.correctedPrice ?? (price - correctionMoney)));
    const pricePercent = percent(row.pricePercent);
    const inferredPricePercentMoney = Math.max(0, correctedPrice - money(row.planAmount ?? correctedPrice));
    const pricePercentMoney = Math.min(correctedPrice, money(row.pricePercentMoney ?? inferredPricePercentMoney));
    const planAmount = Math.max(0, money(row.planAmount ?? (correctedPrice - pricePercentMoney)));
    return {
      sourceType: text(row.sourceType) || 'procedure',
      sourceId: text(row.sourceId ?? row.id),
      name: text(row.name),
      price,
      correctionMode,
      correctionPercent,
      correctionMoney,
      correctedPrice,
      pricePercent,
      pricePercentMoney,
      planAmount,
    };
  });
  const serviceTotal = money(items.reduce((sum, item) => sum + item.price, 0));
  const correctionTotal = money(items.reduce((sum, item) => sum + item.correctionMoney, 0));
  const pricePercentTotal = money(items.reduce((sum, item) => sum + item.pricePercentMoney, 0));
  const planTotal = money(items.reduce((sum, item) => sum + item.planAmount, 0));
  const percents = [...new Set(items.map((item) => Math.round(item.pricePercent * 10000) / 10000))];
  return {
    items,
    serviceTotal,
    pricePercent: source.pricePercent == null ? (percents.length === 1 ? percents[0] : null) : percent(source.pricePercent),
    correctionTotal,
    pricePercentTotal,
    planTotal,
  };
}

function validSettlement(value: unknown) {
  const settlement = normalizeSettlement(value);
  return settlement.items.length > 0 || settlement.planTotal > 0 ? settlement : null;
}

function canonicalSettlementInput(value: unknown, pricePercent: number) {
  const requested = validSettlement(value);
  if (!requested) throw new BadRequestException('У оплаты отсутствует расчёт');
  const items = requested.items.map((item) => ({
    ...item,
    pricePercent: null,
    pricePercentMoney: undefined,
    planAmount: undefined,
    correctedPrice: undefined,
  }));
  return calculateCanonicalSettlement(items, { pricePercent });
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

function personKey(value: unknown) {
  const person = objectValue(value);
  return text(person.key ?? person.personKey ?? person.id);
}

const DEFAULT_FINANCE_ARTICLES = [
  { articleId: 'system-income', parentArticleId: '', name: 'Доходы', direction: 'IN', economicType: 'GROUP', systemKey: 'INCOME_ROOT', position: 10 },
  { articleId: 'system-service-revenue', parentArticleId: 'system-income', name: 'Услуги', direction: 'IN', economicType: 'OPERATING_REVENUE', systemKey: 'SERVICE_REVENUE', position: 20 },
  { articleId: 'system-product-revenue', parentArticleId: 'system-income', name: 'Продажа товаров', direction: 'IN', economicType: 'PRODUCT_REVENUE', systemKey: 'PRODUCT_REVENUE', position: 30 },
  { articleId: 'system-other-income', parentArticleId: 'system-income', name: 'Прочие доходы', direction: 'IN', economicType: 'OPERATING_REVENUE', systemKey: 'OTHER_INCOME', position: 40 },
  { articleId: 'system-tips', parentArticleId: 'system-income', name: 'Чаевые', direction: 'IN', economicType: 'TIPS', systemKey: 'TIPS', position: 50 },
  { articleId: 'system-loan-received', parentArticleId: 'system-income', name: 'Займ', direction: 'IN', economicType: 'LOAN_RECEIVED', systemKey: 'LOAN_RECEIVED', position: 60 },
  { articleId: 'system-investment-received', parentArticleId: 'system-income', name: 'Инвестиции', direction: 'IN', economicType: 'INVESTMENT_RECEIVED', systemKey: 'INVESTMENT_RECEIVED', position: 70 },
  { articleId: 'system-investment-capital-return', parentArticleId: 'system-income', name: 'Возврат капитала', direction: 'IN', economicType: 'INVESTMENT_CAPITAL_RETURN', systemKey: 'INVESTMENT_CAPITAL_RETURN', position: 72 },
  { articleId: 'system-investment-income', parentArticleId: 'system-income', name: 'Доход инвестиции', direction: 'IN', economicType: 'INVESTMENT_INCOME', systemKey: 'INVESTMENT_INCOME', position: 74 },
  { articleId: 'system-expense', parentArticleId: '', name: 'Расходы', direction: 'OUT', economicType: 'GROUP', systemKey: 'EXPENSE_ROOT', position: 100 },
  { articleId: 'system-materials', parentArticleId: 'system-expense', name: 'Материалы', direction: 'OUT', economicType: 'OPERATING_EXPENSE', systemKey: 'MATERIALS', position: 110 },
  { articleId: 'system-rent', parentArticleId: 'system-expense', name: 'Аренда', direction: 'OUT', economicType: 'OPERATING_EXPENSE', systemKey: 'RENT', position: 120 },
  { articleId: 'system-tax', parentArticleId: 'system-expense', name: 'Налог', direction: 'OUT', economicType: 'TAX', systemKey: 'TAX', position: 130 },
  { articleId: 'system-other-expense', parentArticleId: 'system-expense', name: 'Прочие расходы', direction: 'OUT', economicType: 'OPERATING_EXPENSE', systemKey: 'OTHER_EXPENSE', position: 140 },
  { articleId: 'system-refund', parentArticleId: 'system-expense', name: 'Возврат', direction: 'OUT', economicType: 'REFUND', systemKey: 'REFUND', position: 150 },
  { articleId: 'system-loan-repayment', parentArticleId: 'system-expense', name: 'Возврат займа', direction: 'OUT', economicType: 'LOAN_REPAYMENT', systemKey: 'LOAN_REPAYMENT', position: 160 },
  { articleId: 'system-investment-return', parentArticleId: 'system-expense', name: 'Возврат инвестиций', direction: 'OUT', economicType: 'INVESTMENT_RETURN', systemKey: 'INVESTMENT_RETURN', position: 170 },
  { articleId: 'system-investment-contribution', parentArticleId: 'system-expense', name: 'Вложение', direction: 'OUT', economicType: 'INVESTMENT_CONTRIBUTION', systemKey: 'INVESTMENT_CONTRIBUTION', position: 172 },
  { articleId: 'system-investment-expense', parentArticleId: 'system-expense', name: 'Расход инвестиции', direction: 'OUT', economicType: 'INVESTMENT_EXPENSE', systemKey: 'INVESTMENT_EXPENSE', position: 174 },
  { articleId: 'system-investment-income-payment', parentArticleId: 'system-expense', name: 'Выплата дохода инвестору', direction: 'OUT', economicType: 'INVESTMENT_INCOME_PAYMENT', systemKey: 'INVESTMENT_INCOME_PAYMENT', position: 176 },
  { articleId: 'system-transfer', parentArticleId: '', name: 'Перевод между кошельками', direction: 'TRANSFER', economicType: 'TRANSFER', systemKey: 'TRANSFER', position: 200 },
] as const;

const ARTICLE_DIRECTIONS = new Set(['IN', 'OUT', 'TRANSFER']);
const ARTICLE_ECONOMIC_TYPES = new Set([
  'GROUP', 'OPERATING_REVENUE', 'PRODUCT_REVENUE', 'OPERATING_EXPENSE', 'TAX', 'TIPS', 'REFUND',
  'LOAN_RECEIVED', 'LOAN_REPAYMENT', 'INVESTMENT_RECEIVED', 'INVESTMENT_RETURN', 'INVESTMENT_CONTRIBUTION',
  'INVESTMENT_CAPITAL_RETURN', 'INVESTMENT_INCOME', 'INVESTMENT_EXPENSE', 'INVESTMENT_INCOME_PAYMENT', 'TRANSFER',
]);

const SPECIAL_FINANCE_DEFINITIONS: Record<string, {
  direction: 'IN' | 'OUT';
  economicType: string;
  systemKey: string;
  financeEntityType: 'loan' | 'investment';
  roles?: Array<'self' | 'raise' | 'external'>;
}> = {
  'loan-received': { direction: 'IN', economicType: 'LOAN_RECEIVED', systemKey: 'LOAN_RECEIVED', financeEntityType: 'loan' },
  'loan-repayment': { direction: 'OUT', economicType: 'LOAN_REPAYMENT', systemKey: 'LOAN_REPAYMENT', financeEntityType: 'loan' },
  'investment-received': { direction: 'IN', economicType: 'INVESTMENT_RECEIVED', systemKey: 'INVESTMENT_RECEIVED', financeEntityType: 'investment', roles: ['raise'] },
  'investment-return': { direction: 'OUT', economicType: 'INVESTMENT_RETURN', systemKey: 'INVESTMENT_RETURN', financeEntityType: 'investment', roles: ['raise'] },
  'investment-income-payment': { direction: 'OUT', economicType: 'INVESTMENT_INCOME_PAYMENT', systemKey: 'INVESTMENT_INCOME_PAYMENT', financeEntityType: 'investment', roles: ['raise'] },
  'investment-contribution': { direction: 'OUT', economicType: 'INVESTMENT_CONTRIBUTION', systemKey: 'INVESTMENT_CONTRIBUTION', financeEntityType: 'investment', roles: ['self', 'external'] },
  'investment-capital-return': { direction: 'IN', economicType: 'INVESTMENT_CAPITAL_RETURN', systemKey: 'INVESTMENT_CAPITAL_RETURN', financeEntityType: 'investment', roles: ['self', 'external'] },
  'investment-income': { direction: 'IN', economicType: 'INVESTMENT_INCOME', systemKey: 'INVESTMENT_INCOME', financeEntityType: 'investment', roles: ['self', 'external'] },
  'investment-expense': { direction: 'OUT', economicType: 'INVESTMENT_EXPENSE', systemKey: 'INVESTMENT_EXPENSE', financeEntityType: 'investment', roles: ['self', 'external'] },
};

function splitAllocationComponents(allocations: JsonObject[], serviceAmount: number, tips: number) {
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
export class FinanceService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['FinanceArticle', 'FinanceSettlement', 'FinanceOperation', 'FinanceLedgerEntry', 'LoyaltyDepositInstance']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['FinanceArticle', 'FinanceSettlement', 'FinanceOperation', 'FinanceLedgerEntry', 'LoyaltyDepositInstance'],before,after,checkOnly); }

  async finishHistoricalDeposits(tx:Prisma.TransactionClient,tenantId:string,ids:string[]){for(const id of ids)await expireDepositInstances(tx,tenantId,id);}

  async importArticle(tenantId:string,input:JsonObject,targetId:string,tx:Prisma.TransactionClient) {
    const name=text(input.article);const direction=input.articleDirection==='Доход'?'IN':input.articleDirection==='Расход'?'OUT':text(input.articleDirection);
    if(!name || !['IN','OUT'].includes(direction))throw new BadRequestException('Укажите название и направление статьи');
    const rows=await tx.financeArticle.findMany({where:{tenantId,name,archivedAt:null}});
    if(!targetId && rows.length>1)throw new BadRequestException('Не удалось однозначно определить статью');
    const id=targetId || rows[0]?.articleId || randomUUID();
    const current=await tx.financeArticle.findUnique({where:{tenantId_articleId:{tenantId,articleId:id}}});
    if(current && (current.name!==name || current.direction!==direction))throw new BadRequestException('Статья конфликтует с сохранённой');
    const types:JsonObject={'Услуги':'OPERATING_REVENUE','Товары':'PRODUCT_REVENUE','Чаевые':'TIPS','Прочий доход':'OPERATING_REVENUE','Операционные расходы':'OPERATING_EXPENSE'};
    const economicType=types[text(input.articleEconomicType)]||text(input.articleEconomicType);
    if(!ARTICLE_ECONOMIC_TYPES.has(economicType)||economicType==='GROUP')throw new BadRequestException('Уточните тип статьи');
    if(!current)await tx.financeArticle.create({data:{tenantId,articleId:id,name,direction,economicType}});
    return id;
  }
  async resolveHistoricalDeposit(tenantId:string,input:JsonObject,tx:Prisma.TransactionClient) {
    const rows=await tx.loyaltyDepositInstance.findMany({where:{tenantId,personKey:text(input.personKey),programName:text(input.deposit || input.program)}});
    if(rows.length!==1)throw new BadRequestException('Не удалось однозначно определить депозит');return rows[0];
  }
  async importDeposit(tenantId:string,input:JsonObject,targetId:string,tx:Prisma.TransactionClient) {
    const id=targetId || randomUUID();const amount=money(input.depositAmount);const occurredAt=requiredOccurredAt(input.occurredAt);
    if(amount<=0 || !input.person?.key || !input.walletId)throw new BadRequestException('Укажите человека, кошелёк и сумму операции депозита');
    if(input.depositAction==='Возврат') {
      if(targetId)throw new BadRequestException('Возврат уже выполнен. Отмените его сеанс перед заменой.');
      const deposit=await this.resolveHistoricalDeposit(tenantId,{...input,personKey:input.person.key},tx);
      await closeDepositForRefund(tx,tenantId,deposit.depositId,amount,occurredAt);
      await this.createOperationWithEntries(tx,tenantId,{operationId:id,kind:'deposit-withdrawal',source:{type:'deposit',id:deposit.depositId},occurredAt,data:{depositId:deposit.depositId,person:input.person,amount,total:amount,walletId:input.walletId,walletName:input.walletName},entries:[{walletId:input.walletId,walletName:input.walletName,direction:'OUT',economicType:'DEPOSIT_RETURN',amount,component:'deposit-withdrawal'}]});return id;
    }
    if(input.depositAction!=='Пополнение')throw new BadRequestException('Уточните операцию депозита');
    const programs=await this.depositProgramsWith(tx,tenantId);const found=programs.filter(p=>text(p.name)===text(input.program || input.deposit));
    if(found.length!==1)throw new BadRequestException('Не удалось однозначно определить программу депозита');
    const program=found[0];
    if(targetId)throw new BadRequestException('Депозит уже создан. Отмените его сеанс перед заменой условий.');
    await createDepositInstance(tx,tenantId,{depositId:id,programId:program.id,programName:program.name,person:input.person,terms:clone(program),amount,occurredAt,fundingOperationId:id});
    await this.createOperationWithEntries(tx,tenantId,{operationId:id,kind:'deposit-funding',source:{type:'deposit',id},occurredAt,data:{depositId:id,programId:program.id,programName:program.name,person:input.person,amount,total:amount,walletId:input.walletId,walletName:input.walletName,terms:clone(program)},entries:[{walletId:input.walletId,walletName:input.walletName,direction:'IN',economicType:'DEPOSIT_RECEIVED',amount,component:'deposit-funding'}]});return id;
  }
  async importFinancialOperation(tenantId:string,input:JsonObject,targetId:string,tx:Prisma.TransactionClient) {
    const operationId=targetId || randomUUID();const amount=money(input.financeAmount);const occurredAt=requiredOccurredAt(input.occurredAt);
    if(amount<=0)throw new BadRequestException('Укажите сумму финансовой операции');
    if(!text(input.walletId))throw new BadRequestException('Укажите кошелёк финансовой операции');
    const names:JsonObject={'Получение займа':'loan-received','Возврат займа':'loan-repayment','Получение инвестиций':'investment-received','Возврат инвестиций':'investment-return','Вклад в инвестицию':'investment-contribution','Возврат капитала':'investment-capital-return','Доход инвестиции':'investment-income','Расход инвестиции':'investment-expense','Выплата дохода инвестору':'investment-income-payment'};
    const kind=names[text(input.financeKind)]||text(input.financeKind);let entries:JsonObject[]=[];let data:JsonObject={...input,total:amount};
    if(kind==='Перевод') {
      const to=await this.resolveTransferredWallet(tenantId,{wallet:input.toWallet},tx);
      if(to.id===input.walletId)throw new BadRequestException('Для перевода нужны разные кошельки');
      entries=[{walletId:input.walletId,direction:'OUT',economicType:'TRANSFER',amount},{walletId:to.id,direction:'IN',economicType:'TRANSFER',amount}];
      data={...data,fromWalletId:input.walletId,toWalletId:to.id};
    } else if(['Доход','Расход'].includes(kind)) {
      const articles=await tx.financeArticle.findMany({where:{tenantId,name:text(input.article),archivedAt:null}});
      if(articles.length!==1)throw new BadRequestException('Не удалось однозначно определить статью');
      const direction=kind==='Доход'?'IN':'OUT';if(articles[0].direction!==direction || articles[0].economicType==='GROUP')throw new BadRequestException('Статья не соответствует операции');
      entries=[{walletId:input.walletId,walletName:input.walletName,direction,economicType:articles[0].economicType,articleId:articles[0].articleId,articleName:articles[0].name,amount}];
    } else {
      const definition=SPECIAL_FINANCE_DEFINITIONS[kind];if(!definition)throw new BadRequestException('Уточните вид финансовой операции');
      const state=await tx.businessAuxiliaryState.findUnique({where:{tenantId}});const entities=arrayValue(objectValue(state?.data)[definition.financeEntityType==='loan'?'loans':'investments']);
      const found=entities.filter(p=>text(p.name)===text(input.loan || input.investment));if(found.length!==1)throw new BadRequestException('Не удалось однозначно определить займ или инвестицию');
      if(definition.financeEntityType==='investment'){const role=text(found[0].investmentTerms?.role)||'raise';if(!definition.roles?.includes(role as any))throw new BadRequestException('Операция не соответствует роли инвестиции');await this.assertInvestmentRoleAllowed(tenantId,role);}
      data={...data,financeEntityType:definition.financeEntityType,financeEntityId:found[0].id,financeEntityName:found[0].name};
      entries=[{walletId:input.walletId,walletName:input.walletName,direction:definition.direction,economicType:definition.economicType,amount}];
    }
    const current=await tx.financeOperation.findUnique({where:{tenantId_operationId:{tenantId,operationId}}});
    if(current)await this.replaceOperationWithEntries(tx,tenantId,current,occurredAt,data,entries);
    else await this.createOperationWithEntries(tx,tenantId,{operationId,kind:kind==='Перевод'?'transfer':kind==='Доход'?'manual-income':kind==='Расход'?'manual-expense':kind,source:{type:kind==='Доход'||kind==='Расход'?'manual':'finance',id:operationId},occurredAt,data,entries});
    return operationId;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SaasAccessService,
  ) {}

  calculateSettlement(items: JsonObject[], pricePercent: unknown = 0) {
    return calculateCanonicalSettlement(items, { pricePercent });
  }

  repriceSettlement(items: JsonObject[], current: unknown, pricePercent: unknown = 0) {
    return repriceCanonicalSettlement(items, current, { pricePercent });
  }

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

  private async saveSettlementWith(db: Db, tenantId: string, sourceType: string, sourceId: string, value: unknown) {
    const settlement = validSettlement(value);
    if (!settlement) throw new BadRequestException('Расчёт не содержит суммы');
    const type = text(sourceType);
    const id = text(sourceId);
    if (!type || !id) throw new BadRequestException('У расчёта отсутствует источник');
    await db.financeSettlement.upsert({
      where: { tenantId_sourceType_sourceId: { tenantId, sourceType: type, sourceId: id } },
      create: { tenantId, sourceType: type, sourceId: id, data: json(settlement) },
      update: { data: json(settlement) },
    });
    return settlement;
  }

  async upsertSettlement(tenantId: string, sourceType: string, sourceId: string, value: unknown) {
    return this.saveSettlementWith(this.prisma, tenantId, sourceType, sourceId, value);
  }

  async settlementForSource(tenantId: string, sourceType: string, sourceId: string, fallback: unknown = null) {
    const type = text(sourceType);
    const id = text(sourceId);
    const row = await this.prisma.financeSettlement.findUnique({ where: { tenantId_sourceType_sourceId: { tenantId, sourceType: type, sourceId: id } } });
    if (row) return normalizeSettlement(row.data);
    if (type === 'record') {
      const recordRow = await this.prisma.record.findUnique({ where: { tenantId_recordId: { tenantId, recordId: id } } });
      const record = objectValue(recordRow?.data);
      if (record.historicalTransfer && (!arrayValue(record.procedures).length || arrayValue(record.procedures).some(item => item.cost == null || item.cost === ''))) return null;
    }
    const settlement = validSettlement(fallback);
    if (!settlement) return null;
    return this.saveSettlementWith(this.prisma, tenantId, type, id, settlement);
  }

  async saveSettlement(tenantId: string, sourceType: string, sourceId: string, value: unknown) {
    const settlement = validSettlement(value);
    if (!settlement) throw new BadRequestException('Расчёт не содержит суммы');
    const type = text(sourceType);
    const id = text(sourceId);
    if (!type || !id) throw new BadRequestException('У расчёта отсутствует источник');
    await this.serializable(async (tx) => {
      const paid = Math.max(0, await this.serviceNet(tx, tenantId, type, id));
      if (money(settlement.planTotal) + 0.009 < paid) throw new BadRequestException('Расчёт нельзя уменьшить ниже уже оплаченной суммы. Сначала выполните возврат или отмените ошибочную оплату.');
      await this.saveSettlementWith(tx, tenantId, type, id, settlement);
    });
    return this.snapshot(tenantId);
  }

  private async serviceNet(db: Db, tenantId: string, sourceType: string, sourceId: string, excludeOperationId = '') {
    const rows = await db.financeOperation.findMany({
      where: {
        tenantId,
        sourceType,
        sourceId,
        status: 'completed',
        kind: { in: ['payment', 'refund'] },
        ...(excludeOperationId ? { operationId: { not: excludeOperationId } } : {}),
      },
      select: { kind: true, data: true },
    });
    return money(rows.reduce((sum, row) => {
      const amount = money(objectValue(row.data).serviceAmount);
      return sum + (row.kind === 'refund' ? -amount : amount);
    }, 0));
  }

  private async depositProgramsWith(db: Db, tenantId: string) {
    const rows = await db.loyaltyDepositProgram.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { programId: 'asc' }],
    });
    return rows.map((row) => clone(objectValue(row.data)));
  }

  private async depositProgramWith(db: Db, tenantId: string, programId: string) {
    const id = text(programId);
    const program = (await this.depositProgramsWith(db, tenantId)).find((item) => text(item.id) === id && !text(item.archivedAt));
    if (!program) throw new BadRequestException('Депозитная программа не найдена');
    if (!['active', ''].includes(text(program.status))) throw new BadRequestException('Депозитная программа сейчас недоступна для оформления');
    return program;
  }

  private async canonicalDepositWith(db: Db, tenantId: string, depositId: string) {
    const id = text(depositId);
    const row = await db.loyaltyDepositInstance.findUnique({
      where: { tenantId_depositId: { tenantId, depositId: id } },
    });
    if (!row) throw new BadRequestException('Депозит не найден или отменён');
    return {
      depositId: row.depositId,
      programId: row.programId,
      programName: row.programName,
      personKey: row.personKey,
      person: clone(objectValue(row.person)),
      terms: clone(objectValue(row.terms)),
      fundedAmount: money(row.initialAmount),
      principalBalance: money(row.principalBalance),
      benefitBalance: money(row.benefitBalance),
      balance: money(row.balance),
      status: text(row.status),
      fundedAt: row.fundedAt.toISOString(),
      fundingOperationId: row.fundingOperationId,
    };
  }

  private async validateDepositAllocationsWith(
    db: Db,
    tenantId: string,
    values: JsonObject[],
    expectedPersonKey: string,
    occurredAt: Date,
    excludeOperationId = '',
  ) {
    const allocations = depositAllocationsValue(values);
    const seen = new Set<string>();
    const excluded = excludeOperationId
      ? await db.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: excludeOperationId } } })
      : null;

    for (const allocation of allocations) {
      if (seen.has(allocation.depositId)) throw new BadRequestException('Один депозит нельзя указать дважды');
      seen.add(allocation.depositId);
      const deposit = await this.canonicalDepositWith(db, tenantId, allocation.depositId);
      if (expectedPersonKey && personKey(deposit.person) !== expectedPersonKey) throw new BadRequestException('Депозит принадлежит другому человеку');
      if (!depositTermActiveAt(deposit.terms, occurredAt)) throw new BadRequestException(`Срок депозита «${deposit.programName || 'Депозит'}» завершён`);
      if (deposit.status !== 'active' && !(excluded && deposit.status === 'closed')) {
        throw new BadRequestException(`Депозит «${deposit.programName || 'Депозит'}» недоступен для оплаты`);
      }

      let available = deposit.balance;
      if (excluded?.kind === 'payment' && excluded.status === 'completed') {
        const previousAllocation = depositAllocationsValue(objectValue(excluded.data).depositAllocations)
          .filter((entry) => entry.depositId === allocation.depositId)
          .reduce((sum, entry) => sum + entry.amount, 0);
        available = Math.max(0, money(available + previousAllocation));
      }

      if (allocation.amount > available + 0.009) throw new BadRequestException(`На депозите «${deposit.programName || 'Депозит'}» недостаточно средств`);
      allocation.name = allocation.name || `${deposit.programName || 'Депозит'} · остаток ${available}`;
    }
    return allocations;
  }

  async listDeposits(tenantId: string, personId = '') {
    const key = text(personId);
    const rows = await this.prisma.loyaltyDepositInstance.findMany({
      where: { tenantId, ...(key ? { personKey: key } : {}) },
      orderBy: [{ fundedAt: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => ({
      depositId: row.depositId,
      programId: row.programId,
      programName: row.programName,
      person: clone(objectValue(row.person)),
      fundedAmount: money(row.initialAmount),
      principalBalance: money(row.principalBalance),
      benefitBalance: money(row.benefitBalance),
      refundableAmount: row.status === 'active' ? money(row.principalBalance) : 0,
      balance: money(row.balance),
      terms: clone(objectValue(row.terms)),
      status: row.status,
      fundedAt: row.fundedAt.toISOString(),
      fundingOperationId: row.fundingOperationId,
    }));
  }

  async recordDepositFunding(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const programId = text(input.programId);
    const person = clone(objectValue(input.person));
    const ownerKey = personKey(person);
    const amount = money(input.amount);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    if (!programId) throw new BadRequestException('Выберите депозитную программу');
    if (!ownerKey) throw new BadRequestException('Выберите человека');
    if (amount <= 0) throw new BadRequestException('Введите сумму депозита');
    if (!walletId) throw new BadRequestException('Выберите кошелёк, куда приняты деньги');
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const depositId = randomUUID();

    await this.serializable(async (tx) => {
      const program = await this.depositProgramWith(tx, tenantId, programId);
      const incomingPercent = depositBenefitMode(program) === 'discount' ? depositBenefitRate(program) : 0;
      await resolvePersonPricePercent(tx, tenantId, person, occurredAt, incomingPercent > 0 ? [{
        type: 'program', programType: 'deposit', programId, name: text(program.name) || 'Депозит', percent: incomingPercent,
      }] : []);
      await createDepositInstance(tx, tenantId, {
        depositId,
        programId,
        programName: text(program.name) || 'Депозит',
        person,
        terms: clone(program),
        amount,
        occurredAt,
        fundingOperationId: depositId,
      });
      await this.createOperationWithEntries(tx, tenantId, {
        operationId: depositId,
        kind: 'deposit-funding',
        source: { type: 'deposit', id: depositId },
        occurredAt,
        data: {
          depositId,
          programId,
          programName: text(program.name) || 'Депозит',
          person,
          amount,
          total: amount,
          walletId,
          walletName,
          terms: clone(program),
        },
        entries: [{
          walletId,
          walletName,
          direction: 'IN',
          economicType: 'DEPOSIT_RECEIVED',
          amount,
          component: 'deposit-funding',
          lineName: text(program.name) || 'Депозит',
          note: ownerKey,
        }],
      });
    });
    return this.canonicalDepositWith(this.prisma, tenantId, depositId);
  }

  async recordDepositWithdrawal(tenantId: string, depositId: string, body: unknown) {
    const id = text(depositId);
    const input = objectValue(body);
    const amount = money(input.amount);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    if (!id) throw new BadRequestException('Депозит не найден');
    if (amount <= 0) throw new BadRequestException('Введите сумму возврата');
    if (!walletId) throw new BadRequestException('Выберите кошелёк возврата');
    const operationId = randomUUID();

    await this.serializable(async (tx) => {
      const deposit = await this.canonicalDepositWith(tx, tenantId, id);
      await closeDepositForRefund(tx, tenantId, id, amount, occurredAt);
      await this.createOperationWithEntries(tx, tenantId, {
        operationId,
        kind: 'deposit-withdrawal',
        source: { type: 'deposit', id },
        occurredAt,
        data: {
          depositId: id,
          programId: deposit.programId,
          programName: deposit.programName,
          person: deposit.person,
          amount,
          total: amount,
          walletId,
          walletName,
          reason: text(input.reason),
        },
        entries: [{
          walletId,
          walletName,
          direction: 'OUT',
          economicType: 'DEPOSIT_RETURN',
          amount,
          component: 'deposit-withdrawal',
          lineName: deposit.programName || 'Депозит',
          note: text(input.reason),
        }],
      });
    });
    return this.canonicalDepositWith(this.prisma, tenantId, id);
  }

  private async financeEntity(tenantId: string, type: string, id: string) {
    const entityType = text(type);
    const entityId = text(id);
    if (!['loan', 'investment'].includes(entityType) || !entityId) throw new BadRequestException('Выберите финансовую сущность');
    const row = await this.prisma.businessAuxiliaryState.findUnique({ where: { tenantId } });
    const data = objectValue(row?.data);
    const values = entityType === 'loan' ? arrayValue(data.loans) : arrayValue(data.investments);
    const entity = values.map((value) => objectValue(value)).find((value) => text(value.id) === entityId && !text(value.deletedAt));
    if (!entity) throw new BadRequestException(entityType === 'loan' ? 'Займ не найден' : 'Инвестиция не найдена');
    const investmentTerms = objectValue(entity.investmentTerms);
    const investmentRole = ['self', 'raise', 'external'].includes(text(investmentTerms.role)) ? text(investmentTerms.role) : 'raise';
    return { type: entityType, id: entityId, name: text(entity.name), role: entityType === 'investment' ? investmentRole : '' };
  }

  private async assertInvestmentRoleAllowed(tenantId: string, roleValue: string) {
    const role = text(roleValue);
    const capabilityKey = role === 'self' ? 'finance.investment.self.access' : role === 'external' ? 'finance.investment.external.access' : 'finance.investment.raise.access';
    const capability = await this.access.resolveCapability(tenantId, capabilityKey);
    if (capability.enabled !== true) throw new ForbiddenException('Этот режим инвестиций недоступен');
  }

  async recordSettlementPaymentState(tenantId: string, recordId: string, settlement: JsonObject | null) {
    const paid = Math.max(0, await this.serviceNet(this.prisma, tenantId, 'record', text(recordId)));
    if (!settlement) return { state: 'unknown', paid, due: null };
    const total = money(settlement?.planTotal);
    const due = Math.max(0, money(total - paid));
    return { state: due <= 0.009 ? 'paid' : paid > 0.009 ? 'partial' : 'unpaid', paid, due };
  }

  private async createOperationWithEntries(db: Db, tenantId: string, {
    operationId, kind, status = 'completed', source, originalOperationId = '', occurredAt, data, entries,
  }: {
    operationId: string; kind: string; status?: string; source: { type: string; id: string };
    originalOperationId?: string; occurredAt: Date; data: JsonObject; entries: JsonObject[];
  }) {
    const existing = await db.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId } }, include: { ledgerEntries: true } });
    if (existing) return existing;
    const operation = await db.financeOperation.create({
      data: { tenantId, operationId, kind, status, sourceType: source.type, sourceId: source.id, originalOperationId, occurredAt, data: json(data) },
    });
    for (const entry of entries) {
      await db.financeLedgerEntry.create({
        data: {
          tenantId,
          financeOperationId: operation.id,
          entryId: text(entry.entryId) || randomUUID(),
          walletId: text(entry.walletId),
          direction: text(entry.direction),
          economicType: text(entry.economicType),
          amount: money(entry.amount),
          occurredAt,
          sourceType: source.type,
          sourceId: source.id,
          data: json({
            walletName: text(entry.walletName), component: text(entry.component), relatedOperationId: text(entry.relatedOperationId),
            articleId: text(entry.articleId), articleName: text(entry.articleName), lineName: text(entry.lineName),
            quantity: entry.quantity == null ? null : numberValue(entry.quantity),
            unitPrice: entry.unitPrice == null ? null : money(entry.unitPrice), note: text(entry.note),
          }),
        },
      });
    }
    return db.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId } }, include: { ledgerEntries: true } });
  }

  private async replaceOperationWithEntries(db: Db, tenantId: string, operation: { id: string; sourceType: string; sourceId: string }, occurredAt: Date, data: JsonObject, entries: JsonObject[]) {
    await db.financeLedgerEntry.deleteMany({ where: { tenantId, financeOperationId: operation.id } });
    await db.financeOperation.update({ where: { id: operation.id }, data: { occurredAt, data: json(data) } });
    for (const entry of entries) {
      await db.financeLedgerEntry.create({
        data: {
          tenantId, financeOperationId: operation.id, entryId: randomUUID(), walletId: text(entry.walletId), direction: text(entry.direction),
          economicType: text(entry.economicType), amount: money(entry.amount), occurredAt, sourceType: operation.sourceType, sourceId: operation.sourceId,
          data: json({
            walletName: text(entry.walletName), component: text(entry.component), relatedOperationId: text(entry.relatedOperationId),
            articleId: text(entry.articleId), articleName: text(entry.articleName), lineName: text(entry.lineName),
            quantity: entry.quantity == null ? null : numberValue(entry.quantity), unitPrice: entry.unitPrice == null ? null : money(entry.unitPrice), note: text(entry.note),
          }),
        },
      });
    }
  }

  private async createReversalFor(db: Db, tenantId: string, originalOperationId: string, reason: string, occurredAt: Date) {
    const original = await db.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: originalOperationId } }, include: { ledgerEntries: true } });
    if (!original) return null;
    const reversalId = `cancel-${originalOperationId}`;
    return this.createOperationWithEntries(db, tenantId, {
      operationId: reversalId,
      kind: 'cancel',
      source: { type: original.sourceType, id: original.sourceId },
      originalOperationId: original.operationId,
      occurredAt,
      data: { reason, cancelledOperationId: original.operationId },
      entries: original.ledgerEntries.map((entry) => ({
        walletId: entry.walletId, walletName: text(objectValue(entry.data).walletName), amount: numberValue(entry.amount),
        component: text(objectValue(entry.data).component), direction: entry.direction === 'IN' ? 'OUT' : 'IN',
        economicType: 'REVERSAL', relatedOperationId: original.operationId,
      })),
    });
  }

  private async ensureDefaultArticles(tenantId: string, db: Db = this.prisma) {
    const existing = await db.financeArticle.findMany({ where: { tenantId, systemKey: { not: '' } }, select: { systemKey: true } });
    const keys = new Set(existing.map((row) => row.systemKey));
    for (const item of DEFAULT_FINANCE_ARTICLES) {
      if (keys.has(item.systemKey)) continue;
      await db.financeArticle.create({ data: { tenantId, ...item } });
    }
  }

  private articleDto(row: any) {
    return { articleId: row.articleId, parentArticleId: row.parentArticleId, name: row.name, direction: row.direction, economicType: row.economicType, systemKey: row.systemKey, position: row.position, archivedAt: row.archivedAt ? row.archivedAt.toISOString() : '' };
  }

  async listArticles(tenantId: string) {
    await this.ensureDefaultArticles(tenantId);
    const rows = await this.prisma.financeArticle.findMany({ where: { tenantId, archivedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((row) => this.articleDto(row));
  }

  async createArticle(tenantId: string, body: unknown) {
    await this.ensureDefaultArticles(tenantId);
    const input = objectValue(body);
    const name = text(input.name);
    if (!name) throw new BadRequestException('Введите название статьи');
    const parentArticleId = text(input.parentArticleId);
    const parent = parentArticleId ? await this.prisma.financeArticle.findUnique({ where: { tenantId_articleId: { tenantId, articleId: parentArticleId } } }) : null;
    if (parentArticleId && (!parent || parent.archivedAt)) throw new BadRequestException('Родительская статья не найдена');
    const direction = text(input.direction || parent?.direction);
    const economicType = text(input.economicType || parent?.economicType);
    if (!ARTICLE_DIRECTIONS.has(direction)) throw new BadRequestException('Некорректное направление статьи');
    if (!ARTICLE_ECONOMIC_TYPES.has(economicType) || economicType === 'GROUP') throw new BadRequestException('Выберите конечную статью, а не группу');
    if (parent && parent.direction !== direction) throw new BadRequestException('Направление дочерней статьи должно совпадать с родительской');
    const max = await this.prisma.financeArticle.aggregate({ where: { tenantId, parentArticleId }, _max: { position: true } });
    await this.prisma.financeArticle.create({ data: { tenantId, articleId: randomUUID(), parentArticleId, name, direction, economicType, position: (max._max.position || 0) + 10 } });
    return this.snapshot(tenantId);
  }

  async updateArticle(tenantId: string, articleId: string, body: unknown) {
    await this.ensureDefaultArticles(tenantId);
    const id = text(articleId);
    const current = await this.prisma.financeArticle.findUnique({ where: { tenantId_articleId: { tenantId, articleId: id } } });
    if (!current || current.archivedAt) throw new NotFoundException('Статья не найдена');
    const input = objectValue(body);
    const name = text(input.name || current.name);
    if (!name) throw new BadRequestException('Введите название статьи');
    const parentArticleId = input.parentArticleId == null ? current.parentArticleId : text(input.parentArticleId);
    if (parentArticleId === id) throw new BadRequestException('Статья не может быть родителем самой себе');
    const parent = parentArticleId ? await this.prisma.financeArticle.findUnique({ where: { tenantId_articleId: { tenantId, articleId: parentArticleId } } }) : null;
    if (parentArticleId && (!parent || parent.archivedAt)) throw new BadRequestException('Родительская статья не найдена');
    let ancestor = parent;
    let depthGuard = 0;
    while (ancestor && depthGuard < 100) {
      if (ancestor.articleId === id) throw new BadRequestException('Нельзя создать цикл в дереве статей');
      ancestor = ancestor.parentArticleId ? await this.prisma.financeArticle.findUnique({ where: { tenantId_articleId: { tenantId, articleId: ancestor.parentArticleId } } }) : null;
      depthGuard += 1;
    }
    const direction = current.systemKey ? current.direction : text(input.direction || current.direction);
    const economicType = current.systemKey ? current.economicType : text(input.economicType || current.economicType);
    if (!ARTICLE_DIRECTIONS.has(direction) || !ARTICLE_ECONOMIC_TYPES.has(economicType)) throw new BadRequestException('Некорректный экономический характер статьи');
    if (parent && parent.direction !== direction) throw new BadRequestException('Направление дочерней статьи должно совпадать с родительской');
    await this.prisma.financeArticle.update({ where: { id: current.id }, data: { name, parentArticleId, direction, economicType } });
    return this.snapshot(tenantId);
  }

  async archiveArticle(tenantId: string, articleId: string) {
    await this.ensureDefaultArticles(tenantId);
    const id = text(articleId);
    const current = await this.prisma.financeArticle.findUnique({ where: { tenantId_articleId: { tenantId, articleId: id } } });
    if (!current || current.archivedAt) return this.snapshot(tenantId);
    if (current.systemKey) throw new BadRequestException('Системную статью удалить нельзя');
    const child = await this.prisma.financeArticle.findFirst({ where: { tenantId, parentArticleId: id, archivedAt: null } });
    if (child) throw new BadRequestException('Сначала удалите или перенесите вложенные статьи');
    await this.prisma.financeArticle.update({ where: { id: current.id }, data: { archivedAt: new Date() } });
    return this.snapshot(tenantId);
  }

  async recordManualOperation(tenantId: string, body: unknown) {
    await this.ensureDefaultArticles(tenantId);
    const input = objectValue(body);
    const direction = text(input.direction);
    if (!['IN', 'OUT'].includes(direction)) throw new BadRequestException('Для ручной операции выберите доход или расход');
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    if (!walletId) throw new BadRequestException('Выберите кошелёк');
    const operationArticleId = text(input.articleId);
    const rawLines = input.lines == null ? [] : arrayValue(input.lines);
    const simpleAmount = money(input.amount);
    const preparedLines = rawLines.length
      ? rawLines.map((value, index) => {
          const row = objectValue(value);
          const quantity = Math.max(0, numberValue(row.quantity || 1));
          const unitPrice = money(row.unitPrice ?? row.price);
          const total = money(quantity * unitPrice);
          return { lineName: text(row.name) || `Позиция ${index + 1}`, quantity, unitPrice, total, articleId: text(row.articleId || operationArticleId) };
        }).filter((row) => row.quantity > 0 && row.unitPrice > 0 && row.total > 0)
      : (simpleAmount > 0 ? [{ lineName: text(input.name), quantity: 1, unitPrice: simpleAmount, total: simpleAmount, articleId: operationArticleId }] : []);
    if (!preparedLines.length) throw new BadRequestException('Введите сумму или позиции');
    const articleIds = [...new Set(preparedLines.map((line) => line.articleId).filter(Boolean))];
    if (!articleIds.length) throw new BadRequestException('Выберите статью');
    const articles = await this.prisma.financeArticle.findMany({ where: { tenantId, articleId: { in: articleIds }, archivedAt: null } });
    const articleById = new Map(articles.map((article) => [article.articleId, article]));
    for (const line of preparedLines) {
      const article = articleById.get(line.articleId);
      if (!article) throw new BadRequestException('Статья не найдена');
      if (article.economicType === 'GROUP') throw new BadRequestException('Выберите конечную статью, а не группу');
      if (article.direction !== direction) throw new BadRequestException('Статья не соответствует типу операции');
    }
    const operationId = randomUUID();
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const total = money(preparedLines.reduce((sum, line) => sum + line.total, 0));
    const source = { type: 'manual', id: operationId };
    await this.serializable(async (tx) => {
      await this.createOperationWithEntries(tx, tenantId, {
        operationId,
        kind: direction === 'IN' ? 'manual-income' : 'manual-expense',
        source,
        occurredAt,
        data: { direction, articleId: operationArticleId, walletId, walletName, note: text(input.note), total, lines: preparedLines },
        entries: preparedLines.map((line) => {
          const article = articleById.get(line.articleId)!;
          return { walletId, walletName, direction, economicType: article.economicType, amount: line.total, component: 'manual', articleId: article.articleId, articleName: article.name, lineName: line.lineName, quantity: line.quantity, unitPrice: line.unitPrice, note: text(input.note) };
        }),
      });
    });
    return this.snapshot(tenantId);
  }

  async recordSpecialOperation(tenantId: string, body: unknown) {
    await this.ensureDefaultArticles(tenantId);
    const input = objectValue(body);
    const kind = text(input.kind);
    const amount = money(input.amount);
    if (amount <= 0) throw new BadRequestException('Введите сумму операции');
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const operationId = randomUUID();
    const note = text(input.note);
    if (kind === 'transfer') {
      const fromWalletId = text(input.fromWalletId);
      const fromWalletName = text(input.fromWalletName);
      const toWalletId = text(input.toWalletId);
      const toWalletName = text(input.toWalletName);
      if (!fromWalletId || !toWalletId) throw new BadRequestException('Выберите оба кошелька');
      if (fromWalletId === toWalletId) throw new BadRequestException('Для перевода нужны разные кошельки');
      const article = await this.prisma.financeArticle.findFirst({ where: { tenantId, systemKey: 'TRANSFER', archivedAt: null } });
      if (!article) throw new BadRequestException('Системная статья перевода не найдена');
      await this.serializable(async (tx) => {
        await this.createOperationWithEntries(tx, tenantId, {
          operationId, kind: 'transfer', source: { type: 'finance', id: operationId }, occurredAt,
          data: { total: amount, fromWalletId, fromWalletName, toWalletId, toWalletName, note },
          entries: [
            { walletId: fromWalletId, walletName: fromWalletName, direction: 'OUT', economicType: 'TRANSFER', amount, component: 'transfer-out', articleId: article.articleId, articleName: article.name, note },
            { walletId: toWalletId, walletName: toWalletName, direction: 'IN', economicType: 'TRANSFER', amount, component: 'transfer-in', articleId: article.articleId, articleName: article.name, note },
          ],
        });
      });
      return this.snapshot(tenantId);
    }
    const definition = SPECIAL_FINANCE_DEFINITIONS[kind];
    if (!definition) throw new BadRequestException('Неизвестный вид финансовой операции');
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    if (!walletId) throw new BadRequestException('Выберите кошелёк');
    const financeEntity = await this.financeEntity(tenantId, definition.financeEntityType, text(input.financeEntityId));
    if (definition.financeEntityType === 'investment') {
      if (!definition.roles?.includes(financeEntity.role as 'self' | 'raise' | 'external')) throw new BadRequestException('Операция не соответствует роли инвестиции');
      await this.assertInvestmentRoleAllowed(tenantId, financeEntity.role);
    }
    const article = await this.prisma.financeArticle.findFirst({ where: { tenantId, systemKey: definition.systemKey, archivedAt: null } });
    if (!article) throw new BadRequestException('Системная статья операции не найдена');
    await this.serializable(async (tx) => {
      await this.createOperationWithEntries(tx, tenantId, {
        operationId, kind, source: { type: 'finance', id: operationId }, occurredAt,
        data: { total: amount, walletId, walletName, financeEntityType: financeEntity.type, financeEntityId: financeEntity.id, financeEntityName: financeEntity.name, note, articleId: article.articleId },
        entries: [{ walletId, walletName, direction: definition.direction, economicType: definition.economicType, amount, component: kind, articleId: article.articleId, articleName: article.name, lineName: financeEntity.name, quantity: 1, unitPrice: amount, note }],
      });
    });
    return this.snapshot(tenantId);
  }

  async recordPayment(tenantId: string, body: unknown) {
    const input = objectValue(body);
    const source = sourceValue(input.source);
    if (!source.type || !source.id) throw new BadRequestException('У оплаты отсутствует источник');
    const requestedSettlement = validSettlement(input.settlement);
    if (!requestedSettlement) throw new BadRequestException('У оплаты отсутствует расчёт');
    const allocations = allocationsValue(input.allocations);
    const requestedDepositAllocations = depositAllocationsValue(input.depositAllocations);
    if (!allocations.length && !requestedDepositAllocations.length) throw new BadRequestException('Не выбран источник оплаты');
    const cashAllocated = money(allocations.reduce((sum, entry) => sum + entry.amount, 0));
    const depositAllocated = money(requestedDepositAllocations.reduce((sum, entry) => sum + entry.amount, 0));
    const tips = Math.min(cashAllocated, money(input.tips));
    const defaultService = money(cashAllocated - tips + depositAllocated);
    const serviceAmount = money(input.serviceAmount == null ? defaultService : input.serviceAmount);
    if (serviceAmount < 0 || (serviceAmount <= 0 && tips <= 0) || money(serviceAmount + tips) !== money(cashAllocated + depositAllocated)) {
      throw new BadRequestException('Сумма оплаты не совпадает с распределением по источникам');
    }
    const cashServiceAmount = money(cashAllocated - tips);
    const operationId = randomUUID();
    const occurredAt = requiredOccurredAt(input.occurredAt);
    await this.serializable(async (tx) => {
      const condition = await resolvePersonPricePercent(tx, tenantId, input.person, occurredAt);
      const settlement = canonicalSettlementInput(requestedSettlement, condition.percent);
      const paid = Math.max(0, await this.serviceNet(tx, tenantId, source.type, source.id));
      const due = Math.max(0, money(settlement.planTotal - paid));
      if (serviceAmount > due + 0.009) throw new BadRequestException('Оплата превышает остаток к оплате');
      const depositAllocations = await consumeDepositAllocations(tx, tenantId, requestedDepositAllocations, personKey(input.person), occurredAt);
      await this.saveSettlementWith(tx, tenantId, source.type, source.id, settlement);
      const components = splitAllocationComponents(allocations, cashServiceAmount, tips);
      await this.createOperationWithEntries(tx, tenantId, {
        operationId,
        kind: 'payment',
        source,
        occurredAt,
        data: {
          workplace: text(input.workplace), person: clone(objectValue(input.person)), allocations, depositAllocations,
          priceCondition: condition.source ? clone(condition.source) : null,
          cashTotal: cashAllocated, cashServiceAmount, total: money(serviceAmount + tips), serviceAmount, tips, settlement,
        },
        entries: components.map((entry) => ({ ...entry, direction: 'IN', economicType: entry.component === 'tips' ? 'TIPS' : 'SERVICE_REVENUE' })),
      });
    });
    return this.snapshot(tenantId);
  }

  async importRecordSettlement(tenantId: string, recordId: string, procedures: JsonObject[], tx: Prisma.TransactionClient) {
    // Actual work price and historical catalog price are independent input facts.
    if (!procedures.length || procedures.some(item => item.cost == null || item.cost === '')) return;
    const settlement = this.calculateSettlement(procedures.map(item => ({ ...item, sourceType: 'procedure', sourceId: item.id })), 0);
    await this.saveSettlementWith(tx, tenantId, 'record', recordId, settlement);
  }

  async resolveTransferredWallet(tenantId: string, input: JsonObject, tx: Prisma.TransactionClient) {
    const row = await tx.businessAuxiliaryState.findUnique({ where: { tenantId } });
    const wallets = arrayValue(objectValue(row?.data).wallets);
    const found = wallets.filter(wallet => input.walletId ? text(wallet.id) === text(input.walletId) : text(wallet.name) === text(input.wallet));
    if (found.length !== 1) throw new BadRequestException('Не удалось однозначно определить кошелёк оплаты');
    return found[0];
  }

  async importPayment(tenantId: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    const operationId = targetId || randomUUID();
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Сумма имеет неверный формат');
    const fromDeposit=input.paymentSource==='Депозит';
    if (!fromDeposit && !text(input.walletId)) throw new BadRequestException('Не указан кошелёк оплаты');
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const source = input.recordId ? { type: 'record', id: text(input.recordId) } : { type: 'payment', id: operationId };
    let depositAllocations: JsonObject[]=[];
    if(fromDeposit) {
      if(targetId)throw new BadRequestException('Оплата депозитом уже выполнена. Отмените её сеанс перед заменой.');
      const deposit=await this.resolveHistoricalDeposit(tenantId,{...input,personKey:input.person?.key},tx);
      depositAllocations=await consumeDepositAllocations(tx,tenantId,[{depositId:deposit.depositId,amount}],text(input.person?.key),occurredAt,true);
    }
    const allocations = fromDeposit ? [] : [{ walletId: text(input.walletId), walletName: text(input.walletName), amount }];
    const data = { workplace: text(input.workplaceId), person: clone(objectValue(input.person)), allocations,
      cashTotal: fromDeposit?0:amount, cashServiceAmount: fromDeposit?0:amount, total: amount, serviceAmount: amount, tips: 0, depositAllocations };
    const entries = allocations.map(entry => ({ ...entry, component: 'service', direction: 'IN', economicType: 'SERVICE_REVENUE' }));
    const existing = await tx.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId } } });
    if (targetId && !existing) throw new NotFoundException('Перенесённая оплата не найдена');
    if (existing) {
      if (existing.sourceType !== source.type || existing.sourceId !== source.id) throw new BadRequestException('Источник перенесённой оплаты не совпадает. Проверьте запись.');
      await this.replaceOperationWithEntries(tx, tenantId, existing, occurredAt, data, entries);
    } else await this.createOperationWithEntries(tx, tenantId, { operationId, kind: 'payment', source, occurredAt, data, entries });
    // A payment never manufactures a Record settlement.
    return operationId;
  }

  async recordRefund(tenantId: string, operationId: string, body: unknown) {
    const id = text(operationId);
    const payment = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: id } } });
    if (!payment || payment.kind !== 'payment') throw new NotFoundException('Оплата не найдена');
    if (payment.status === 'cancelled') throw new BadRequestException('Отменённую оплату вернуть нельзя');
    const paymentData = objectValue(payment.data);
    const refunds = await this.prisma.financeOperation.findMany({ where: { tenantId, kind: 'refund', originalOperationId: id, status: 'completed' } });
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
    let depositLeft = serviceAmount;
    const restoredDeposits: JsonObject[] = [];
    for (const original of originalDeposits) {
      const previous = restoredByDeposit.get(original.depositId) || { amount: 0, principalAmount: 0, benefitAmount: 0 };
      const originalPrincipal = original.principalAmount || original.amount;
      const originalBenefit = original.benefitAmount;
      const principalAvailable = Math.max(0, money(originalPrincipal - previous.principalAmount));
      const benefitAvailable = Math.max(0, money(originalBenefit - previous.benefitAmount));
      const available = money(principalAvailable + benefitAvailable);
      const restore = Math.min(depositLeft, available);
      const principalAmount = Math.min(restore, principalAvailable);
      const benefitAmount = Math.min(money(restore - principalAmount), benefitAvailable);
      if (restore > 0) restoredDeposits.push({ ...original, amount: restore, principalAmount, benefitAmount });
      depositLeft = money(depositLeft - restore);
      if (depositLeft <= 0.009) break;
    }
    const cashServiceAmount = money(depositLeft);
    const cashRefund = money(cashServiceAmount + tips);
    const walletId = text(input.walletId);
    const walletName = text(input.walletName);
    if (cashRefund > 0.009 && !walletId) throw new BadRequestException('Не выбран кошелёк возврата');
    const refundId = randomUUID();
    const occurredAt = requiredOccurredAt(input.occurredAt);
    await this.serializable(async (tx) => {
      await restoreDepositAllocations(tx, tenantId, restoredDeposits, occurredAt);
      await this.createOperationWithEntries(tx, tenantId, {
        operationId: refundId,
        kind: 'refund',
        source: { type: payment.sourceType, id: payment.sourceId },
        originalOperationId: payment.operationId,
        occurredAt,
        data: {
          workplace: text(paymentData.workplace), person: clone(objectValue(paymentData.person)), walletId, walletName,
          total: money(serviceAmount + tips), cashTotal: cashRefund, cashServiceAmount, serviceAmount, tips,
          depositAllocations: restoredDeposits, reason: text(input.reason), settlement: clone(objectValue(paymentData.settlement)),
        },
        entries: [
          ...(cashServiceAmount > 0 ? [{ walletId, walletName, amount: cashServiceAmount, component: 'service', direction: 'OUT', economicType: 'SERVICE_REFUND' }] : []),
          ...(tips > 0 ? [{ walletId, walletName, amount: tips, component: 'tips', direction: 'OUT', economicType: 'TIPS_REFUND' }] : []),
        ],
      });
    });
    return this.snapshot(tenantId);
  }

  async correctOperation(tenantId: string, operationId: string, body: unknown) {
    await this.ensureDefaultArticles(tenantId);
    const id = text(operationId);
    const current = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: id } }, include: { ledgerEntries: true } });
    if (!current) throw new NotFoundException('Операция не найдена');
    if (current.kind === 'cancel' || current.status === 'cancelled') throw new BadRequestException('Отменённую операцию корректировать нельзя');
    const related = await this.prisma.financeOperation.findFirst({ where: { tenantId, originalOperationId: current.operationId }, select: { operationId: true } });
    if (related) throw new BadRequestException('Операцию со связанными возвратами или отменами сначала нужно привести в исходное состояние');
    const input = objectValue(body);
    const currentData = objectValue(current.data);
    const occurredAt = requiredOccurredAt(input.occurredAt ?? current.occurredAt);
    let nextData: JsonObject = {};
    let nextEntries: JsonObject[] = [];

    if (current.kind === 'manual-income' || current.kind === 'manual-expense') {
      const direction = current.kind === 'manual-income' ? 'IN' : 'OUT';
      const walletId = text(input.walletId ?? currentData.walletId);
      const walletName = text(input.walletName ?? currentData.walletName);
      if (!walletId) throw new BadRequestException('Выберите кошелёк');
      const operationArticleId = text(input.articleId ?? currentData.articleId);
      const rawLines = input.lines == null ? arrayValue(currentData.lines) : arrayValue(input.lines);
      const simpleAmount = money(input.amount == null ? currentData.total : input.amount);
      const preparedLines = rawLines.length
        ? rawLines.map((value, index) => {
            const row = objectValue(value);
            const quantity = Math.max(0, numberValue(row.quantity || 1));
            const unitPrice = money(row.unitPrice ?? row.price);
            const total = money(quantity * unitPrice);
            return { lineName: text(row.name ?? row.lineName) || `Позиция ${index + 1}`, quantity, unitPrice, total, articleId: text(row.articleId || operationArticleId) };
          }).filter((row) => row.quantity > 0 && row.unitPrice > 0 && row.total > 0)
        : (simpleAmount > 0 ? [{ lineName: text(input.name), quantity: 1, unitPrice: simpleAmount, total: simpleAmount, articleId: operationArticleId }] : []);
      if (!preparedLines.length) throw new BadRequestException('Введите сумму или позиции');
      const articleIds = [...new Set(preparedLines.map((line) => line.articleId).filter(Boolean))];
      if (!articleIds.length) throw new BadRequestException('Выберите статью');
      const articles = await this.prisma.financeArticle.findMany({ where: { tenantId, articleId: { in: articleIds }, archivedAt: null } });
      const articleById = new Map(articles.map((article) => [article.articleId, article]));
      for (const line of preparedLines) {
        const article = articleById.get(line.articleId);
        if (!article) throw new BadRequestException('Статья не найдена');
        if (article.economicType === 'GROUP') throw new BadRequestException('Выберите конечную статью, а не группу');
        if (article.direction !== direction) throw new BadRequestException('Статья не соответствует типу операции');
      }
      const note = input.note == null ? text(currentData.note) : text(input.note);
      const total = money(preparedLines.reduce((sum, line) => sum + line.total, 0));
      nextData = { direction, articleId: operationArticleId, walletId, walletName, note, total, lines: preparedLines };
      nextEntries = preparedLines.map((line) => {
        const article = articleById.get(line.articleId)!;
        return { walletId, walletName, direction, economicType: article.economicType, amount: line.total, component: 'manual', articleId: article.articleId, articleName: article.name, lineName: line.lineName, quantity: line.quantity, unitPrice: line.unitPrice, note };
      });
    } else if ([...Object.keys(SPECIAL_FINANCE_DEFINITIONS), 'transfer'].includes(current.kind)) {
      const amount = money(input.amount == null ? currentData.total : input.amount);
      if (amount <= 0) throw new BadRequestException('Введите сумму операции');
      const note = input.note == null ? text(currentData.note) : text(input.note);
      if (current.kind === 'transfer') {
        const fromWalletId = text(input.fromWalletId ?? currentData.fromWalletId);
        const fromWalletName = text(input.fromWalletName ?? currentData.fromWalletName);
        const toWalletId = text(input.toWalletId ?? currentData.toWalletId);
        const toWalletName = text(input.toWalletName ?? currentData.toWalletName);
        if (!fromWalletId || !toWalletId) throw new BadRequestException('Выберите оба кошелька');
        if (fromWalletId === toWalletId) throw new BadRequestException('Для перевода нужны разные кошельки');
        const article = await this.prisma.financeArticle.findFirst({ where: { tenantId, systemKey: 'TRANSFER', archivedAt: null } });
        if (!article) throw new BadRequestException('Системная статья перевода не найдена');
        nextData = { total: amount, fromWalletId, fromWalletName, toWalletId, toWalletName, note };
        nextEntries = [
          { walletId: fromWalletId, walletName: fromWalletName, direction: 'OUT', economicType: 'TRANSFER', amount, component: 'transfer-out', articleId: article.articleId, articleName: article.name, note },
          { walletId: toWalletId, walletName: toWalletName, direction: 'IN', economicType: 'TRANSFER', amount, component: 'transfer-in', articleId: article.articleId, articleName: article.name, note },
        ];
      } else {
        const definition = SPECIAL_FINANCE_DEFINITIONS[current.kind];
        if (!definition) throw new BadRequestException('Неизвестный вид финансовой операции');
        const walletId = text(input.walletId ?? currentData.walletId);
        const walletName = text(input.walletName ?? currentData.walletName);
        if (!walletId) throw new BadRequestException('Выберите кошелёк');
        const financeEntity = await this.financeEntity(tenantId, definition.financeEntityType, text(input.financeEntityId ?? currentData.financeEntityId));
        if (definition.financeEntityType === 'investment') {
          if (!definition.roles?.includes(financeEntity.role as 'self' | 'raise' | 'external')) throw new BadRequestException('Операция не соответствует роли инвестиции');
          await this.assertInvestmentRoleAllowed(tenantId, financeEntity.role);
        }
        const article = await this.prisma.financeArticle.findFirst({ where: { tenantId, systemKey: definition.systemKey, archivedAt: null } });
        if (!article) throw new BadRequestException('Системная статья операции не найдена');
        nextData = { total: amount, walletId, walletName, financeEntityType: financeEntity.type, financeEntityId: financeEntity.id, financeEntityName: financeEntity.name, note, articleId: article.articleId };
        nextEntries = [{ walletId, walletName, direction: definition.direction, economicType: definition.economicType, amount, component: current.kind, articleId: article.articleId, articleName: article.name, lineName: financeEntity.name, quantity: 1, unitPrice: amount, note }];
      }
    } else if (current.kind === 'payment') {
      const requestedDeposits = input.depositAllocations == null ? depositAllocationsValue(currentData.depositAllocations) : depositAllocationsValue(input.depositAllocations);
      if (depositAllocationsValue(currentData.depositAllocations).length || requestedDeposits.length) {
        throw new BadRequestException('Оплату с депозитом нельзя корректировать напрямую. Отмените оплату и проведите её заново.');
      }
      const settlement = validSettlement(currentData.settlement);
      if (!settlement) throw new BadRequestException('У оплаты отсутствует расчёт');
      const allocations = input.allocations == null ? allocationsValue(currentData.allocations) : allocationsValue(input.allocations);
      if (!allocations.length) throw new BadRequestException('Не выбран источник оплаты');
      const cashAllocated = money(allocations.reduce((sum, entry) => sum + entry.amount, 0));
      const tips = Math.min(cashAllocated, money(input.tips == null ? currentData.tips : input.tips));
      const cashServiceAmount = money(cashAllocated - tips);
      const serviceAmount = money(input.serviceAmount == null ? cashServiceAmount : input.serviceAmount);
      if (serviceAmount < 0 || (serviceAmount <= 0 && tips <= 0) || money(serviceAmount + tips) !== cashAllocated) {
        throw new BadRequestException('Сумма оплаты не совпадает с распределением по источникам');
      }
      const otherPaid = await this.serviceNet(this.prisma, tenantId, current.sourceType, current.sourceId, current.operationId);
      const due = Math.max(0, money(settlement.planTotal - otherPaid));
      if (serviceAmount > due + 0.009) throw new BadRequestException('Оплата превышает остаток к оплате');
      const components = splitAllocationComponents(allocations, cashServiceAmount, tips);
      nextData = {
        workplace: text(currentData.workplace), person: clone(objectValue(currentData.person)), allocations, depositAllocations: [],
        cashTotal: cashAllocated, cashServiceAmount, total: money(serviceAmount + tips), serviceAmount, tips, settlement,
      };
      nextEntries = components.map((entry) => ({ ...entry, direction: 'IN', economicType: entry.component === 'tips' ? 'TIPS' : 'SERVICE_REVENUE' }));
    } else if (current.kind === 'refund' && depositAllocationsValue(currentData.depositAllocations).length) {
      throw new BadRequestException('Возврат со списанием депозита нельзя корректировать напрямую. Отмените возврат и проведите его заново.');
    } else if (current.kind === 'refund') {
      const paymentId = text(current.originalOperationId);
      const payment = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: paymentId } } });
      if (!payment || payment.kind !== 'payment') throw new NotFoundException('Исходная оплата не найдена');
      const paymentData = objectValue(payment.data);
      const siblings = await this.prisma.financeOperation.findMany({ where: { tenantId, kind: 'refund', originalOperationId: paymentId, status: 'completed', operationId: { not: current.operationId } } });
      const refundedTips = money(siblings.reduce((sum, row) => sum + money(objectValue(row.data).tips), 0));
      const refundedService = money(siblings.reduce((sum, row) => sum + money(objectValue(row.data).serviceAmount), 0));
      const tipsRemaining = Math.max(0, money(paymentData.tips - refundedTips));
      const serviceRemaining = Math.max(0, money(paymentData.serviceAmount - refundedService));
      const remaining = money(tipsRemaining + serviceRemaining);
      const requested = Math.min(remaining, money(input.amount == null ? currentData.total : input.amount));
      if (requested <= 0) throw new BadRequestException('Некорректная сумма возврата');
      const serviceAmount = Math.min(requested, serviceRemaining);
      const tips = Math.min(money(requested - serviceAmount), tipsRemaining);
      const walletId = text(input.walletId ?? currentData.walletId);
      const walletName = text(input.walletName ?? currentData.walletName);
      if (!walletId) throw new BadRequestException('Не выбран кошелёк возврата');
      const reason = input.reason == null ? text(currentData.reason) : text(input.reason);
      nextData = { workplace: text(paymentData.workplace), person: clone(objectValue(paymentData.person)), walletId, walletName, total: money(serviceAmount + tips), serviceAmount, tips, reason, settlement: clone(objectValue(paymentData.settlement)) };
      nextEntries = [
        ...(serviceAmount > 0 ? [{ walletId, walletName, amount: serviceAmount, component: 'service', direction: 'OUT', economicType: 'SERVICE_REFUND' }] : []),
        ...(tips > 0 ? [{ walletId, walletName, amount: tips, component: 'tips', direction: 'OUT', economicType: 'TIPS_REFUND' }] : []),
      ];
    } else {
      throw new BadRequestException('Для этой операции корректировка недоступна');
    }
    await this.serializable(async (tx) => { await this.replaceOperationWithEntries(tx, tenantId, current, occurredAt, nextData, nextEntries); });
    return this.snapshot(tenantId);
  }

  async cancelOperation(tenantId: string, operationId: string, body: unknown) {
    const id = text(operationId);
    const input = objectValue(body);
    const occurredAt = requiredOccurredAt(input.occurredAt);
    const original = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: id } } });
    if (!original) throw new NotFoundException('Операция не найдена');
    if (original.status === 'cancelled') return this.snapshot(tenantId);
    if (original.kind === 'deposit-funding' || original.kind === 'deposit-withdrawal') {
      throw new BadRequestException('Финансовый факт Депозита отменяется через сам Депозит, чтобы не разрушить его состояние.');
    }
    await this.serializable(async (tx) => {
      const targets = [original];
      if (original.kind === 'payment') {
        const refunds = await tx.financeOperation.findMany({ where: { tenantId, kind: 'refund', originalOperationId: original.operationId, status: 'completed' } });
        targets.push(...refunds);
      }
      for (const target of targets) {
        const targetData = objectValue(target.data);
        const depositAllocations = depositAllocationsValue(targetData.depositAllocations);
        if (target.kind === 'payment' && depositAllocations.length) {
          await restoreDepositAllocations(tx, tenantId, depositAllocations, occurredAt);
        }
        if (target.kind === 'refund' && depositAllocations.length) {
          await reconsumeDepositAllocations(tx, tenantId, depositAllocations, personKey(targetData.person), occurredAt);
        }
        await this.createReversalFor(tx, tenantId, target.operationId, text(input.reason) || 'incorrect-entry', occurredAt);
        await tx.financeOperation.update({ where: { id: target.id }, data: { status: 'cancelled' } });
      }
    });
    return this.snapshot(tenantId);
  }

  async hardDeleteOperation(tenantId: string, operationId: string) {
    const id = text(operationId);
    if (!id) throw new BadRequestException('Операция не найдена');
    const current = await this.prisma.financeOperation.findUnique({ where: { tenantId_operationId: { tenantId, operationId: id } }, select: { operationId: true } });
    if (!current) return this.snapshot(tenantId);
    await this.serializable(async (tx) => {
      const operationIds = new Set([current.operationId]);
      let frontier = [current.operationId];
      while (frontier.length) {
        const related = await tx.financeOperation.findMany({ where: { tenantId, originalOperationId: { in: frontier } }, select: { operationId: true } });
        const next = related.map((row) => row.operationId).filter((relatedId) => !operationIds.has(relatedId));
        next.forEach((relatedId) => operationIds.add(relatedId));
        frontier = next;
      }
      const operations = await tx.financeOperation.findMany({ where: { tenantId, operationId: { in: [...operationIds] } }, select: { kind: true, data: true } });
      if (operations.some((row) => row.kind === 'deposit-funding' || row.kind === 'deposit-withdrawal' || depositAllocationsValue(objectValue(row.data).depositAllocations).length)) {
        throw new BadRequestException('Операция связана с Депозитом. Используйте отмену или удаление из контура Депозита.');
      }
      await tx.financeOperation.deleteMany({ where: { tenantId, operationId: { in: [...operationIds] } } });
    });
    return this.snapshot(tenantId);
  }

  async hardDeleteWallet(tenantId: string, platformAccountId: string, walletId: string) {
    const accountId = text(platformAccountId);
    const id = text(walletId);
    if (!id) throw new BadRequestException('Касса не найдена');
    if (id === 'cash' || id === 'cashless') throw new BadRequestException('Системную кассу полностью удалить нельзя');
    const admin = await this.prisma.platformAdmin.findUnique({ where: { platformAccountId: accountId }, select: { id: true } });
    if (!admin) throw new ForbiddenException('Полное удаление доступно только администратору платформы');
    await this.serializable(async (tx) => {
      const direct = await tx.financeOperation.findMany({ where: { tenantId, ledgerEntries: { some: { walletId: id } } }, select: { operationId: true } });
      const operationIds = new Set(direct.map((row) => row.operationId));
      let frontier = [...operationIds];
      while (frontier.length) {
        const related = await tx.financeOperation.findMany({ where: { tenantId, originalOperationId: { in: frontier } }, select: { operationId: true } });
        const next = related.map((row) => row.operationId).filter((relatedId) => !operationIds.has(relatedId));
        next.forEach((relatedId) => operationIds.add(relatedId));
        frontier = next;
      }
      if (operationIds.size) {
        const operations = await tx.financeOperation.findMany({ where: { tenantId, operationId: { in: [...operationIds] } }, select: { kind: true, data: true } });
        if (operations.some((row) => row.kind === 'deposit-funding' || row.kind === 'deposit-withdrawal' || depositAllocationsValue(objectValue(row.data).depositAllocations).length)) {
          throw new BadRequestException('Касса содержит связанные факты Депозита. Сначала закройте или перенесите их штатными действиями.');
        }
        await tx.financeOperation.deleteMany({ where: { tenantId, operationId: { in: [...operationIds] } } });
      }
    });
    return this.snapshot(tenantId);
  }

  async snapshot(tenantId: string) {
    await this.ensureDefaultArticles(tenantId);
    const [articles, settlements, operations, ledger] = await Promise.all([
      this.prisma.financeArticle.findMany({ where: { tenantId, archivedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.financeSettlement.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.financeOperation.findMany({ where: { tenantId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.financeLedgerEntry.findMany({ where: { tenantId }, orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const operationRows = operations.map((row) => ({
      operationId: row.operationId, kind: row.kind, status: row.status, source: { type: row.sourceType, id: row.sourceId },
      originalOperationId: row.originalOperationId, occurredAt: row.occurredAt.toISOString(), recordedAt: row.createdAt.toISOString(), data: clone(row.data),
    }));
    const operationById = new Map(operations.map((operation) => [operation.id, operation.operationId]));
    const ledgerRows = ledger.map((row) => ({
      entryId: row.entryId,
      operationId: operationById.get(row.financeOperationId) || '',
      walletId: row.walletId,
      walletName: text(objectValue(row.data).walletName),
      direction: row.direction,
      economicType: row.economicType,
      amount: numberValue(row.amount),
      occurredAt: row.occurredAt.toISOString(),
      recordedAt: row.createdAt.toISOString(),
      source: { type: row.sourceType, id: row.sourceId },
      component: text(objectValue(row.data).component),
      relatedOperationId: text(objectValue(row.data).relatedOperationId),
      articleId: text(objectValue(row.data).articleId),
      articleName: text(objectValue(row.data).articleName),
      lineName: text(objectValue(row.data).lineName),
      quantity: objectValue(row.data).quantity == null ? null : numberValue(objectValue(row.data).quantity),
      unitPrice: objectValue(row.data).unitPrice == null ? null : money(objectValue(row.data).unitPrice),
      note: text(objectValue(row.data).note),
    }));
    return {
      version: 8,
      articles: articles.map((row) => this.articleDto(row)),
      settlements: settlements.map((row) => ({ source: { type: row.sourceType, id: row.sourceId }, settlement: clone(row.data), recordedAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
      operations: operationRows,
      ledger: ledgerRows,
    };
  }
}
