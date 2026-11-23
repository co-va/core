import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash, randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../server/src/loyalty/deposit-excel-plan.ts', import.meta.url), 'utf8')
  .replace(/^import .+;\s*$/gm, '').replaceAll('export ', '');
const history = readFileSync(new URL('../server/src/loyalty/deposit-history.ts', import.meta.url), 'utf8')
  .replaceAll('export ', '');
const { depositHistoricalLedger } = runInNewContext(
  stripTypeScriptTypes(history, { mode: 'strip' }) + '\n({ depositHistoricalLedger })',
  { Error, Date });
const sourceFormat = readFileSync(new URL('../server/src/loyalty/deposit-excel-format.ts', import.meta.url), 'utf8');
const dayPart = sourceFormat.slice(sourceFormat.indexOf('function plain('), sourceFormat.indexOf('function widths('))
  .replaceAll('export ', '');
const { excelDay } = runInNewContext(
  stripTypeScriptTypes(dayPart, { mode: 'strip' }) + '\n({ excelDay })',
  { Error, Date, BadRequestException: class extends Error {} });
const { planDepositExcel } = runInNewContext(
  stripTypeScriptTypes(source, { mode: 'strip' }) + '\n({ planDepositExcel })',
  {
    Error, Date, Math, Map, Set, Number, JSON, Object,
    createHash, randomUUID, excelDay, depositHistoricalLedger,
    depositTermActiveAt: (terms, at) => {
      const t = terms || {};
      if (t.termMode !== 'dated') return true;
      const date = at.toISOString().slice(0, 10);
      return date >= t.termStartDate && date <= t.termEndDate;
    },
    normalizePhone: p => String(p || '').replace(/\D/g, ''),
  });

const row = (row, date, action, amount, more = {}) => ({
  row, programName:'Ромашка',amountMode:'',nominal:'',termMode:'',
  termStartDate:'',termEndDate:'',benefitType:'',benefitPercent:'',
  description:'',programUei:'',personName:'Маша Иванова',phone:'+79990001122',
  personCode:'',cardKey:'',occurredAt:date,action,amount:String(amount),
  wallet:'',note:'',externalOperationId:'deposit-old-'+row,...more,
});
const template = [
  row(3, '2024-02-15','Пополнение',15000,{
    amountMode:'Фиксированная',nominal:'30000',termMode:'Период',
    termStartDate:'2024-01-01',termEndDate:'2024-12-31',
    benefitType:'Нет',
  }),
  row(4,'2024-02-20','Пополнение',15000),
  row(5,'2024-02-25','Списание',5000,{note:'Услуги'}),
];
const emptyDb = (state = {}) => ({
  loyaltyDepositProgram:{findMany:async()=>state.programs||[]},
  person:{findMany:async()=>state.people||[]},
  loyaltyDepositInstance:{findMany:async()=>state.deposits||[]},
  financeOperation:{findMany:async()=>state.ops||[]},
  businessAuxiliaryState:{findUnique:async()=>({data:{wallets:[]}})},
  ueiState:{findUnique:async()=>({data:state.uei||{entities:{},relations:{},revoked:[]}})},
});
const plan = await planDepositExcel(emptyDb(), 'tenant-test', template, 'batch-test', '', '');
assert.equal(plan.errors.length,0,JSON.stringify(plan.errors));
assert.equal(plan.programs.length,1,'Program inferred from first funding row, no creation row');
assert.equal(plan.people.length,1,'One contact created once');
assert.equal(plan.events.length,3,'Two funding rows and one spending row');
assert.equal(plan.events[0].kind,'deposit-funding');
assert.equal(plan.events[0].walletId,'','Unknown wallet must NOT be replaced by cash');
assert.equal(plan.events[2].kind,'deposit-import-spend');
assert.equal(plan.events[2].principalAmount,5000);
assert.equal(plan.events[2].benefitAmount,0);
assert.equal(plan.events[0].depositId,plan.events[2].depositId,'All rows use one card');

const depId=plan.events[0].depositId;
const ops=plan.events.map(e=>({
  operationId:e.operationId,kind:e.kind,status:'completed',origin:'excel_import',
  sourceType:'deposit',sourceId:e.depositId,occurredAt:e.occurredAt,createdAt:new Date(),
  data:{amount:e.amount,depositAllocations:e.kind==='deposit-import-spend'
    ?[{depositId:e.depositId,amount:e.amount,principalAmount:e.principalAmount,benefitAmount:e.benefitAmount}]:[]},
}));
assert.equal(depositHistoricalLedger(ops,depId,plan.events[0].terms,new Date('2026-11-23T12:00:00Z')).remaining,25000,
  'Historical balance after 30k funding and 5k spent');
const persisted=emptyDb({
  programs:plan.programs.map(p=>({data:p})),people:plan.people.map(p=>({data:p})),
  deposits:[{depositId:depId,programId:plan.programs[0].id,
    personKey:plan.people[0].key,terms:plan.events[0].terms,initialAmount:30000,status:'expired'}],
  ops,uei:plan.identity,
});
const repeat=await planDepositExcel(persisted,'tenant-test',template,'batch-test','','');
assert.equal(repeat.errors.length,0,JSON.stringify(repeat.errors));
assert.equal(repeat.events.length,0,'Repeated Excel does not create duplicate payments');
assert.equal(repeat.skipped,3);
const excessive=await planDepositExcel(emptyDb(),'tenant-test',[
  template[0],row(4,'2024-02-20','Пополнение',17000),
],'batch-excess','','');
assert.ok(excessive.errors.some(e=>/номинал/i.test(e.message)),'Excess funding rejected');
const unfunded=await planDepositExcel(emptyDb(),'tenant-test',[
  template[0],row(4,'2024-02-10','Списание',5000),
],'batch-unfunded','','');
assert.ok(unfunded.errors.length>0,'Spend before funding rejected');
const period=await planDepositExcel(emptyDb(),'tenant-test',template,'batch-period','2024-02-15','2024-02-20');
assert.equal(period.events.length,2,'Date-scoped test import excludes later spending');
const collision=await planDepositExcel(emptyDb(),'tenant-test',[
  template[0],{...template[1],externalOperationId:template[0].externalOperationId},
],'batch-duplicate','','');
assert.ok(collision.errors.some(e=>/повторяется ID/i.test(e.message)),
  'Duplicate external operation ID in a file rejected');
const distinctNames=await planDepositExcel(emptyDb(),'tenant-test',[
  template[0],row(4,'2024-02-20','Пополнение',10000,{phone:'+79998887766'}),
],'batch-distinct','','');
assert.equal(distinctNames.errors.length,0,JSON.stringify(distinctNames.errors));
assert.equal(distinctNames.people.length,2,'Same name with different phone must never be merged');
assert.notEqual(distinctNames.events[0].personKey,distinctNames.events[1].personKey);
console.log('Deposit Excel import plan: seven domain regressions PASS');
