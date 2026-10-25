import { apiRequest } from '../auth.js';
import { hydrateFinanceFromServer } from '../finance/data.js';
import { hydrateWalletsFromServer } from '../finance/cash/data.js';
import { hydrateCashEntitiesFromServer } from '../finance/cash/entities.js';
import { hydrateProductsFromServer } from '../../core/service/products/data.js';
import { hydrateTagsFromServer } from '../../settings/tags/data.js';
import { hydrateCardAppearanceTemplates } from '../card-appearance-templates.js';

let financeStateLoad = null;
let auxiliaryStateLoad = null;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function hydrateAuxiliary(remote){hydrateWalletsFromServer(Array.isArray(remote.wallets)?clone(remote.wallets):[]);hydrateCashEntitiesFromServer({investments:Array.isArray(remote.investments)?clone(remote.investments):[],loans:Array.isArray(remote.loans)?clone(remote.loans):[]});hydrateTagsFromServer(Array.isArray(remote.tags)?clone(remote.tags):[]);hydrateProductsFromServer({products:Array.isArray(remote.products)?clone(remote.products):[],productHistory:Array.isArray(remote.productHistory)?clone(remote.productHistory):[]});hydrateCardAppearanceTemplates(Array.isArray(remote.cardAppearanceTemplates)?clone(remote.cardAppearanceTemplates):[]);}

if(typeof window!=='undefined'){
  window.addEventListener('book:auth-logout',()=>{
    financeStateLoad=null;
    auxiliaryStateLoad=null;
  });
}

export function loadFinanceState(){
  if(!financeStateLoad){
    financeStateLoad=apiRequest('/finance')
      .then((response)=>payload(response,'Не удалось загрузить Финансы'))
      .then((finance)=>{hydrateFinanceFromServer(finance);return finance;})
      .catch((error)=>{financeStateLoad=null;throw error;});
  }
  return financeStateLoad;
}

export function loadAuxiliaryState(){
  if(!auxiliaryStateLoad){
    auxiliaryStateLoad=apiRequest('/auxiliary-state')
      .then((response)=>payload(response,'Не удалось загрузить связанные данные'))
      .then((remote)=>{hydrateAuxiliary(remote);return remote;})
      .catch((error)=>{auxiliaryStateLoad=null;throw error;});
  }
  return auxiliaryStateLoad;
}
