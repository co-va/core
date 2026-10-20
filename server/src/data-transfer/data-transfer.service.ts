import { AuxiliaryStateService } from '../auxiliary-state/auxiliary-state.service';
import { PersonalAccountFinanceService } from '../finance/personal-account-finance.service';
import { HistoryService } from '../history/history.service';
import { captureOwnedState, restoreOwnedState, assertNoIndependentReferences, TransferState } from './restore-state';
import { STANDARD_FIELDS, STANDARD_LABELS, isStandard, standardColumns } from './standard';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { BusinessStateService } from '../business-state/business-state.service';
import { ProfileService } from '../profile/profile.service';
import { RecordService } from '../record/record.service';
import { FinanceService } from '../finance/finance.service';
import { InventoryService } from '../inventory/inventory.service';
import { ProcedureService } from '../procedure/procedure.service';
import { SaasAccessService } from '../saas-access/saas-access.service';
import { calendarDate, canonical, clock, decimal, DOMAINS, Fact, instant, LABELS, text } from './formats';
import { defaultColumns, defaultDomain, DOMAIN_FIELDS, FIELDS, readSource, SourceInput, sourceFacts, transferWorkbook } from './source';

type Tx = Prisma.TransactionClient;
type Values = Record<string, any>;
class PreviewRollback extends Error { constructor(readonly result: any) { super('preview'); } }
const kindValues: Values = { 'Приход': 'RECEIPT', 'Расход': 'CONSUMPTION', 'Списание': 'WRITE_OFF', 'Продажа': 'SALE', 'Возврат': 'RETURN', 'Корректировка':'ADJUSTMENT', 'Начальный остаток':'RECEIPT' };
@Injectable()
export class DataTransferService {
  constructor(private readonly prisma: PrismaService, private readonly people: BusinessStateService,
    private readonly profiles: ProfileService, private readonly records: RecordService,
    private readonly finance: FinanceService, private readonly inventory: InventoryService,
    private readonly procedures: ProcedureService, private readonly access: SaasAccessService,
    private readonly auxiliary: AuxiliaryStateService, private readonly personalAccounts: PersonalAccountFinanceService, private readonly history: HistoryService) {}

  async inspect(input: SourceInput) {
    try {
      const parsed = await readSource(input);
      return { fields: STANDARD_LABELS, instructions: STANDARD_FIELDS, domainFields: DOMAIN_FIELDS, domains: { ...LABELS, mixed: 'Несколько видов данных (CRM)' }, sheets: parsed.sheets.map(sheet => ({
        name: sheet.name, headers: sheet.headers, count: sheet.rows.length, sample: sheet.rows.slice(0, 3),
        standard: sheet.name==='Данные'&&isStandard(sheet.headers), domain: sheet.name==='Данные'&&isStandard(sheet.headers)?'standard':defaultDomain(sheet.name), columns: isStandard(sheet.headers)?standardColumns(sheet.headers):defaultColumns(sheet.headers),
      })) };
    } catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Не удалось прочитать файл'); }
  }

  async workbook(input: any) { return transferWorkbook(Array.isArray(input?.rows) ? input.rows : [], input?.template === true); }

  private async reference(tx: Tx, tenantId: string, domain: string, value: unknown, source: string) {
    const key = text(value); if (!key) return '';
    const found = await tx.dataTransferFact.findFirst({ where: { tenantId, domain, OR: [{ id: key }, { sourceKey: `${source}:${domain}:${key}` }, { sourceKey: key }] } });
    if (!found) throw Error(`Не найден связанный факт: ${LABELS[domain]}, ID ${key}`);
    return found.targetId;
  }

  private async linkedValues(tx: Tx, tenantId: string, values: Values, source: string) {
    const v = { ...values };
    for (const [field, domain, target] of [['personTransferId','people','personKey'], ['recordTransferId','records','recordId'], ['workplaceTransferId','workplaces','workplaceKey'], ['itemTransferId','items','itemId']]) {
      if (v[field]) {
        const id = await this.reference(tx, tenantId, domain, v[field], source);
        if (v[target] && v[target] !== id) throw Error(`Конфликт связанного ID: ${FIELDS[target]}`);
        v[target] = id;
      }
    }
    return v;
  }

