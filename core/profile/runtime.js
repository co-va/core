import { apiRequest } from '../../core/auth.js';
import { consumeJournalBootstrap } from '../runtime/journal-bootstrap.js';
import { hydrateProfileFromServer, setProfileServerReady } from './data.js';
import { hydrateWorkplacesFromServer, setWorkplacesServerReady } from './workplaces/data.js';

async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}

function hydrate(remote={}){
  hydrateProfileFromServer(remote?.profile||{},remote?.customProfessions||[],remote?.professionCatalog||[]);
  hydrateWorkplacesFromServer(remote?.workplaces||[],remote?.workplaceReferenceData||{});
}

export async function loadProfileState(){
  setProfileServerReady(false);
  setWorkplacesServerReady(false);
  const bootstrap=await consumeJournalBootstrap('profile');
  const remote=bootstrap||await payload(await apiRequest('/profile'),'Не удалось загрузить данные профиля');
  hydrate(remote);
  setProfileServerReady(true);
  setWorkplacesServerReady(true);
}
