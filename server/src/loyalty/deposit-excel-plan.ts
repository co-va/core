import { createHash, randomUUID } from 'node:crypto';
import { normalizePhone } from '../../../core/phone/index.js';
import { depositTermActiveAt } from './deposit-state';
import { depositHistoricalLedger } from './deposit-history';
import { excelDay, DepositExcelRawRow } from './deposit-excel-format';

type Row = Record<string, any>;
export type ExcelEvent = {
  row:number; operationId:string; depositId:string; personKey:string; programId:string; programName:string;
  person:Row; terms:Row; kind:string; amount:number; occurredAt:Date; walletId:string; walletName:string;
  note:string; externalOperationId:string; principalAmount:number; benefitAmount:number;
};
export type ExcelPlan = { programs:Row[]; people:Row[]; identity:Row; events:ExcelEvent[];
  errors:Array<{row:number;message:string}>; skipped:number; selected:number };
const text=(x:unknown)=>String(x??'').trim();
const obj=(x:unknown):Row=>x&&typeof x==='object'&&!Array.isArray(x)?x as Row:{};
const words=(x:string)=>x.trim().toLocaleLowerCase('ru-RU');
const money=(x:unknown)=>Math.round(Number(String(x??'0').replace(/\s/g,'').replace(',','.'))*100)/100;
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
const amountOk=(x:number)=>Number.isFinite(x)&&x>0&&x<=1_000_000_000;
const num=(x:number,y:number)=>Math.round((x+y)*100)/100;
const AMOUNTS:Row={'фиксированная':'fixed','фиксированная сумма':'fixed',fixed:'fixed','свободная':'free','свободная сумма':'free',free:'free'};
const TERMS:Row={'бессрочно':'indefinite',indefinite:'indefinite','период':'dated',dated:'dated'};
const BENEFITS:Row={'нет':'none',none:'none','без дополнительной выгоды':'none','на обслуживание':'discount',discount:'discount','выгода на обслуживание':'discount','начисление сразу':'accrual',accrual:'accrual','выгода сразу':'accrual'};
const ACTIONS:Row={'пополнение':'deposit-funding','списание':'deposit-import-spend'};
const lookup=(v:string,dict:Row,label:string)=>!v?'':(dict[words(v)]||(()=>{throw Error('Некорректное значение «'+label+'»: '+v)})());
function conditions(row:DepositExcelRawRow):Row|null {
  const values=[row.amountMode,row.nominal,row.termMode,row.termStartDate,row.termEndDate,row.benefitType,row.benefitPercent,row.description];
  if(!values.some(Boolean))return null;
  const amountMode=lookup(row.amountMode,AMOUNTS,'Вид суммы')||(row.nominal?'fixed':'');
  if(!amountMode)throw Error('Заполните вид суммы');
  const amount=row.nominal?money(row.nominal):0;
  if(amountMode==='fixed'&&!amountOk(amount)||amountMode==='free'&&amount!==0)throw Error('Проверьте номинал');
  const termMode=lookup(row.termMode,TERMS,'Срок')||(row.termStartDate||row.termEndDate?'dated':'indefinite');
  const start=row.termStartDate?excelDay(row.termStartDate):'';
  const end=row.termEndDate?excelDay(row.termEndDate):'';
  if(termMode==='dated'&&(!start||!end||start>end)||termMode==='indefinite'&&(start||end))throw Error('Проверьте срок «С — По»');
  const benefitType=lookup(row.benefitType,BENEFITS,'Выгода')||(!row.benefitPercent?'none':'');
  if(!benefitType)throw Error('Укажите вид выгоды');
  const rate=row.benefitPercent?money(row.benefitPercent):0;
  if(!Number.isFinite(rate)||rate<0||rate>100||benefitType==='none'&&rate!==0||benefitType!=='none'&&rate<=0)throw Error('Проверьте процент выгоды');
  return {name:row.programName,amountMode,amount,termMode,termStartDate:start,termEndDate:end,
    termRule:termMode==='dated'?start+' — '+end:'Бессрочно',benefitType,benefitValue:rate,
    benefit:benefitType==='discount'?'На обслуживание '+rate+'%':benefitType==='accrual'?'Сразу +'+rate+'%':'',
    description:row.description,showToAll:true,status:'active',archivedAt:null};
}
function same(a:Row,b:Row):boolean {
  return ['amountMode','amount','termMode','termStartDate','termEndDate','benefitType','benefitValue'].every(k=>
    k==='amount'||k==='benefitValue'?money(a[k])===money(b[k]):text(a[k])===text(b[k]));
}
function assignCode(identity:Row,type:string,id:string,preferred='') {
  identity.entities ||= {};identity.relations ||= {};identity.revoked ||= [];
  const relation=type+':'+id;
  if(identity.relations[relation])return;
  const occupied=(c:string)=>Boolean(identity.entities[c])
    ||(identity.revoked as Row[]).some(x=>text(x.uei)===c);
  let code=preferred.toUpperCase();
  if(!code)for(let n=1;n<36**4;n++){const c=n.toString(36).toUpperCase().padStart(4,'0');if(!occupied(c)){code=c;break;}}
  if(!/^[A-ZА-ЯЁ0-9]{4}$/.test(code)||code==='0000'||occupied(code))throw Error('UEI не существует или уже занят: '+code);
  identity.entities[code]={uei:code,owner:{type,id},members:[relation],history:[],reserved:true};
  identity.relations[relation]=code;
}
export async function planDepositExcel(db:any,tenantId:string,lines:DepositExcelRawRow[],batchId:string,from:string,to:string):Promise<ExcelPlan> {
  const errors:ExcelPlan['errors']=[];
  const programs:Row[]=(await db.loyaltyDepositProgram.findMany({where:{tenantId}})).map((x:Row)=>obj(x.data));
  const people:Row[]=(await db.person.findMany({where:{tenantId}})).map((x:Row)=>obj(x.data));
  const deposits:Row[]=(await db.loyaltyDepositInstance.findMany({where:{tenantId}})).map((x:Row)=>({...x,terms:obj(x.terms)}));
  const existing:Row[]=await db.financeOperation.findMany({where:{tenantId,kind:{in:['deposit-funding','deposit-withdrawal','payment','refund','deposit-import-spend']}}});
  const simulated:Row[]=[...existing];
  const auxiliary=await db.businessAuxiliaryState.findUnique({where:{tenantId}});
  const wallets:Row[]=[{id:'cash',name:'Наличные'},{id:'cashless',name:'Безналичные'},
    ...(Array.isArray(obj(auxiliary?.data).wallets)?obj(auxiliary?.data).wallets:[]).filter((w:Row)=>!w.deletedAt)];
  const idRow=await db.ueiState.findUnique({where:{tenantId}});
  const identity:Row=JSON.parse(JSON.stringify(idRow?.data||{entities:{},relations:{},revoked:[]}));
  identity.entities ||= {}; identity.relations ||= {}; identity.revoked ||= [];
  const newPrograms:Row[]=[],newPeople:Row[]=[],events:ExcelEvent[]=[];
  const definitions=new Map<string,Row>();
  const seenIds=new Set<string>();
  const invalidCodes=new Set<number>();
  let skipped=0,selected=0;
  for(const line of lines) {
    if(line.legacy)continue;
    try{
      const code=String(line.programUei||'').trim().toUpperCase();
      const client=String(line.personCode||'').trim().toUpperCase();
      const card=String(line.cardKey||'').trim().toUpperCase();
      const validCode=(x:string)=>/^[A-ZА-ЯЁ0-9]{4}$/.test(x)&&x!=='0000';
      if(code&&!validCode(code))
        throw Error('Код программы должен содержать ровно 4 буквы или цифры');
      if(client&&!validCode(client))
        throw Error('Код клиента должен содержать ровно 4 буквы или цифры');
      if(card&&!/^[A-ZА-ЯЁ0-9]{8}$/.test(card))
        throw Error('Номер карты должен содержать ровно 8 букв или цифр');
      if(card&&((code&&code!==card.slice(0,4))||(client&&client!==card.slice(4))))
        throw Error('Номер карты не совпадает с кодами программы и клиента');
      // A known card number supplies missing program/client codes automatically.
      line.programUei=code||(card?card.slice(0,4):'');
      line.personCode=client||(card?card.slice(4):'');
      line.cardKey=card;
    }catch(e){
      errors.push({row:line.row,message:(e as Error).message});
      invalidCodes.add(line.row);
    }
  }
  for(const line of lines) {
    if(invalidCodes.has(line.row))continue;
    if(!line.programName)continue;
    try {
      const definition=conditions(line);
      if(!definition)continue;
      const id=words(line.programName)+'|'+line.programUei.toUpperCase();
      const previous=definitions.get(id);
      if(previous&&!same(previous,definition))throw Error('Разные условия у одной программы');
      definitions.set(id,definition);
    }catch(e){errors.push({row:line.row,message:(e as Error).message});}
  }
  const active:Array<{line:DepositExcelRawRow;date:Date}>=[];
  for(const line of lines) {
    if(invalidCodes.has(line.row))continue;
    if(!line.action&&!line.amount&&!line.occurredAt)continue;
    const dateKey=excelDay(line.occurredAt);
    if(!dateKey){errors.push({row:line.row,message:'Укажите правильную дату операции'});continue;}
    if(from&&dateKey<from||to&&dateKey>to)continue;
    const date=new Date(dateKey+'T12:00:00.000Z');
    if(dateKey>new Date().toISOString().slice(0,10)){errors.push({row:line.row,message:'Будущие платежи нельзя импортировать как совершённые'});continue;}
    selected++;
    active.push({line,date});
  }
  active.sort((a,b)=>a.date.getTime()-b.date.getTime()
    ||Number(b.line.action==='Пополнение')-Number(a.line.action==='Пополнение')
    ||a.line.row-b.line.row);
  for(const {line,date} of active) {
    try {
      if(!line.programName)throw Error('Укажите депозит');
      const kind=ACTIONS[words(line.action)];
      if(!kind)throw Error('Действие: Пополнение или Списание');
      const amount=money(line.amount);
      if(!amountOk(amount))throw Error('Положительная сумма обязательна');
      const code=line.programUei.toUpperCase();
      const definition=definitions.get(words(line.programName)+'|'+code)||definitions.get(words(line.programName)+'|');
      let program:Row|undefined;
      const mapped=code?Object.entries(obj(identity.relations)).find(([k,v])=>
        k.startsWith('loyalty-deposit-program:')&&text(v)===code):null;
      if(mapped)program=programs.find(p=>text(p.id)===mapped[0].slice('loyalty-deposit-program:'.length));
      if(!program) {
        const candidates=programs.filter(p=>words(text(p.name))===words(line.programName)
          &&(!definition||same(p,definition)));
        if(candidates.length>1)throw Error('Несколько депозитных программ: нужен UEI');
        program=candidates[0];
      }
      if(program&&definition&&!same(program,definition))throw Error('Условия депозита отличаются от существующих');
      if(!program) {
        if(!definition)throw Error('Для новой программы заполните условия в её первой строке');
        program={...definition,id:randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        programs.push(program);newPrograms.push(program);
        assignCode(identity,'loyalty-deposit-program',text(program.id),code);
      } else if(code&&!obj(identity.relations)['loyalty-deposit-program:'+text(program.id)]) {
        assignCode(identity,'loyalty-deposit-program',text(program.id),code);
      }
      const fullName=line.personName.trim(),parts=fullName.split(/\s+/).filter(Boolean),first=parts[0]||'',last=parts.slice(1).join(' ');
      const phone=line.phone?normalizePhone(line.phone):'';
      if(line.phone&&!phone)throw Error('Некорректный телефон');
      const personCode=line.personCode.toUpperCase();
      const byCode=people.filter(p=>text(p.key)===line.personCode||personCode.length===4&&text(obj(identity.relations)['person:'+text(p.key)])===personCode);
      const byPhone=phone?people.filter(p=>Array.isArray(p.phones)&&p.phones.some((v:unknown)=>normalizePhone(v)===phone)):[];
      const byName=fullName?people.filter(p=>words([p.name,p.surname].filter(Boolean).join(' '))===words(fullName)):[];
      // A same-name contact with a DIFFERENT phone is never an identity match.
      // Using a name-only fallback here would silently assign another person's
      // imported deposit, violating financial ownership isolation.
      const candidates=byCode.length||byPhone.length
        ? [...new Set([...byCode,...byPhone])]
        : (phone || personCode ? [] : byName);
      if(candidates.length>1)throw Error('Контакт неоднозначен: укажите телефон или код');
      let person=candidates[0];
      if(person&&first&&words(text(person.name))!==words(first))throw Error('Имя не совпадает с контактом');
      if(!person) {
        if(!first)throw Error('Укажите человека');
        person={key:randomUUID(),name:first,surname:last,phones:phone?[phone]:[],creationSource:'import',createdAt:new Date().toISOString()};
        people.push(person);newPeople.push(person);
        assignCode(identity,'person',text(person.key),personCode.length===4?personCode:'');
      }
      const cardKey=line.cardKey.trim();
      let candidatesDeposits=deposits.filter(d=>text(d.programId)===text(program!.id)&&text(d.personKey)===text(person!.key));
      if(cardKey)candidatesDeposits=candidatesDeposits.filter(d=>
        text(obj(d.terms).importCardKey).toUpperCase()===cardKey
        ||text(d.depositId)===cardKey
        // A canonical 4+4 card is derivable even for older deposits without
        // a stored card key. Never manufacture another deposit on re-import.
        ||(!text(obj(d.terms).importCardKey)
          &&text(obj(identity.relations)['loyalty-deposit-program:'+text(program!.id)])+
            text(obj(identity.relations)['person:'+text(person!.key)])===cardKey));
      if(candidatesDeposits.length>1)throw Error('Несколько депозитов человека: укажите номер карты');
      let deposit=candidatesDeposits[0];
      if(!deposit) {
        if(kind!=='deposit-funding')throw Error('Списание раньше первого пополнения');
        deposit={id:randomUUID(),tenantId,programId:program.id,programName:program.name,personKey:person.key,
          person:{key:person.key,name:[person.name,person.surname].filter(Boolean).join(' '),phone},
          terms:{...program,...(cardKey?{importCardKey:cardKey}:{})},initialAmount:0,status:'active',fundedAt:date};
        deposit.depositId=deposit.id;deposits.push(deposit);
      }
      if(text(deposit.status)==='closed')throw Error('Депозит закрыт возвратом');
      if(!depositTermActiveAt(deposit.terms,date))throw Error('Дата вне срока действия депозита');
      const externalOperationId=line.externalOperationId||'auto:'+batchId+':'+line.row;
      // Export-only canonical IDs retain the identity of imported operations.
      // Application-owned operations must NEVER be imported again as new cash.
      const canonicalImport=/^excel-[a-f0-9]{40}$/.test(externalOperationId);
      if(line.externalOperationId&&!canonicalImport&&existing.some(op=>
        text(op.operationId)===line.externalOperationId&&op.origin!=='excel_import'))
        throw Error('Эта системная операция уже существует. Её нельзя загружать повторно.');
      const operationId=canonicalImport?externalOperationId
        :'excel-'+hash(tenantId+':deposit-excel:'+externalOperationId).slice(0,40);
      if(seenIds.has(operationId))throw Error('В файле повторяется ID операции');
      seenIds.add(operationId);
      const prior=existing.find(o=>text(o.operationId)===operationId);
      if(prior) {
        if(prior.origin!=='excel_import'||text(prior.kind)!==kind||text(prior.sourceId)!==text(deposit.depositId)
          ||money(obj(prior.data).amount)!==amount||prior.occurredAt.toISOString().slice(0,10)!==date.toISOString().slice(0,10)) {
          throw Error('Такой ID операции уже существует с другими значениями');
        }
        skipped++;continue;
      }
      if(!line.externalOperationId&&existing.some(o=>text(o.sourceId)===text(deposit.depositId)
        &&text(o.kind)===kind&&o.occurredAt.toISOString().slice(0,10)===date.toISOString().slice(0,10)
        &&money(obj(o.data).amount)===amount))throw Error('Возможный дубль: уточните ID операции');
      let walletId='',walletName='';
      if(kind==='deposit-funding'&&line.wallet) {
        const resolved=[...new Map(wallets.filter(w=>words(text(w.name))===words(line.wallet)
          ||words(text(w.id))===words(line.wallet)).map(w=>[text(w.id),w])).values()];
        if(resolved.length!==1)throw Error('Неверный или неоднозначный кошелёк: '+line.wallet);
        walletId=text(resolved[0].id);walletName=text(resolved[0].name);
      }
      if(kind==='deposit-funding') {
        const total=num(money(deposit.initialAmount),amount);
        if(text(obj(deposit.terms).amountMode)==='fixed'&&total>money(obj(deposit.terms).amount)+0.009)throw Error('Пополнение превышает номинал');
        deposit.initialAmount=total;
      }
      let principalAmount=0,benefitAmount=0;
      if(kind==='deposit-import-spend') {
        const result=depositHistoricalLedger(simulated,text(deposit.depositId),deposit.terms,date,amount);
        if(!result.allocation)throw Error('Не удалось проверить списание');
        principalAmount=result.allocation.principalAmount;benefitAmount=result.allocation.benefitAmount;
      }
      const event:ExcelEvent={row:line.row,operationId,depositId:text(deposit.depositId),
        personKey:text(person.key),programId:text(program.id),programName:text(program.name),
        person:obj(deposit.person),terms:obj(deposit.terms),kind,amount,occurredAt:date,walletId,walletName,
        note:line.note,externalOperationId,principalAmount,benefitAmount};
      events.push(event);
      simulated.push({operationId,kind,status:'completed',sourceType:'deposit',sourceId:event.depositId,
        occurredAt:date,createdAt:new Date(),data:kind==='deposit-funding'?{amount,total:amount,walletId,walletName}
          :{amount,total:amount,depositAllocations:[{depositId:event.depositId,amount,principalAmount,benefitAmount}]}});
    }catch(e){errors.push({row:line.row,message:(e as Error).message});}
  }
  for(const id of new Set(events.map(e=>e.depositId))) {
    try {
      const deposit=deposits.find(d=>text(d.depositId)===id)!;
      depositHistoricalLedger(simulated,id,deposit.terms,new Date('9999-12-31T23:59:59Z'));
    }catch(e){errors.push({row:events.find(x=>x.depositId===id)?.row||0,message:(e as Error).message});}
  }
  return {programs:newPrograms,people:newPeople,identity,events,errors,skipped,selected};
}
