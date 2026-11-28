// Canonical position/payment/source links. Physical ledger stays unchanged.
type Row = Record<string,any>;
const str=(v:any)=>String(v??'');
const arr=(v:any):Row[]=>Array.isArray(v)?v:[];
const obj=(v:any):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const cents=(v:any)=>Math.round(Number(v||0)*100);
const key=(...v:any[])=>JSON.stringify(v);
const time=(v:any)=>new Date(v||0).getTime()||0;

// Reserve tips in the stable system cash wallet first, without changing
// any wallet total. Historical ledger components are never rewritten.
export function splitCashByComponent(allocations:Row[],serviceAmount:number,tips:number){
 const rows=allocations.map(a=>({a,left:cents(a.amount),tip:0}));
 let rest=cents(tips);
 const order=[...rows.filter(r=>r.a.walletId==='cash'),...rows.filter(r=>r.a.walletId!=='cash').reverse()];
 for(const row of order){row.tip=Math.min(row.left,rest);row.left-=row.tip;rest-=row.tip;}
 if(rest!==0||rows.reduce((n,r)=>n+r.left,0)!==cents(serviceAmount))return null;
 return rows.flatMap(r=>[
  ...(r.left>0?[{walletId:r.a.walletId,walletName:r.a.walletName,amount:r.left/100,component:'service'}]:[]),
  ...(r.tip>0?[{walletId:r.a.walletId,walletName:r.a.walletName,amount:r.tip/100,component:'tips'}]:[]),
 ]);
}
function positions(data:Row){
 const rows=arr(obj(data.settlement).items),seen=new Map<string,number>(),result:Row[]=[];
 if(!rows.length)return null;
 for(const item of rows){
  const type=str(item.sourceType||'procedure'),id=str(item.sourceId||item.id),name=str(item.name);
  if(!['procedure','product'].includes(type)||!name||item.planAmount==null||!Number.isFinite(Number(item.planAmount))||Number(item.planAmount)<0)return null;
  const base=key(type,id||name),n=seen.get(base)||0;seen.set(base,n+1);
  result.push({positionKey:key(type,id||name,n),positionId:id,positionName:name,positionType:type,capacity:cents(item.planAmount)});
 }
 return result;
}
function sources(op:Row,entries:Row[]){
 const d=obj(op.data),refund=op.kind==='refund',sources:Row[]=[];
 // Existing refund source priority: deposit, personal account, wallet.
 for(const a of arr(d.depositAllocations)){
  const id=str(a.depositId||a.sourceId||a.id),amount=cents(a.amount);
  if(amount>0){if(!id)return null;sources.push({sourceKind:'deposit',sourceId:id,sourceName:str(a.name||a.label),entryId:'',component:'position',amount});}
 }
 const personal=cents(refund?d.personalAccountRestored:d.personalAccountAmount);
 if(personal>0)sources.push({sourceKind:'personal',sourceId:'personal-account',sourceName:'Личный счёт',entryId:'',component:'position',amount:personal});
 const walletOrder=new Map<string,number>();
 arr(d.allocations).forEach((a,i)=>{const id=str(a.walletId);if(!walletOrder.has(id))walletOrder.set(id,i);});
 const ordered=[...entries].sort((a,b)=>(walletOrder.get(str(a.walletId))??Number.MAX_SAFE_INTEGER)-(walletOrder.get(str(b.walletId))??Number.MAX_SAFE_INTEGER));
 for(const e of ordered){
  if(e.direction!==(refund?'OUT':'IN'))continue;
  const component=str(obj(e.data).component),economic=str(e.economicType);
  const tip=component==='tips'||economic==='TIPS'||economic==='TIPS_REFUND';
  const position=component==='service'||['SERVICE_REVENUE','PRODUCT_REVENUE','SERVICE_REFUND','PRODUCT_REFUND'].includes(economic);
  if(!tip&&!position)continue;
  const amount=cents(e.amount);
  if(amount>0){
   if(!e.entryId||!e.walletId)return null;
   sources.push({sourceKind:'wallet',sourceId:str(e.walletId),sourceName:str(obj(e.data).walletName),entryId:str(e.entryId),component:tip?'tips':'position',amount});
  }
 }
 if(sources.reduce((n,s)=>n+(s.component==='position'?s.amount:0),0)!==cents(d.serviceAmount)||sources.reduce((n,s)=>n+(s.component==='tips'?s.amount:0),0)!==cents(d.tips))return null;
 return sources;
}
function sourceKey(s:Row){return key(s.sourceKind,s.sourceId,s.entryId,s.component);}
function route(part:Row,refund:boolean,timing:unknown=''){
 if(part.sourceKind==='deposit')return refund?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND';
 if(part.sourceKind==='personal')return refund?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND';
 const product=part.positionType==='product';
 if(refund)return product?'PRODUCT_REFUND':'SERVICE_REFUND';
 if(part.component==='tips')return product?'PRODUCT_TIPS':'TIPS';
 if(timing==='prepayment'&&!product)return 'SERVICE_PREPAYMENT';
 return product?'PRODUCT_REVENUE':'SERVICE_REVENUE';
}
function sameSource(refund:Row,original:Row){
 return refund.component===original.component&&refund.sourceKind===original.sourceKind&&(refund.sourceKind==='wallet'||refund.sourceId===original.sourceId);
}
function storedValid(parts:Row[],src:Row[],op:Row){
 const expected=new Map<string,number>(),actual=new Map<string,number>(),ids=new Set<string>();
 for(const s of src)expected.set(sourceKey(s),(expected.get(sourceKey(s))||0)+s.amount);
 for(const p of parts){
  if(!p.id||ids.has(p.id)||!['procedure','product'].includes(p.positionType)||!Number.isFinite(Number(p.amount))||cents(p.amount)<=0||(!p.positionKey&&p.component!=='tips')||p.route!==route(p,op.kind==='refund',obj(op.data).paymentTiming))return false;
  ids.add(p.id);const k=sourceKey(p);actual.set(k,(actual.get(k)||0)+cents(p.amount));
 }
 return expected.size===actual.size&&[...expected].every(([k,n])=>actual.get(k)===n);
}
export function projectPositionMovements(operations:Row[],ledger:Row[],lastId=''){
 const byOperation=new Map<string,Row[]>();
 for(const e of ledger){const id=str(e.financeOperationId);if(!byOperation.has(id))byOperation.set(id,[]);byOperation.get(id)!.push(e);}
 const result=new Map<string,Row[]|null>(),paid=new Map<string,Map<string,number>>(),refunded=new Map<string,number>(),unresolved=new Set<string>();
 const ordered=operations.filter(o=>['payment','refund'].includes(o.kind)).sort((a,b)=>{
  if(lastId&&a.id===lastId)return 1;if(lastId&&b.id===lastId)return -1;
  return time(a.createdAt)-time(b.createdAt)||time(a.occurredAt)-time(b.occurredAt)||str(a.id).localeCompare(str(b.id));
 });
 for(const op of ordered){
  const id=str(op.operationId),source=key(op.sourceType,op.sourceId),active=op.status==='completed',refund=op.kind==='refund';
  const d=obj(op.data),src=sources(op,byOperation.get(str(op.id))||[]),balance=paid.get(source)||new Map<string,number>();
  let parts:Row[]|null=null;
  if(src){
   const saved=Array.isArray(d.positionMovements)?d.positionMovements:null;
   if(saved&&storedValid(saved,src,op))parts=saved.map((p:Row)=>({...p}));
   else if(refund){
    const original=result.get(str(op.originalOperationId));
    if(original){
     const used=new Map(refunded),next:Row[]=[];let valid=true;
     for(const s of src){
      let left=s.amount;
      for(const p of original){
       if(!sameSource(s,p)||left<=0)continue;
       const amount=Math.min(left,Math.max(0,cents(p.amount)-(used.get(p.id)||0)));
       if(amount<=0)continue;
       const part={...s,id:key(id,next.length),positionKey:p.positionKey,positionId:p.positionId,positionName:p.positionName,positionType:p.positionType,amount:amount/100,originalPartId:p.id};
       next.push({...part,route:route(part,true)});
       used.set(p.id,(used.get(p.id)||0)+amount);left-=amount;
      }
      if(left!==0){valid=false;break;}
     }
     if(valid)parts=next;
    }
   }else if(!unresolved.has(source)){
    const items=positions(d);
    if(items&&[...balance].every(([k,n])=>n===0||items.some(p=>p.positionKey===k&&p.capacity>=n))){
     const used=new Map(balance),next:Row[]=[];let valid=true;
     const tipType=items.some(p=>p.positionType==='procedure')?'procedure':'product';
     for(const s of src){
      let left=s.amount;
      if(s.component==='tips'){
       const part={...s,id:key(id,next.length),positionKey:'',positionId:'',positionName:'',positionType:tipType,amount:left/100};
       next.push({...part,route:route(part,false,d.paymentTiming)});continue;
      }
      for(const p of items){
       if(left<=0)break;
       const amount=Math.min(left,Math.max(0,p.capacity-(used.get(p.positionKey)||0)));
       if(amount<=0)continue;
       const {capacity,...position}=p;
       const part={...s,...position,id:key(id,next.length),amount:amount/100};
       next.push({...part,route:route(part,false,d.paymentTiming)});
       used.set(p.positionKey,(used.get(p.positionKey)||0)+amount);left-=amount;
      }
      if(left!==0){valid=false;break;}
     }
     if(valid)parts=next;
    }
   }
  }
  if(parts&&refund){
   const original=result.get(str(op.originalOperationId)),used=new Map(refunded);
   if(!original)parts=null;
   else for(const p of parts){
    const old=original.find(q=>q.id===p.originalPartId);
    if(!old||!sameSource(p,old)||p.positionKey!==old.positionKey||p.positionType!==old.positionType||(used.get(old.id)||0)+cents(p.amount)>cents(old.amount)){parts=null;break;}
    used.set(old.id,(used.get(old.id)||0)+cents(p.amount));
   }
  }
  result.set(id,parts);
  if(!active)continue;
  if(!parts){unresolved.add(source);continue;}
  for(const p of parts){
   if(refund&&p.originalPartId)refunded.set(p.originalPartId,(refunded.get(p.originalPartId)||0)+cents(p.amount));
   if(p.component==='position')balance.set(p.positionKey,(balance.get(p.positionKey)||0)+(refund?-1:1)*cents(p.amount));
  }
  paid.set(source,balance);
 }
 return result;
}


