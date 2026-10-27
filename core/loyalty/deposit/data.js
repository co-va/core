import { apiRequest } from '../../auth.js';
import { describePriceConditionConflict, resolvePersonPriceCondition } from '../price-condition.js';

let programs = [];
let deposits = [];
let allDepositsRequest = null;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function list(value){return Array.isArray(value)?value:[];}
function text(value){return String(value??'').trim();}
function numberValue(value){const number=Number(String(value??'').replace(',','.'));return Number.isFinite(number)?number:0;}
function percent(value){return Math.max(0,Math.min(100,numberValue(value)));}
function localDateKey(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(date.getTime()))return '';
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function termsActive(terms={},at=new Date()){
  if(text(terms?.termMode).toLowerCase()!=='dated')return true;
  const day=localDateKey(at);
  const start=text(terms?.termStartDate).slice(0,10);
  const end=text(terms?.termEndDate).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return false;
  if(/^\d{4}-\d{2}-\d{2}$/.test(start)&&day<start)return false;
  return day<=end;
}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}

async function refreshFinance(){
  const { refreshFinanceState } = await import('../../finance/index.js');
  return refreshFinanceState();
}

function personKeyOf(value={}){
  const person=value?.person&&typeof value.person==='object'?value.person:{};
  return text(person.key||person.personKey||person.id);
}

function normalizeDeposits(value){
  return list(value).map((item)=>{
    const deposit=clone(item);
    deposit.history=list(deposit.history).map((entry)=>({
      ...entry,
      direction:text(entry?.direction).toLowerCase(),
    }));
    deposit.discountPercent=percent(deposit.discountPercent);
    return deposit;
  });
}

function replacePersonDeposits(personKey='',values=[]){
  const key=text(personKey);
  const incoming=normalizeDeposits(values);
  deposits=[...deposits.filter((item)=>personKeyOf(item)!==key),...incoming];
  return incoming.map((item)=>clone(item));
}

function upsertDeposit(value=null){
  const normalized=normalizeDeposits(value?[value]:[])[0]||null;
  if(!normalized?.depositId)return normalized;
  const id=text(normalized.depositId);
  const index=deposits.findIndex((item)=>text(item?.depositId)===id);
  if(index>=0)deposits[index]=normalized;
  else deposits.push(normalized);
  return clone(normalized);
}

export function getDepositPrograms(){return programs.map((item)=>clone(item));}
export function getDepositInstances(){return deposits.map((item)=>clone(item));}

export function hydrateDepositInstances(values=[]){
  deposits=normalizeDeposits(values);
  return getDepositInstances();
}

export function getPersonDepositPriceConditions(personKey=''){
  const key=text(personKey);
  if(!key)return [];
  return deposits
    .filter((deposit)=>personKeyOf(deposit)===key
      && text(deposit?.status)==='active'
      && termsActive(deposit?.terms)
      && percent(deposit?.discountPercent)>0)
    .map((deposit)=>({
      type:'program',
      programType:'deposit',
      depositId:text(deposit.depositId),
      programId:text(deposit.programId),
      name:text(deposit.programName)||'Депозит',
      percent:percent(deposit.discountPercent),
    }));
}

export async function loadDepositPrograms(){
  const remote=await payload(await apiRequest('/auxiliary-state/loyalty'),'Не удалось загрузить депозитные программы');
  programs=list(remote.depositPrograms).map((item)=>clone(item));
  return getDepositPrograms();
}

export async function loadAllDeposits(){
  if(!allDepositsRequest){
    allDepositsRequest=apiRequest('/loyalty/deposits')
      .then((response)=>payload(response,'Не удалось загрузить депозиты'))
      .then((remote)=>{
        deposits=normalizeDeposits(remote);
        return getDepositInstances();
      })
      .finally(()=>{
        allDepositsRequest=null;
      });
  }
  return allDepositsRequest;
}

