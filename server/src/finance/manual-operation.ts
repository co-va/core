// Manual cash allocation uses integer cents and one document per distinct wallet.
// Keep the original position quantity/price separate from a partial cash slice.
type Row = Record<string,any>;
const text=(v:unknown)=>String(v??'').trim();
const cents=(v:unknown)=>Math.round(Number(v)*100);
export function planManualWalletDocuments(lines:Row[],allocations:Row[]){
 if(!lines.length||!allocations.length)throw Error('Введите сумму и выберите кошелёк');
 const amounts=lines.map(l=>cents(l.total));
 const total=amounts.reduce((n,a)=>n+a,0);
 if(!Number.isSafeInteger(total)||total<=0||amounts.some(a=>!Number.isSafeInteger(a)||a<=0))throw Error('Некорректная сумма позиции');
 const seen=new Set<string>();
 const wallets=allocations.map(a=>{
   const walletId=text(a.walletId),walletName=text(a.walletName),amount=cents(a.amount);
   if(!walletId||seen.has(walletId)||!Number.isSafeInteger(amount)||amount<=0)throw Error('Выберите разные кошельки и положительные суммы');
   seen.add(walletId);return {walletId,walletName,amount};
 });
 if(wallets.reduce((n,a)=>n+a.amount,0)!==total)throw Error('Сумма по кошелькам не совпадает с итогом');
 let index=0,remaining=amounts[0];
 return wallets.map(w=>{
   let left=w.amount;
   const slices:Row[]=[];
   while(left>0){
     const n=Math.min(left,remaining),line=lines[index];
     slices.push({...line,positionIndex:index,positionTotal:amounts[index]/100,total:n/100,partial:n!==amounts[index]});
     left-=n;remaining-=n;
     if(!remaining){index++;remaining=amounts[index]||0;}
   }
   return {walletId:w.walletId,walletName:w.walletName,total:w.amount/100,lines:slices};
 });
}
export function prepaymentArticleRoute(timing:unknown,positionType:unknown){
 return timing==='prepayment'&&positionType==='procedure'?'SERVICE_PREPAYMENT':'';
}