  private normalize(fact: Fact) {
    const v = { ...fact.values };
    for (const [field, value] of Object.entries(v)) {
      if (value && typeof value === 'object' && !(value instanceof Date)) throw Error(`${FIELDS[field] || field}: ${value.invalid || 'неверный тип значения'}`);
    }
    if (!DOMAINS.includes(fact.domain)) throw Error('Выберите тип данных для листа');
    for(const field of ['date','birthday','scheduleDate','termStartDate','termEndDate','endDate','expiresAt'])if(v[field]!=null)v[field]=calendarDate(v[field]);
    for (const field of ['from', 'to','scheduleFrom','scheduleTo']) if (v[field] != null) v[field] = clock(v[field]);
    for (const field of ['occurredAt', 'createdAt']) if (v[field] != null) v[field] = instant(v[field]);
    for (const field of ['price', 'cost', 'discountPercent', 'discountMoney', 'duration', 'amount', 'quantity', 'unitCost','programAmount','benefitValue','depositAmount','accountAmount','spendLimitPercent','financeAmount','interestRate','minStock','targetStock','packageQuantity','grossWeight','tareWeight','lastPurchasePrice','listPrice','supplierDiscount','actualPrice','expectedQuantity','actualQuantity']) {
      if (v[field] != null) v[field] = decimal(v[field], FIELDS[field]);
    }
    if(v.discount!==undefined) {
      const value=text(v.discount);
      if(value.endsWith('%'))v.discountPercent=decimal(value.slice(0,-1),'Скидка');else v.discountMoney=decimal(value,'Скидка');
      delete v.discount;
    }
    for(const field of ['trackLots','canConsume','canSell','visibleToEndUser'])if(v[field]!==undefined){
      if(![true,false,'Да','Нет','да','нет'].includes(v[field]))throw Error(`${FIELDS[field]}: укажите Да или Нет`);
      v[field]=[true,'Да','да'].includes(v[field]);
    }
    if (v.procedures != null) {
      let list: any;
      try { list = JSON.parse(text(v.procedures)); } catch { throw Error('Процедуры: неверный формат JSON'); }
      if (!Array.isArray(list)) throw Error('Процедуры: укажите список');
      v.procedures = list.map((item: any) => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || !text(item.name)) throw Error('Не указана процедура');
        const p: Values = { name: text(item.name) };
        for (const key of ['cost','price','duration','discountPercent','discountMoney']) if (item[key] != null) p[key] = decimal(item[key], FIELDS[key]);
        if (p.discountPercent > 100 || p.discountPercent != null && p.discountMoney != null) throw Error('Не удалось определить явно указанную скидку процедуры');
        return p;
      });
      if (v.procedure) throw Error('Укажите либо одну процедуру, либо список процедур');
    }
    for(const field of ['spendLimitPercent','benefitValue','interestRate','supplierDiscount'])if(v[field]>100)throw Error(`${FIELDS[field]}: значение больше 100`);
    if (v.discountPercent > 100) throw Error('Скидка %: значение больше 100');
    if (v.discountPercent != null && v.discountMoney != null) throw Error('Указаны два вида скидки. Оставьте один явно заданный вид.');
    if (v.withoutProcedure != null) {
      if (![true, false, 'true', 'false', 'Да', 'Нет', 'да', 'нет', 1, 0].includes(v.withoutProcedure)) throw Error('Без процедуры: неверный тип значения');
      v.withoutProcedure = [true, 'true', 'Да', 'да', 1].includes(v.withoutProcedure);
    }
    return v;
  }

  private async save(tx: Tx, tenantId: string, accountId: string, fact: Fact, source: string, limits: any, sessionId: string) {
    const normalized = this.normalize(fact);
    const byId = text(normalized.transferId) ? await tx.dataTransferFact.findFirst({ where: { id: text(normalized.transferId), tenantId, domain: fact.domain } }) : null;
    if (normalized.transferId && !byId) throw Error('ID переноса не найден в этих данных CO-VA');
    const byKey = await tx.dataTransferFact.findUnique({ where: { tenantId_domain_sourceKey: { tenantId, domain: fact.domain, sourceKey: fact.sourceKey } } });
    if (byId && byKey && byId.id !== byKey.id) throw Error('ID переноса конфликтует с ключом строки');
    const previous = byId || byKey;
    const input = { ...normalized }; delete input.transferId; delete input.sourceKey;
    if (previous && canonical(previous.input) === canonical(input)) return { transferId: previous.id, targetId: previous.targetId, status: 'unchanged' };
    const id = previous?.id || randomUUID();
    const provenance = { type: 'import', label: 'Импорт', transferId: id, source, sessionId, revision: (previous?.revision || 0) + 1 };
    await tx.$queryRaw`SELECT set_config('co_va.transfer_provenance', ${JSON.stringify(provenance)}, true)`;
    const occurredAt = input.occurredAt || (fact.domain === 'records' || fact.domain === 'schedule' ? input.date ? `${input.date}T00:00:00Z` : '' : input.createdAt || '');
    await tx.$queryRaw`SELECT set_config('co_va.transfer_time', ${occurredAt || ''}, true)`;
    const journalled=['accounts','deposits'].includes(fact.domain) || fact.domain==='payments' && ['Депозит','Личный счёт'].includes(input.paymentSource);
    const oldOwnership=(previous?.ownership as Values)||{};
    const financialOwners=[this.finance,this.personalAccounts];
    const financialState=async()=>{const state:TransferState={};for(const owner of financialOwners)Object.assign(state,await owner.transferState(tx,tenantId));return state;};
    if(journalled && previous && oldOwnership.canonicalBefore && oldOwnership.canonicalAfter){
      const current=await financialState();
      assertNoIndependentReferences(oldOwnership.canonicalBefore,oldOwnership.canonicalAfter,current);
      for(const owner of financialOwners)await owner.restoreTransfer(tx,tenantId,oldOwnership.canonicalBefore,oldOwnership.canonicalAfter,true);
      await tx.$queryRaw`SELECT set_config('co_va.suppress_history','true',true)`;
      for(const owner of financialOwners)await owner.restoreTransfer(tx,tenantId,oldOwnership.canonicalBefore,oldOwnership.canonicalAfter);
      await tx.$queryRaw`SELECT set_config('co_va.suppress_history','false',true)`;
    }
    const canonicalBefore=journalled?await financialState():null;
    const v = await this.linkedValues(tx, tenantId, input, source);
    const target = previous?.targetId || '';
    let targetId = '';
    const ownership: Values = { ...((previous?.ownership as Values) || {}) };
    if (fact.domain === 'people') {
      if (!limits.realPersonalData) throw Error('Перенос людей доступен после перехода в рабочий режим');
      targetId = await this.people.importPerson(tenantId, v, target, tx, ownership);
    } else if (['wallets','programs','loans','investments'].includes(fact.domain)) {
      targetId=await this.auxiliary.importNamedFact(tenantId,fact.domain,v,target,tx);
    } else if(fact.domain==='articles') {
      targetId=await this.finance.importArticle(tenantId,v,target,tx);
    } else if (fact.domain === 'workplaces') {
      if (!target && limits.workplaces != null && await tx.workplace.count({ where: { tenantId, deletedAt: null } }) >= limits.workplaces) throw Error(`Доступно рабочих пространств: ${limits.workplaces}`);
      targetId = await this.profiles.importWorkplace(tenantId, accountId, v, target, tx);
    } else if (fact.domain === 'procedures') {
      if (v.workplace || v.workplaceKey) v.workplaceId = (await this.profiles.resolveTransferWorkplace(tenantId, v, tx)).key;
      targetId = await this.procedures.importProcedure(tenantId, v, target, tx);
    } else if (fact.domain === 'schedule') {
      if (!v.date) throw Error('Не указана дата графика');
      if (!v.from || !v.to || v.to <= v.from) throw Error('Укажите корректное рабочее время С — До');
      v.workplaceId = (await this.profiles.resolveTransferWorkplace(tenantId, v, tx)).key;
      targetId = await this.people.importSchedule(tenantId, { workplaceId: v.workplaceId, date: v.date, from: v.from, to: v.to }, target, tx);
    } else if (fact.domain === 'records') {
      if (!v.date) throw Error('Не указана дата обслуживания');
      const person = await this.people.resolveTransferPerson(tenantId, v, tx);
      const workplace = await this.profiles.resolveTransferWorkplace(tenantId, v, tx);
      if (v.to && (!v.from || v.to <= v.from)) throw Error('Окончание обслуживания должно быть позже начала');
      const snapshots = (v.procedures || (text(v.procedure) ? [{ ...v, name: text(v.procedure) }] : [])).map((p: Values) => ({
        ...(v.appendProcedures?{id:id+':procedure'}:{}), name: p.name, ...(p.duration != null ? { duration: p.duration } : {}), ...(p.cost != null ? { cost: p.cost } : {}),
        ...(p.price != null ? { historicalPrice: p.price } : {}),
        ...(p.discountPercent != null ? { historicalDiscount: { type: 'percent', value: p.discountPercent } } : {}),
        ...(p.discountMoney != null ? { historicalDiscount: { type: 'money', value: p.discountMoney } } : {}),
      }));
      if (!snapshots.length && (v.cost != null || v.price != null || v.discountPercent != null || v.discountMoney != null)) throw Error('Не указана процедура для цены или скидки');
      targetId = await this.records.importHistorical(tenantId, { date: v.date, from: v.from, to: v.to,
        workplaceId: workplace.key, person: { key: person.key, name: person.name, surname: person.surname || '', phone: person.phones?.[0] || '' },
        procedures: snapshots, appendProcedures:v.appendProcedures===true, ...(v.createdAt ? { createdAt: v.createdAt } : {}) }, target || text(v.recordId), tx);
    } else if(['deposits','accounts','operations'].includes(fact.domain)) {
      const person=fact.domain!=='operations'?await this.people.resolveTransferPerson(tenantId,v,tx):null;
      if(person){v.person=person;v.personKey=person.key;}
      if(fact.domain==='accounts' && (v.recordId || v.date))v.recordId=(await this.records.resolveTransferredRecord(tenantId,v,tx)).id;
      if(v.wallet){const wallet=await this.finance.resolveTransferredWallet(tenantId,v,tx);v.walletId=wallet.id;v.walletName=wallet.name;}
      targetId=fact.domain==='deposits'?await this.finance.importDeposit(tenantId,v,target,tx):fact.domain==='accounts'?await this.personalAccounts.importHistorical(tenantId,v,target,tx):await this.finance.importFinancialOperation(tenantId,v,target,tx);
    } else if (fact.domain === 'payments') {
      if (v.amount == null) throw Error('Сумма имеет неверный формат');
      if (!v.occurredAt) throw Error('Не указана дата оплаты');
      let person: Values | undefined;
      if (v.personKey || v.phone || v.uei) person = await this.people.resolveTransferPerson(tenantId, v, tx);
      let record: Values | undefined;
      if (v.recordId || v.date) record = await this.records.resolveTransferredRecord(tenantId, { ...v, personKey: person?.key }, tx);
      if(v.paymentSource && !['Кошелёк','Депозит','Личный счёт'].includes(v.paymentSource))throw Error('Уточните источник оплаты');
      const wallet = !v.paymentSource || v.paymentSource==='Кошелёк' ? await this.finance.resolveTransferredWallet(tenantId, v, tx) : {id:'',name:''};
      if(v.paymentSource==='Личный счёт') targetId=await this.personalAccounts.importHistorical(tenantId,{...v,personKey:person?.key || record?.person?.key,recordId:record?.id,accountAction:'Оплата',accountAmount:v.amount},target,tx);
      else targetId = await this.finance.importPayment(tenantId, { ...v, recordId: record?.id, person: person || record?.person || {}, workplaceId: record?.workplaceId || '', walletId: wallet.id, walletName: wallet.name }, target, tx);
    } else if(fact.domain==='offers') {
      targetId=await this.inventory.importOffer(tenantId,v,target,tx);
    } else if (fact.domain === 'items') {
      targetId = await this.inventory.importItem(tenantId, v, target, tx);
    } else {
      if (fact.domain === 'consumables') {
        const person = v.personKey || v.phone || v.uei ? await this.people.resolveTransferPerson(tenantId, v, tx) : null;
        if (v.workplace || v.workplaceKey) v.workplaceId = (await this.profiles.resolveTransferWorkplace(tenantId, v, tx)).key;
        const record = await this.records.resolveTransferredRecord(tenantId, { ...v, personKey: person?.key }, tx);
        const procedure = this.procedures.matchTransferredProcedure(record, v.procedure, v.withoutProcedure === true);
        Object.assign(v, { recordId: record.id, personKey: record.person?.key || '', procedureKey: procedure?.id || '', workplaceKey: record.workplaceId, kind: 'CONSUMPTION' });
        // A service date can date the consumption; its technical midnight never matches appointment time.
        v.occurredAt = v.occurredAt || (v.date ? `${v.date}T00:00:00Z` : '');
        await tx.$queryRaw`SELECT set_config('co_va.transfer_time', ${v.occurredAt || ''}, true)`;
      } else v.kind = kindValues[v.kind] || text(v.kind);
      if(v.direction)v.direction=({'Приход':'IN','Расход':'OUT'} as Values)[v.direction] || v.direction;
      if(['ADJUSTMENT','CORRECTION'].includes(v.kind)&&!['IN','OUT'].includes(v.direction))throw Error('Укажите направление корректировки: Приход или Расход');
      if (!v.kind) throw Error('Не указан тип складского движения');
      targetId = await this.inventory.importMovement(tenantId, v, target, tx);
    }
    if(journalled){ownership.canonicalBefore=canonicalBefore;ownership.canonicalAfter=await financialState();}
    await tx.dataTransferFact.upsert({ where: { id }, create: { id, tenantId, domain: fact.domain, sourceKey: fact.sourceKey, targetId, source, input: input as Prisma.InputJsonValue, ownership: ownership as Prisma.InputJsonValue },
      update: { targetId, source, input: input as Prisma.InputJsonValue, ownership: ownership as Prisma.InputJsonValue, revision: { increment: 1 } } });
    return { transferId: id, targetId, status: previous ? 'corrected' : 'saved' };
  }

  async run(tenantId: string, accountId: string, input: SourceInput, preview: boolean) {
    let facts: Fact[];
    try { const parsed = await readSource(input); facts = sourceFacts(parsed.sheets, parsed.fingerprint, input); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'Не удалось прочитать файл'); }
    const access = await this.access.resolveTenantAccess(tenantId);
    const workplaceLimit = await this.access.resolveCapability(tenantId, 'workplaces.max');
    const limits = { realPersonalData: access.status === 'ACTIVE' && access.commercialMode === 'LIVE', workplaces: workplaceLimit.limit };
    if (access.status !== 'ACTIVE') throw new BadRequestException('Рабочее пространство временно недоступно');
    const conflicts = new Map<string, string>();
    const seen = new Map<string, string>();
    for (const fact of facts) {
      const key = `${fact.domain}:${fact.sourceKey}`; const value = canonical(fact.values);
      if (seen.has(key) && seen.get(key) !== value) conflicts.set(key, 'Один ID источника указан для разных фактов в файле. Проверьте данные.');
      seen.set(key, value);
    }
    const sessionId=randomUUID();
    const result: any = { preview, transferred: 0, unchanged: 0, failed: 0, domains: {}, rows: [] };
    const source = text(input.source) || text(input.filename);
    const add = (fact: Fact, saved: any = null, reason = '') => {
      const stats = result.domains[fact.domain] ||= { label: LABELS[fact.domain] || fact.sheet, transferred: 0, unchanged: 0, failed: 0 };
      if (reason) { result.failed++; stats.failed++; }
      else if (saved.status === 'unchanged') { result.unchanged++; stats.unchanged++; }
      else { result.transferred++; stats.transferred++; }
      result.rows.push({ ...fact, ...saved, transferId: preview ? '' : saved?.transferId || '', reason });
    };
    const perform = async (tx: Tx, fact: Fact) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
      const conflict = conflicts.get(`${fact.domain}:${fact.sourceKey}`); if (conflict) throw Error(conflict);
      return this.save(tx, tenantId, accountId, fact, source, limits, sessionId);
    };
    const reason = (error: any) => {
      if (typeof error?.code === 'string' && /^P\d+$/.test(error.code)) return error.code === 'P2002' ? 'Конфликт уникального ID. Проверьте данные.' : 'Не удалось сохранить факт. Повторите перенос; если ошибка повторится, сообщите номер строки.';
      return error instanceof Error ? error.message : 'Не удалось определить данные этой строки';
    };

    for(let attempt=0;attempt<3;attempt++) {
      try {
        return await this.prisma.$transaction(async tx=>{
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
          const before=preview?{}:await this.capture(tx,tenantId);
          for(const fact of facts){
            await tx.$executeRawUnsafe('SAVEPOINT transfer_fact');
            try{add(fact,await perform(tx,fact));await tx.$executeRawUnsafe('RELEASE SAVEPOINT transfer_fact');}
            catch(error){await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT transfer_fact');await tx.$executeRawUnsafe('RELEASE SAVEPOINT transfer_fact');add(fact,null,reason(error));}
          }
          await this.finance.finishHistoricalDeposits(tx,tenantId,result.rows.filter((row:any)=>row.domain==='deposits'&&!row.reason).map((row:any)=>row.targetId));
          if(preview)throw new PreviewRollback(result);
          const after=await this.capture(tx,tenantId);
          await tx.dataTransferSession.create({data:{id:sessionId,tenantId,accountId,source,filename:text(input.filename),transferred:result.transferred,failed:result.failed,facts:JSON.parse(JSON.stringify(result.rows)),before:before as Prisma.InputJsonValue,after:after as Prisma.InputJsonValue}});
          return {...result,sessionId};
        },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:300000,maxWait:10000});
      }catch(error:any){
        if(error instanceof PreviewRollback)return error.result;
        if(error?.code!=='P2034'||attempt===2)throw error;
        Object.assign(result,{transferred:0,unchanged:0,failed:0,domains:{},rows:[]});
      }
    }
  }

  private owners(){return [this.finance,this.inventory,this.personalAccounts,this.records,this.auxiliary,this.people,this.profiles];}
  private async capture(tx:Tx,tenantId:string):Promise<TransferState>{
    const state:TransferState={};for(const owner of this.owners())Object.assign(state,await owner.transferState(tx,tenantId));
    Object.assign(state,await captureOwnedState(tx,tenantId,['DataTransferFact']),await this.history.transferReferences(tx,tenantId));return state;
  }
  async sessions(tenantId:string){
    return this.prisma.dataTransferSession.findMany({where:{tenantId},select:{id:true,source:true,filename:true,status:true,transferred:true,failed:true,createdAt:true,cancelledAt:true},orderBy:{createdAt:'desc'},take:100});
  }
  async cancel(tenantId:string,sessionId:string){
    return this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))::text`;
      const session=await tx.dataTransferSession.findFirst({where:{tenantId,id:sessionId}});
      if(!session)throw new BadRequestException('Перенос не найден');
      if(session.status==='cancelled')throw new BadRequestException('Перенос уже отменён');
      const before=session.before as TransferState;const after=session.after as TransferState;
      const current=await this.capture(tx,tenantId);
      assertNoIndependentReferences(before,after,current);
      for(const owner of this.owners())await owner.restoreTransfer(tx,tenantId,before,after,true);
      await restoreOwnedState(tx,tenantId,['DataTransferFact'],before,after,true);
      await tx.$queryRaw`SELECT set_config('co_va.suppress_history','true',true)`;
      for(const owner of this.owners())await owner.restoreTransfer(tx,tenantId,before,after);
      await restoreOwnedState(tx,tenantId,['DataTransferFact'],before,after);
      await this.history.cancelTransfer(tx,tenantId,sessionId);
      await tx.dataTransferSession.update({where:{id:sessionId},data:{status:'cancelled',cancelledAt:new Date()}});
      return {cancelled:true,sessionId};
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:300000});
  }
}