export async function saveDepositPrograms(next=[]){
  const values=list(next).map((item)=>clone(item));
  const nextIds=new Set(values.map((item)=>text(item?.id)).filter(Boolean));
  const removedProgramIds=programs.map((item)=>text(item?.id)).filter((id)=>id&&!nextIds.has(id));
  if(removedProgramIds.length){
    for(const programId of removedProgramIds){
      await payload(await apiRequest(`/loyalty/deposits/program/${encodeURIComponent(programId)}`,{method:'DELETE'}),'Не удалось полностью удалить депозитную программу');
    }
    await Promise.all([refreshFinance(),loadAllDeposits()]);
    return loadDepositPrograms();
  }
  const remote=await payload(await apiRequest('/auxiliary-state/depositPrograms',{
    method:'PUT',
    body:JSON.stringify({value:values}),
  }),'Не удалось сохранить депозитные программы');
  programs=list(remote.depositPrograms).map((item)=>clone(item));
  return getDepositPrograms();
}

export async function listPersonDeposits(personKey=''){
  const key=text(personKey);
  if(!key)return [];
  const values=await payload(await apiRequest(`/loyalty/deposits/person/${encodeURIComponent(key)}`),'Не удалось загрузить депозиты');
  return replacePersonDeposits(key,values);
}

export async function listAllDeposits(){
  return loadAllDeposits();
}

async function assertPricePercentAvailable(programId='',person=null){
  const program=programs.find((item)=>text(item?.id)===text(programId))||null;
  const incomingPercent=text(program?.benefitType)==='discount'?percent(program?.benefitValue):0;
  if(incomingPercent<=0)return;
  const key=text(person?.key||person?.id);
  if(!key)return;
  const { getAllPeople } = await import('../../people/data.js');
  const owner=getAllPeople().find((item)=>text(item?.key||item?.id)===key)||person||{};
  await listPersonDeposits(key);
  const incoming={
    type:'program',
    programType:'deposit',
    programId:text(program?.id||programId),
    name:text(program?.name)||'Депозит',
    percent:incomingPercent,
  };
  const condition=resolvePersonPriceCondition(owner,[...getPersonDepositPriceConditions(key),incoming]);
  if(condition.conflict){
    throw new Error(`Процентная скидка задваивается: ${describePriceConditionConflict(condition)}. Оставьте один источник скидки и повторите оформление.`);
  }
}

export async function fundDeposit({programId='',person=null,amount=0,walletId='',walletName='',occurredAt=null}={}){
  if(!programId||!person?.key||!walletId||!occurredAt)return null;
  await assertPricePercentAvailable(programId,person);
  const result=await payload(await apiRequest('/loyalty/deposits/fund',{
    method:'POST',
    body:JSON.stringify({
      programId,
      person,
      amount,
      walletId,
      walletName,
      occurredAt:occurredAt instanceof Date?occurredAt.toISOString():occurredAt,
    }),
  }),'Не удалось оформить депозит');
  return upsertDeposit(result);
}

export async function withdrawDeposit({depositId='',amount=0,walletId='',walletName='',reason='',occurredAt=null}={}){
  if(!depositId||!walletId||!occurredAt)return null;
  const result=await payload(await apiRequest(`/loyalty/deposits/${encodeURIComponent(depositId)}/withdraw`,{
    method:'POST',
    body:JSON.stringify({
      amount,
      walletId,
      walletName,
      reason,
      occurredAt:occurredAt instanceof Date?occurredAt.toISOString():occurredAt,
    }),
  }),'Не удалось вернуть остаток депозита');
  return upsertDeposit(result);
}

export async function deleteDeposit(depositId=''){
  const id=text(depositId);
  if(!id)return false;
  await payload(await apiRequest(`/loyalty/deposits/${encodeURIComponent(id)}`,{method:'DELETE'}),'Не удалось полностью удалить депозит');
  deposits=deposits.filter((item)=>text(item?.depositId)!==id);
  await refreshFinance();
  return true;
}
