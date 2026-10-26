import { apiRequest } from '../auth.js';
import { hydrateDaysFromServer } from '../day/index.js';
import { hydrateProceduresFromServer } from '../../core/service/procedures/data.js';
import { hydrateBookingSettingsFromServer } from '../booking-settings/index.js';
import { consumeJournalBootstrap } from './journal-bootstrap.js';

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}
function hydrate(remote={}){hydrateDaysFromServer(Array.isArray(remote.days)?clone(remote.days):[]);hydrateProceduresFromServer({procedures:Array.isArray(remote.procedures)?clone(remote.procedures):[],procedureHistory:Array.isArray(remote.procedureHistory)?clone(remote.procedureHistory):[]});hydrateBookingSettingsFromServer(remote.bookingSettings&&typeof remote.bookingSettings==='object'&&!Array.isArray(remote.bookingSettings)?clone(remote.bookingSettings):null);}

export async function loadOperationalState(){const bootstrap=await consumeJournalBootstrap('operational');const remote=bootstrap||await payload(await apiRequest('/business-state/operational'),'Не удалось загрузить График, процедуры и настройки онлайн-записи');hydrate(remote);}
