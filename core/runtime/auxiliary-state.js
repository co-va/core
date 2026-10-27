import { apiRequest } from '../auth.js';
import { hydrateCashEntitiesFromServer, hydrateFinanceFromServer, hydrateWalletsFromServer } from '../finance/index.js';
import { hydrateProductsFromServer } from '../../core/service/products/data.js';
import { hydrateTagsFromServer } from '../../settings/tags/data.js';
import { hydrateCardAppearanceTemplates } from '../card-appearance-templates.js';
import { consumeJournalBootstrap } from './journal-bootstrap.js';

let financeStateLoad = null;
const auxiliaryStateLoads = new Map();

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function owns(value,key){return Boolean(value&&Object.prototype.hasOwnProperty.call(value,key));}
function hydrateAuxiliary(remote){
  if(owns(remote,'wallets')) hydrateWalletsFromServer(Array.isArray(remote.wallets)?clone(remote.wallets):[]);
  if(owns(remote,'investments')||owns(remote,'loans')){
    hydrateCashEntitiesFromServer({
      investments:Array.isArray(remote.investments)?clone(remote.investments):[],
      loans:Array.isArray(remote.loans)?clone(remote.loans):[],
    });
  }
  if(owns(remote,'tags')) hydrateTagsFromServer(Array.isArray(remote.tags)?clone(remote.tags):[]);
  if(owns(remote,'products')||owns(remote,'productHistory')){
    hydrateProductsFromServer({
      products:Array.isArray(remote.products)?clone(remote.products):[],
      productHistory:Array.isArray(remote.productHistory)?clone(remote.productHistory):[],
    });
  }
  if(owns(remote,'cardAppearanceTemplates')) hydrateCardAppearanceTemplates(Array.isArray(remote.cardAppearanceTemplates)?clone(remote.cardAppearanceTemplates):[]);
}

function inferredAuxiliaryScope(){
  const hash=String(globalThis.location?.hash||'').replace(/^#/,'').split('?')[0].trim();
  if(hash==='people')return 'people';
  if(hash==='loyalty')return 'loyalty';
  if(hash==='service')return 'service';
  if(hash==='finance')return 'finance';
  if(hash==='settings')return 'tags';
  return 'all';
}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('book:auth-logout',()=>{
    financeStateLoad=null;
    auxiliaryStateLoads.clear();
  });
}

export async function loadFinanceState({full=false}={}){
  if(!full){
    const bootstrap=await consumeJournalBootstrap('finance');
    if(bootstrap){hydrateFinanceFromServer(bootstrap);return bootstrap;}
  }
  if(!financeStateLoad){
    financeStateLoad=apiRequest('/finance')
      .then((response)=>payload(response,'Не удалось загрузить Финансы'))
      .then((finance)=>{hydrateFinanceFromServer(finance);return finance;})
      .catch((error)=>{financeStateLoad=null;throw error;});
  }
  return financeStateLoad;
}

export async function loadAuxiliaryState(scope=''){
  await Promise.resolve();
  const key=String(scope||inferredAuxiliaryScope()||'all').trim()||'all';
  if(!auxiliaryStateLoads.has(key)){
    const path=key==='all'?'/auxiliary-state':`/auxiliary-state/${encodeURIComponent(key)}`;
    const request=apiRequest(path)
      .then((response)=>payload(response,'Не удалось загрузить связанные данные'))
      .then((remote)=>{hydrateAuxiliary(remote);return remote;})
      .catch((error)=>{auxiliaryStateLoads.delete(key);throw error;});
    auxiliaryStateLoads.set(key,request);
  }
  return auxiliaryStateLoads.get(key);
}
