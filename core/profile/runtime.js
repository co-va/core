import { apiRequest } from '../../core/auth.js';
import { consumeJournalBootstrap } from '../runtime/journal-bootstrap.js';
import { hydrateProfileFromServer, setProfileServerReady } from './data.js';
import { hydrateWorkplacesFromServer, setWorkplacesServerReady } from './workplaces/data.js';

let fullProfileStateLoad = null;

async function payload(response,fallback){const value=await response.json().catch(()=>({}));if(!response.ok)throw new Error(value?.message||fallback);return value;}

function hydrate(remote={}){
  hydrateProfileFromServer(remote?.profile||{},remote?.customProfessions||[],remote?.professionCatalog||[]);
  hydrateWorkplacesFromServer(remote?.workplaces||[],remote?.workplaceReferenceData||{});
}

if(typeof window!=='undefined'){
  window.addEventListener('book:auth-logout',()=>{
    fullProfileStateLoad=null;
    setProfileServerReady(false);
    setWorkplacesServerReady(false);
  });
}

export async function loadProfileState({full=false}={}){
  if(!full){
    setProfileServerReady(false);
    setWorkplacesServerReady(false);
    const bootstrap=await consumeJournalBootstrap('profileContext');
    if(bootstrap){
      hydrate(bootstrap);
      return bootstrap;
    }
  }

  if(!fullProfileStateLoad){
    setProfileServerReady(false);
    setWorkplacesServerReady(false);
    fullProfileStateLoad=apiRequest('/profile')
      .then((response)=>payload(response,'Не удалось загрузить данные профиля'))
      .then((remote)=>{
        hydrate(remote);
        setProfileServerReady(true);
        setWorkplacesServerReady(true);
        return remote;
      })
      .catch((error)=>{
        fullProfileStateLoad=null;
        throw error;
      });
  }
  return fullProfileStateLoad;
}
