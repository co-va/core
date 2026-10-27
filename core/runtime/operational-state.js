import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateProceduresFromServer } from '../../core/service/procedures/data.js';
import { hydrateBookingSettingsFromServer } from '../booking-settings/index.js';
import { consumeJournalBootstrap } from './journal-bootstrap.js';

let fullOperationalStateLoad = null;

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function hydrateDays(remote={}){hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);}
function hydrateFull(remote={}){
  hydrateDays(remote);
  hydrateProceduresFromServer({
    procedures:Array.isArray(remote.procedures)?clone(remote.procedures):[],
    procedureHistory:Array.isArray(remote.procedureHistory)?clone(remote.procedureHistory):[],
  });
  hydrateBookingSettingsFromServer(remote.bookingSettings&&typeof remote.bookingSettings==='object'&&!Array.isArray(remote.bookingSettings)?clone(remote.bookingSettings):null);
}

if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
  window.addEventListener('book:auth-logout',()=>{fullOperationalStateLoad=null;});
}

export async function loadOperationalState({full=false}={}){
  if(!full){
    const bootstrap=await consumeJournalBootstrap('operationalContext');
    if(bootstrap){
      hydrateDays(bootstrap);
      return bootstrap;
    }
  }
  if(!fullOperationalStateLoad){
    fullOperationalStateLoad=apiRequest('/business-state/operational')
      .then((response)=>payload(response,'Не удалось загрузить График, процедуры и настройки онлайн-записи'))
      .then((remote)=>{hydrateFull(remote);return remote;})
      .catch((error)=>{fullOperationalStateLoad=null;throw error;});
  }
  return fullOperationalStateLoad;
}
