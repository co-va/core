import { Fact, text } from './formats';
import { STANDARD_META } from './standard';
export function standardFacts(sheet: string, row: number, values: Record<string, any>, sourceKey: string, metadata?: any): Fact[] {
  const v = values;
  const pick = (...keys: string[]) => Object.fromEntries(keys.filter(k=>v[k] !== undefined).map(k=>[k,v[k]]));
  const identity = pick('personKey','personTransferId','name','surname','phone','uei');
  const reference = { ...identity,...pick('recordId','recordTransferId','workplace','workplaceKey','date','from','procedure') };
  const facts: Fact[] = [];
  const add = (domain: string, data: any) => facts.push({domain,sheet,row,sourceKey:sourceKey+':'+domain,values:data});
  if (metadata?.domain) {
    const data = {...(metadata.internal || {}), ...v, transferId:metadata.transferId || undefined};
    if (metadata.domain==='items') data.name=v.material;
    if (metadata.domain==='workplaces') data.name=v.workplace;
    if (metadata.domain==='procedures') data.name=v.catalogProcedure;
    if (metadata.domain==='programs') data.name=v.program;
    if (metadata.domain==='wallets') data.name=v.wallet;
    if (metadata.domain==='loans') data.name=v.loan;
    if (metadata.domain==='investments') data.name=v.investment;
    if (metadata.domain==='records') data.appendProcedures=true;
    if (metadata.domain==='schedule') Object.assign(data,{date:v.scheduleDate,from:v.scheduleFrom,to:v.scheduleTo});
    return [{domain:metadata.domain,sheet,row,sourceKey:metadata.sourceKey,values:data}];
  }
  if (v.name || v.additionalPhone || v.email || v.birthday || v.gender || v.phone && v.uei) add('people',{...identity,...pick('additionalPhone','email','birthday','gender')});
  if (v.workplace) add('workplaces',{name:v.workplace,...pick('city','address','currency','timeZone','about')});
  if (v.wallet) add('wallets',{name:v.wallet});
  if (v.program) add('programs',{name:v.program,...pick('programAmount','benefitType','benefitValue','termStartDate','termEndDate','programStatus')});
  if (v.loan) add('loans',{name:v.loan,...pick('lenderName','interestRate','ratePeriod','repaymentMode','endDate')});
  if (v.investment) add('investments',{name:v.investment,...pick('investmentRole','endDate')});
  if (v.article && v.articleDirection) add('articles',pick('article','articleDirection','articleEconomicType'));
  if (v.catalogProcedure) add('procedures',{name:v.catalogProcedure,...pick('workplace','price','duration','occurredAt')});
  if (v.scheduleDate) add('schedule',{workplace:v.workplace,date:v.scheduleDate,from:v.scheduleFrom,to:v.scheduleTo});
  const hasRecord = v.date !== undefined && v.procedure && (!v.material || v.cost !== undefined) && v.amount === undefined && !v.accountAction && !v.depositAction
    || v.date !== undefined && v.procedure && v.cost !== undefined;
  if (hasRecord) add('records',{...reference,...pick('to','cost','discount','duration','createdAt'),appendProcedures:true});
  // Explicit source references use the very same sourceKey namespace, never mutable person fields.
  const linked = hasRecord ? {recordTransferId:sourceKey+':records'} : {};
  if (v.depositAction || v.depositAmount !== undefined) add('deposits',{...identity,...pick('deposit','program','depositAction','depositAmount','occurredAt','wallet','note')});
  if (v.accountAction || v.accountAmount !== undefined || v.spendLimitPercent !== undefined || v.visibleToEndUser !== undefined) add('accounts',{...reference,...linked,...pick('accountAction','accountAmount','occurredAt','wallet','note','spendLimitPercent','visibleToEndUser')});
  if (v.amount !== undefined) add('payments',{...reference,...linked,...pick('amount','occurredAt','wallet','paymentSource','deposit','note')});
  if (v.financeKind || v.financeAmount !== undefined) add('operations',pick('financeKind','financeAmount','occurredAt','wallet','toWallet','article','loan','investment','note'));
  if (v.material && v.unit) add('items',{name:v.material,...pick('manufacturer','unit','productType','category','sku','barcode','location','supplier','minStock','targetStock','packageQuantity','grossWeight','tareWeight','lastPurchasePrice','trackLots','canConsume','canSell')});
  if (v.material && v.supplier && (v.listPrice !== undefined || v.actualPrice !== undefined || v.supplierSku)) add('offers',pick('material','manufacturer','unit','supplier','listPrice','supplierDiscount','supplierSku','actualPrice','note'));
  if (v.quantity !== undefined) {
    const data = {...reference,...linked,...pick('material','manufacturer','unit','quantity','unitCost','kind','direction','expectedQuantity','actualQuantity','occurredAt','expiresAt','supplier','listPrice','withoutProcedure','note')};
    if (v.date && !v.kind) add('consumables',data); else add('movements',data);
  }
  if (!facts.length) add('people',{...v,name:undefined});
  return facts;
}
