import { randomUUID } from 'node:crypto';
import { captureOwnedState, restoreOwnedState, TransferState } from '../data-transfer/restore-state';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { SaasAccessService } from '../saas-access/saas-access.service';

type JsonObject = Record<string, any>;
type AuxiliaryBundle = {
  wallets: JsonObject[];
  investments: JsonObject[];
  loans: JsonObject[];
  tags: JsonObject[];
  products: JsonObject[];
  productHistory: JsonObject[];
  cardAppearanceTemplates: JsonObject[];
  depositPrograms: JsonObject[];
};

const DATASETS = new Set(['wallets', 'investments', 'loans', 'tags', 'products', 'productHistory', 'cardAppearanceTemplates', 'depositPrograms']);

function objectValue(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalize(value: unknown): AuxiliaryBundle {
  const source = objectValue(value);
  return {
    wallets: (Array.isArray(source.wallets) ? source.wallets : []).map((item) => clone(objectValue(item))),
    investments: (Array.isArray(source.investments) ? source.investments : []).map((item) => clone(objectValue(item))),
    loans: (Array.isArray(source.loans) ? source.loans : []).map((item) => clone(objectValue(item))),
    tags: (Array.isArray(source.tags) ? source.tags : []).map((item) => clone(objectValue(item))),
    products: (Array.isArray(source.products) ? source.products : []).map((item) => clone(objectValue(item))),
    productHistory: (Array.isArray(source.productHistory) ? source.productHistory : []).map((item) => clone(objectValue(item))),
    cardAppearanceTemplates: (Array.isArray(source.cardAppearanceTemplates) ? source.cardAppearanceTemplates : []).map((item) => clone(objectValue(item))),
    depositPrograms: [],
  };
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function json(value: unknown): Prisma.InputJsonValue {
  return clone(value) as Prisma.InputJsonValue;
}

const DEPOSIT_MUTABLE_FIELDS = new Set(['status', 'archivedAt', 'cardAppearance', 'photo', 'photoPosition']);

function protectedDepositSnapshot(value: unknown) {
  const source = clone(objectValue(value));
  return Object.fromEntries(Object.entries(source).filter(([key]) => !DEPOSIT_MUTABLE_FIELDS.has(key)));
}

@Injectable()
export class AuxiliaryStateService {
  transferState(tx: Prisma.TransactionClient, tenantId: string) { return captureOwnedState(tx, tenantId, ['BusinessAuxiliaryState', 'LoyaltyDepositProgram']); }
  restoreTransfer(tx: Prisma.TransactionClient, tenantId: string, before: TransferState, after: TransferState, checkOnly = false) { return restoreOwnedState(tx,tenantId,['BusinessAuxiliaryState', 'LoyaltyDepositProgram'],before,after,checkOnly); }

  async importNamedFact(tenantId: string, domain: string, input: JsonObject, targetId: string, tx: Prisma.TransactionClient) {
    const name = text(input.name); if (!name) throw new BadRequestException('Не указано название');
    if (domain === 'programs') {
      const rows=await tx.loyaltyDepositProgram.findMany({where:{tenantId}});
      const matches=rows.filter(row=>text(objectValue(row.data).name)===name);
      if (!targetId && matches.length>1) throw new ConflictException('Не удалось однозначно определить программу');
      const existing=targetId ? rows.find(row=>row.programId===targetId) : matches[0];
      const id=existing?.programId || randomUUID();
      const modes: JsonObject={'Нет':'none','Скидка':'discount','Начисление':'accrual'};
      const data: JsonObject={...objectValue(existing?.data),id,name};
      if (input.benefitType !== undefined) { data.benefitType=modes[input.benefitType] || input.benefitType; if (!['none','discount','accrual'].includes(data.benefitType)) throw new BadRequestException('Неизвестный вид выгоды программы'); }
      for (const [field,to] of [['programAmount','amount'],['benefitValue','benefitValue'],['termStartDate','termStartDate'],['termEndDate','termEndDate'],['programStatus','status']]) if(input[field]!==undefined)data[to]=input[field];
      if (data.termEndDate) data.termMode='dated';
      if (existing) this.protectDepositPrograms([existing.data],[data]);
      await tx.loyaltyDepositProgram.upsert({where:{tenantId_programId:{tenantId,programId:id}},create:{tenantId,programId:id,data:json(data)},update:{data:json(data)}});
      return id;
    }
    const dataset=domain==='wallets'?'wallets':domain==='loans'?'loans':'investments';
    const stored=await tx.businessAuxiliaryState.findUnique({where:{tenantId}});const state=objectValue(stored?.data);
    const rows=Array.isArray(state[dataset])?state[dataset]:[];
    const matches=rows.filter((row: JsonObject)=>text(row.name)===name);
    if(!targetId && matches.length>1)throw new ConflictException('Название неоднозначно. Проверьте данные.');
    const existing=targetId?rows.find((row:JsonObject)=>row.id===targetId):matches[0];
    if(targetId&&!existing)throw new BadRequestException('Перенесённые данные не найдены');
    const id=existing?.id || randomUUID();
    const data={...existing,id,name};
    if (domain==='wallets' && input.walletType) { const types:JsonObject={'Наличные':'cash','Безналичные':'noncash'};if(!types[input.walletType])throw new BadRequestException('Уточните вид кошелька');data.type=types[input.walletType]; }
    if(domain==='loans') data.loanTerms={...existing?.loanTerms,...Object.fromEntries(['lenderName','interestRate','ratePeriod','repaymentMode','endDate'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]])),...(input.endDate?{termMode:'date'}:{})};
    if(domain==='investments') {
      if(input.investmentRole && !['self','raise','external'].includes(input.investmentRole)) throw new BadRequestException('Уточните роль инвестиции');
      data.investmentTerms={...existing?.investmentTerms,...(input.investmentRole?{role:input.investmentRole}:{}),...(input.endDate?{termMode:'date',endDate:input.endDate}:{})};
      await this.assertInvestmentMutationAllowed(tenantId,existing?[existing]:[],[data]);
    }
    state[dataset]=existing?rows.map((row:JsonObject)=>row.id===id?data:row):[...rows,data];
    await tx.businessAuxiliaryState.upsert({where:{tenantId},create:{tenantId,data:json(state)},update:{data:json(state)}});
    return id;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SaasAccessService,
  ) {}

  private async ensureState(tenantId: string) {
    return this.prisma.businessAuxiliaryState.upsert({
      where: { tenantId },
      create: { tenantId, data: json(normalize({})) },
      update: {},
    });
  }

  private async depositPrograms(tenantId: string) {
    const rows = await this.prisma.loyaltyDepositProgram.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }, { programId: 'asc' }],
    });
    return rows.map((row) => clone(objectValue(row.data)));
  }

  async get(tenantId: string) {
    const row = await this.ensureState(tenantId);
    const current = normalize(row.data);
    current.depositPrograms = await this.depositPrograms(tenantId);
    return current;
  }

  private investmentRole(value: unknown) {
    const entity = objectValue(value);
    const terms = objectValue(entity.investmentTerms);
    const role = text(terms.role);
    return ['self', 'raise', 'external'].includes(role) ? role : 'raise';
  }

  private protectInvestmentAgreements(before: unknown[], after: unknown[]) {
    const beforeById = new Map<string, JsonObject>(
      before
        .map((value): [string, JsonObject] => {
          const entity = objectValue(value);
          return [text(entity.id), entity];
        })
        .filter(([id]) => Boolean(id)),
    );

    return after.map((value) => {
      const entity = clone(objectValue(value));
      const id = text(entity.id);
      if (!id) return entity;

      const previous = beforeById.get(id);
      const incomingTerms = objectValue(entity.investmentTerms);
      if (!previous) {
        if (this.investmentRole(entity) !== 'raise') return entity;
        const participantAccountId = text(incomingTerms.participantAccountId);
        entity.investmentTerms = {
          ...incomingTerms,
          participantStatus: participantAccountId ? 'pending' : '',
          participantRespondedAt: '',
        };
        return entity;
      }

      const previousTerms = objectValue(previous.investmentTerms);
      const previousRole = this.investmentRole(previous);
      const previousStatus = text(previousTerms.participantStatus);
      const previousParticipantId = text(previousTerms.participantAccountId);
      const nextParticipantId = text(incomingTerms.participantAccountId);

      if (previousStatus === 'accepted') {
        entity.investmentTerms = clone(previousTerms);
        return entity;
      }

      let participantStatus = previousStatus;
      let participantRespondedAt = text(previousTerms.participantRespondedAt);
      if (previousRole === 'raise' && nextParticipantId !== previousParticipantId) {
        participantStatus = nextParticipantId ? 'pending' : '';
        participantRespondedAt = '';
      }

      entity.investmentTerms = {
        ...incomingTerms,
        role: previousRole,
        participantStatus,
        participantRespondedAt,
      };
      return entity;
    });
  }

  private protectDepositPrograms(before: unknown[], after: unknown[]) {
    const beforeById = new Map<string, JsonObject>(
      before
        .map((value): [string, JsonObject] => {
          const entity = objectValue(value);
          return [text(entity.id), entity];
        })
        .filter(([id]) => Boolean(id)),
    );
    const seenId = new Set<string>();
    const next = after.map((value) => {
      const entity = clone(objectValue(value));
      const id = text(entity.id);
      if (!id) throw new BadRequestException('У депозитной программы отсутствует id');
      if (seenId.has(id)) throw new BadRequestException('Депозитная программа продублирована');
      seenId.add(id);
      const previous = beforeById.get(id);
      if (previous && JSON.stringify(stable(protectedDepositSnapshot(previous))) !== JSON.stringify(stable(protectedDepositSnapshot(entity)))) {
        throw new ConflictException('Условия созданной депозитной программы нельзя изменять. Создайте новую программу.');
      }
      return entity;
    });
    const removed = [...beforeById.keys()].filter((id) => !seenId.has(id));
    if (removed.length) {
      throw new ConflictException('Депозитную программу нельзя удалять с историей. Закройте или архивируйте программу.');
    }
    return next;
  }

  private async assertInvestmentMutationAllowed(tenantId: string, before: unknown[], after: unknown[]) {
    const beforeById = new Map<string, JsonObject>(
      before
        .map((value): [string, JsonObject] => {
          const entity = objectValue(value);
          return [text(entity.id), entity];
        })
        .filter(([id]) => Boolean(id)),
    );
    const changedRoles = new Set<string>();
    for (const value of after) {
      const entity = objectValue(value);
      const id = text(entity.id);
      if (!id) continue;
      const previous = beforeById.get(id);
      if (previous && JSON.stringify(stable(previous)) === JSON.stringify(stable(entity))) continue;
      changedRoles.add(this.investmentRole(entity));
    }
    for (const role of changedRoles) {
      const capabilityKey = role === 'self'
        ? 'finance.investment.self.access'
        : role === 'external'
          ? 'finance.investment.external.access'
          : 'finance.investment.raise.access';
      const capability = await this.access.resolveCapability(tenantId, capabilityKey);
      if (capability.enabled !== true) throw new BadRequestException('Этот режим инвестиций недоступен');
    }
  }

  private async updateDepositPrograms(tenantId: string, requested: unknown[]) {
    const before = await this.depositPrograms(tenantId);
    const next = this.protectDepositPrograms(before, requested);
    await this.prisma.$transaction(async (tx) => {
      for (const program of next) {
        const programId = text(objectValue(program).id);
        await tx.loyaltyDepositProgram.upsert({
          where: { tenantId_programId: { tenantId, programId } },
          create: { tenantId, programId, data: json(program) },
          update: { data: json(program) },
        });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.get(tenantId);
  }

  async updateDataset(tenantId: string, dataset: string, body: unknown) {
    const key = text(dataset);
    if (!DATASETS.has(key)) throw new BadRequestException('Неизвестный набор связанных данных');
    const value = objectValue(body).value;
    const requested = Array.isArray(value) ? clone(value) : [];
    if (key === 'depositPrograms') return this.updateDepositPrograms(tenantId, requested);

    const row = await this.ensureState(tenantId);
    const current = normalize(row.data);
    let next = requested;
    if (key === 'investments') next = this.protectInvestmentAgreements(current.investments, requested);
    if (key === 'investments') {
      await this.assertInvestmentMutationAllowed(tenantId, current.investments, next);
    }
    (current as any)[key] = next;
    const persisted = { ...current } as any;
    delete persisted.depositPrograms;
    await this.prisma.businessAuxiliaryState.update({ where: { tenantId }, data: { data: json(persisted) } });
    return this.get(tenantId);
  }
}
