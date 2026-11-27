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
function route(part:Row,refund:boolean){
 if(part.sourceKind==='deposit')return refund?'DEPOSIT_PAYMENT_REFUND':'DEPOSIT_SPEND';
 if(part.sourceKind==='personal')return refund?'PERSONAL_ACCOUNT_PAYMENT_REFUND':'PERSONAL_ACCOUNT_SPEND';
 const product=part.positionType==='product';
 if(refund)return product?'PRODUCT_REFUND':'SERVICE_REFUND';
 if(part.component==='tips')return product?'PRODUCT_TIPS':'TIPS';
 return product?'PRODUCT_REVENUE':'SERVICE_REVENUE';
}
function sameSource(refund:Row,original:Row){
 return refund.component===original.component&&refund.sourceKind===original.sourceKind&&(refund.sourceKind==='wallet'||refund.sourceId===original.sourceId);
}
function storedValid(parts:Row[],src:Row[],op:Row){
 const expected=new Map<string,number>(),actual=new Map<string,number>(),ids=new Set<string>();
 for(const s of src)expected.set(sourceKey(s),(expected.get(sourceKey(s))||0)+s.amount);
 for(const p of parts){
  if(!p.id||ids.has(p.id)||!['procedure','product'].includes(p.positionType)||!Number.isFinite(Number(p.amount))||cents(p.amount)<=0||(!p.positionKey&&p.component!=='tips')||p.route!==route(p,op.kind==='refund'))return false;
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
       next.push({...part,route:route(part,false)});continue;
      }
      for(const p of items){
       if(left<=0)break;
       const amount=Math.min(left,Math.max(0,p.capacity-(used.get(p.positionKey)||0)));
       if(amount<=0)continue;
       const {capacity,...position}=p;
       const part={...s,...position,id:key(id,next.length),amount:amount/100};
       next.push({...part,route:route(part,false)});
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
