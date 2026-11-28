// Canonical financial display taxonomy. Ledger economic types and old article IDs
// are retained as accounting/routing facts; neither is a second display article.
// Direction belongs to the movement, not the article.
type RawArticle = {articleId:string;parentArticleId:string;name:string;direction:string;economicType:string;systemKey:string;archivedAt?:Date|string|null};
type Value = {valueId:string;name:string;routes:string[];custom?:boolean;archived?:boolean};
type Article = {articleId:string;name:string;systemKey:string;capability:string;values:Value[];routes:string[];archived?:boolean;direction?:string;economicType?:string;deferred?:boolean};
const value=(id:string,name:string,routes:string[]):Value=>({valueId:id,name,routes});
const mechanism=(id:string,name:string,capability:string,values:Value[],routes:string[]=[]):Article=>({articleId:'mechanism-'+id,name,systemKey:'MECHANISM_'+id.toUpperCase().replace(/-/g,'_'),capability,values,routes});
export const APPROVED_FINANCE_ARTICLES:Article[]=[
 mechanism('services','Оказание услуг','journal',[
  value('services-payment','Оплата услуг',['SERVICE_REVENUE']),
  value('services-prepayment','Предоплата',['SERVICE_PREPAYMENT']),
  value('services-tips','Чаевые',['TIPS']),
  value('services-refund','Возврат',['SERVICE_REFUND','TIPS_REFUND','REFUND'])
 ]),
 mechanism('products','Продажа товаров','journal',[
  value('products-payment','Оплата товаров',['PRODUCT_REVENUE']),
  value('products-tips','Чаевые',['PRODUCT_TIPS']),
  value('products-refund','Возврат',['PRODUCT_REFUND'])
 ]),
 mechanism('purchase','Закупка','inventory',[
  value('purchase-payment','Оплата',['MATERIALS']),
  value('purchase-refund','Возврат',['MATERIALS_REFUND'])
 ]),
 mechanism('deposit','Депозит','loyalty.deposit.access',[
  value('deposit-funding','Пополнение',['DEPOSIT_RECEIVED']),
  value('deposit-payment','Оплата',['DEPOSIT_SPEND','DEPOSIT_BENEFIT_GRANTED']),
  value('deposit-refund','Возврат',['DEPOSIT_RETURN','DEPOSIT_PAYMENT_REFUND','DEPOSIT_BENEFIT_REVERSED'])
 ]),
 mechanism('personal-account','Личный счёт','loyalty.personal_account.access',[
  value('personal-funding','Пополнение',['PERSONAL_ACCOUNT_LIABILITY_IN']),
  value('personal-payment','Оплата',['PERSONAL_ACCOUNT_SPEND','PERSONAL_ACCOUNT_DEBT_SETTLEMENT']),
  value('personal-refund','Возврат',['PERSONAL_ACCOUNT_LIABILITY_OUT','PERSONAL_ACCOUNT_PAYMENT_REFUND'])
 ]),
 mechanism('transfer','Перевод между кошельками','finance.special.access',[],['TRANSFER'])
];
export const RETIRED_SYSTEM_ARTICLE_KEYS=new Set(['OTHER_INCOME','OTHER_EXPENSE','RENT','TAX']);
const routeSet=new Set(APPROVED_FINANCE_ARTICLES.flatMap(a=>[...a.routes,...a.values.flatMap(v=>v.routes)]));
const roots=new Set(['INCOME_ROOT','EXPENSE_ROOT']);
// Existing loan/investment mechanisms are deliberately not redesigned until
// their separate acceptance. Existing custom IDs and historical names survive.
export function financeArticleCatalog(raw:RawArticle[]):Article[]{
 const result=APPROVED_FINANCE_ARTICLES.map(a=>({...a,values:a.values.map(v=>({...v,routes:[...v.routes]})),routes:[...a.routes]}));
 const byId=new Map(raw.map(a=>[a.articleId,a]));
 for(const a of raw){
  if(roots.has(a.systemKey)||routeSet.has(a.systemKey)||a.economicType==='GROUP')continue;
  const parent=byId.get(a.parentArticleId);
  if(!a.systemKey&&parent&&!roots.has(parent.systemKey)&&parent.economicType!=='GROUP')continue;
  const retired=RETIRED_SYSTEM_ARTICLE_KEYS.has(a.systemKey);
  result.push({articleId:a.articleId,name:a.name,systemKey:retired?'':a.systemKey,capability:'',archived:Boolean(a.archivedAt)||retired,deferred:Boolean(a.systemKey)&&!retired,values:raw.filter(v=>v.parentArticleId===a.articleId&&!v.systemKey).map(v=>({valueId:v.articleId,name:v.name,routes:[],custom:true,archived:Boolean(v.archivedAt)})),routes:a.systemKey?[a.systemKey]:[],direction:a.direction,economicType:a.economicType});
 }
 // Retain already-created user values of historical system articles, without
 // introducing new defaults or changing a ledger reference.
 for(const a of raw){
  if(a.systemKey||!a.parentArticleId)continue;
  const parent=byId.get(a.parentArticleId);
  if(!parent||!routeSet.has(parent.systemKey))continue;
  const owner=result.find(g=>g.routes.includes(parent.systemKey)||g.values.some(v=>v.routes.includes(parent.systemKey)));
  if(owner&&!owner.values.some(v=>v.valueId===a.articleId))owner.values.push({valueId:a.articleId,name:a.name,routes:[],custom:true,archived:Boolean(a.archivedAt)});
 }
 return result;
}
export function financeArticleRoute(catalog:Article[],route:string){
 if(!route)return null;
 for(const a of catalog){const v=a.values.find(v=>v.routes.includes(route));if(v)return {articleId:a.articleId,articleName:a.name,valueId:v.valueId,valueName:v.name};if(a.routes.includes(route))return {articleId:a.articleId,articleName:a.name,valueId:'',valueName:''};}
 return null;
}
export function classifyFinanceLedger(entry:{articleId?:string;economicType?:string;component?:string;direction?:string},operation:{kind?:string;data?:any}|null,raw:RawArticle[],catalog:Article[]){
 const saved=raw.find(a=>a.articleId===entry.articleId);
 const economic=String(entry.economicType||'');
 let route=saved?.systemKey||economic;
 if(saved&&!saved.systemKey){
  const owner=catalog.find(a=>a.values.some(v=>v.valueId===saved.articleId));
  if(owner)return {articleId:owner.articleId,articleName:owner.name,valueId:saved.articleId,valueName:saved.name};
  const known=catalog.find(a=>a.articleId===saved.articleId);
  return known?{articleId:known.articleId,articleName:known.name,valueId:'',valueName:''}:null;
 }
 if(entry.articleId&&!saved)return null;
 if(route==='MATERIALS'&&(entry.component==='materials-refund'||operation?.kind==='inventory-supplier-refund'))route='MATERIALS_REFUND';
 if(['SERVICE_REVENUE','PRODUCT_REVENUE','TIPS','SERVICE_REFUND','TIPS_REFUND','REFUND'].includes(route)||['SERVICE_REFUND','TIPS_REFUND'].includes(economic)){
  const items=Array.isArray(operation?.data?.settlement?.items)?operation.data.settlement.items:[];
  const types=new Set(items.map((i:any)=>String(i.sourceType||'procedure')));
  // Mixed invoices have no saved per-category distribution of each partial
  // payment/tip/refund. Do not assign their money to an invented article.
  if(types.has('product')&&types.has('procedure'))return null;
  const product=route==='PRODUCT_REVENUE'||types.size===1&&types.has('product');
  const refund=operation?.kind==='refund'||['SERVICE_REFUND','TIPS_REFUND','REFUND'].includes(economic)||route==='REFUND';
  route=refund?(product?'PRODUCT_REFUND':'SERVICE_REFUND'):(economic==='TIPS'||route==='TIPS'||entry.component==='tips')?(product?'PRODUCT_TIPS':'TIPS'):product?'PRODUCT_REVENUE':'SERVICE_REVENUE';
 }
 return financeArticleRoute(catalog,route);
}