// Detail already reconciled net position movements without modifying payment,
// refund, balance or ledger facts. Net position order stays sequential.
// Conditional accounting uses the existing operation-level proportional
// refund contract; apportion its confirmed components by cumulative net
// amount, in integer cents. Ordinary deposits use existing principal-first
// consumption/restoration. Missing or contradictory facts stay unresolved.
export function detailDepositPositionComponents(parts:Row[],data:Row,kind:string,accounting:Row[]=[]):Row[]{
 const result=parts.map(p=>{const {depositComponents,...rest}=p;return rest;});
 const refund=kind==='refund',sign=refund?1:-1;
 if(kind!=='payment'&&!refund)return result;
 const exact=(value:any):number|null=>{
  if(value==null||value===''||!Number.isFinite(Number(value)))return null;
  const n=cents(value);return Number.isSafeInteger(n)?n:null;
 };
 const signed=(n:number)=>n===0?0:n/100;
 const allocations=arr(data.depositAllocations);
 const depositId=(a:Row)=>str(a.depositId||a.sourceId||a.id);
 const discount=obj(data.depositDiscount);
 for(const a of allocations){
  const id=depositId(a),total=exact(a.amount);
  if(!id||total===null||total<=0||allocations.filter(x=>depositId(x)===id).length!==1)continue;
  const slices=result.filter(p=>p.sourceKind==='deposit'&&p.sourceId===id&&p.component==='position');
  if(!slices.length||slices.some(p=>exact(p.amount)===null||cents(p.amount)<=0)||slices.reduce((n,p)=>n+cents(p.amount),0)!==total)continue;
  const records=accounting.filter(r=>depositId(r)===id),record=records[0];
  const relatedDiscount=str(discount.depositId)===id||(!str(discount.depositId)&&obj(data.priceCondition).programType==='deposit'&&str(obj(data.priceCondition).depositId)===id&&cents(obj(data.settlement).pricePercentTotal)>0);
  let real=0,grant=0,reversed=0,used=0,restored=0,conditional=false;
  if(records.length){
   if(records.length!==1||record.confirmed!==true||exact(record.netAmount)!==total)continue;
   const values=[record.realDelta,record.benefitDelta,record.grossAmount,record.benefitGranted,record.benefitReversed,record.benefitUsed,record.benefitRestored].map(exact);
   if(values.some(v=>v===null))continue;
   const [r,b,g,gr,rv,u,rs]=values as number[];
   if(r+b!==sign*total||g!==total+(refund?rv:gr)||[g,gr,rv,u,rs].some(v=>v<0))continue;
   real=r;grant=gr;reversed=rv;used=u;restored=rs;conditional=true;
  }else{
   if(relatedDiscount)continue;
   const p=exact(a.principalAmount),b=exact(a.benefitAmount);
   if(p===null||b===null||p<0||b<0||p+b!==total)continue;
   real=sign*p;used=refund?0:b;restored=refund?b:0;
  }
  let before=0;
  for(const p of slices){
   const net=cents(p.amount),after=before+net;
   const share=(value:number)=>Math.sign(value)*(Math.round(Math.abs(value)*after/total)-Math.round(Math.abs(value)*before/total));
   const money=conditional?share(real):sign*(Math.min(Math.abs(real),after)-Math.min(Math.abs(real),before));
   const bonus=sign*net-money;
   const gr=share(grant),rv=share(reversed);
   p.depositComponents={money:signed(money),bonus:signed(bonus),
    grossAmount:conditional?signed(net+(refund?rv:gr)):null,
    benefitGranted:signed(gr),benefitReversed:signed(rv),
    bonusUsed:signed(conditional?share(used):refund?0:-bonus),
    bonusRestored:signed(conditional?share(restored):refund?bonus:0)};
   before=after;
  }
 }
 return result;
}