export function registeredFinanceArticle(catalog:Article[],articleId:string,valueId=''){
 const a=catalog.find(a=>a.articleId===articleId);
 const v=valueId?a?.values.find(v=>v.valueId===valueId):null;
 if(!a||(valueId&&!v))return null;
 return {articleId:a.articleId,articleName:a.name,valueId:v?.valueId||'',valueName:v?.name||''};
}
// Raw route owner is an internal accounting fact. It never implicitly fills
// an explicitly empty canonical value, and prepayment is journal-owned.
export function resolveManualArticle(raw:RawArticle[],catalog:Article[],articleId:string,valueId:string,direction:string){
 const a=catalog.find(a=>a.articleId===articleId&&!a.archived);
 if(!a)return null;
 const v=valueId?a.values.find(v=>v.valueId===valueId&&!v.archived):null;
 if(valueId&&!v)return null;
 if(v?.routes.includes('SERVICE_PREPAYMENT'))return null;
 const eligible=raw.filter(r=>!r.archivedAt&&r.direction===direction&&r.economicType!=='GROUP'&&!RETIRED_SYSTEM_ARTICLE_KEYS.has(r.systemKey)&&!['DEPOSIT_RECEIVED','DEPOSIT_RETURN','PERSONAL_ACCOUNT_LIABILITY_IN','PERSONAL_ACCOUNT_LIABILITY_OUT','SERVICE_PREPAYMENT'].includes(r.economicType)&&r.systemKey!=='SERVICE_PREPAYMENT');
 const direct=eligible.find(r=>r.articleId===(v?.valueId||a.articleId));
 const routes=v?v.routes:[...a.routes,...a.values.filter(v=>!v.archived&&!v.custom).flatMap(v=>v.routes)];
 const owner=direct||routes.flatMap(route=>eligible.filter(r=>r.systemKey===route))[0];
 const identity=registeredFinanceArticle(catalog,articleId,valueId);
 return owner&&identity?{rawId:owner.articleId,identity}:null;
}
