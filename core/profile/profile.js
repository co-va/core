import { actionBlock, button, collectRepeatedField, entityVisualCard, escapeHtml, field, initPhotoField, initRepeatedFields, modal, mountModal, mountV2ZLayer, openEntityCardAppearanceQ, openSharedProfileSettingsMenu, openSharedPasswordAction, page, photoField, repeatedField, searchableSelect, select, textareaField, v2HorizontalRail, v2Section, workspaceHeaderContext, v2ZLayer, workplaceAddButton } from '../../ui/ui.js';
import { canUseBookCapability, getBookAccess, getBookLimit, loadBookAccess, requestLiveMode } from '../../core/access.js';
import { changePassword, logout } from '../../core/auth.js';
import { getProfessionCatalog, getProfile, saveProfile as saveProfileData } from './data.js';
import { getWorkplaces, saveWorkplaces, upsertWorkplace } from './workplaces/data.js';
import { bindWorkplaceForm, openWorkplaceSettingsMenu, workplaceForm } from './workplaces/workplaces.js';
import { profileCardAppearance, profileCardFields, workplaceCardAppearance, workplaceCardFields, workplaceCardPhoto } from './card-presentation.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../core/card-appearance-templates.js';
import { loadProfileState } from './runtime.js';

const EXPERIENCES=['Без опыта','До 1 года','1–3 года','3–5 лет','5–10 лет','10–15 лет','15–20 лет','Более 20 лет'];
const fullName=p=>[p.name,p.surname].filter(Boolean).join(' ')||'Ваш профиль';
const initial=p=>fullName(p).slice(0,1).toUpperCase()||'?';
const crop=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(100,Math.round(Number(v)))):50;
const avatarPosition=p=>`${crop(p.photoCropX)}% ${crop(p.photoCropY)}%`;
const professionOptions=(current='')=>[...new Set([current,...getProfessionCatalog()].map(value=>String(value||'').trim()).filter(Boolean))];

function demoRemainingText(access){
  const expiresAt=new Date(access?.demoExpiresAt||0).getTime();
  if(!Number.isFinite(expiresAt)||!expiresAt)return 'DEMO';
  const diff=Math.max(0,expiresAt-Date.now());
  if(diff<=0)return 'DEMO завершено';
  const hours=Math.ceil(diff/3_600_000);
  if(hours<24)return `DEMO · осталось ${hours} ч.`;
  return `DEMO · осталось ${Math.ceil(hours/24)} дн.`;
}

export function render(root,navigateBack=()=>{},options={}){
  return loadProfileState({full:true}).then(()=>renderProfile(root,navigateBack,options));
}

function profileContext(p,title=fullName(p)){
  return workspaceHeaderContext({
    title,
    a:{kind:'avatar',image:p.photo||'',imagePosition:avatarPosition(p),initials:initial(p)},
    v:{data:'data-profile-settings',aria:'Настройки профиля'},
  });
}

function profileCard(p){
  const workplaces=canUseBookCapability('workplaces.access')?getWorkplaces():[];
  return entityVisualCard({
    appearance:profileCardAppearance(p),
    fields:profileCardFields(p,workplaces),
    image:p.photo||'',
    imagePosition:avatarPosition(p),
    interactive:true,
    data:'data-profile-card',
    aria:'Открыть данные профиля',
  });
}

function workplaceRail(){
  const items=getWorkplaces();
  if(!items.length){
    return '<div class="v2-profile-empty">Рабочих пространств пока нет.</div>';
  }
  const p=getProfile();
  return v2HorizontalRail(items.map(w=>entityVisualCard({
    appearance:workplaceCardAppearance(w),
    fields:workplaceCardFields(w,p),
    image:workplaceCardPhoto(w),
    imagePosition:`${crop(w.photoCropX)}% ${crop(w.photoCropY)}%`,
    interactive:true,
    data:`data-workplace="${escapeHtml(w.key)}"`,
    aria:`Открыть рабочее пространство ${w.name||''}`,
  })).join(''),{className:'v2-profile-workplaces'});
}

function profileDataFields(p,emails,includePhoto=false){
  const photo=includePhoto?photoField({
    name:'profilePhoto',
    value:p.photo||'',
    cropX:p.photoCropX,
    cropY:p.photoCropY,
    cropXName:'profilePhotoCropX',
    cropYName:'profilePhotoCropY',
  }):'';
  return `<div class="v2-profile-data-grid">
    ${v2Section('Личные данные',`<div class="form-grid">${photo}${field({label:'Имя',name:'profileName',value:p.name,placeholder:'Ваше имя',required:true})}${field({label:'Фамилия',name:'profileSurname',value:p.surname,placeholder:'Ваша фамилия'})}${textareaField({label:'О себе',name:'profileAbout',value:p.about||'',placeholder:'Коротко о себе'})}</div>`)}
    ${v2Section('Контактные данные',repeatedField({label:'Телефон',name:'profilePhones',values:p.phones?.length?p.phones:[p.phone||''],type:'tel'})+repeatedField({label:'Telegram',name:'profileTelegrams',values:p.telegrams||[]})+repeatedField({label:'Email',name:'profileEmails',values:emails,type:'email'}))}
    ${v2Section('Профессиональные данные',`<div class="form-grid">${searchableSelect({label:'Профессия',name:'profession',value:p.profession||'',options:professionOptions(p.profession),placeholder:'Введите профессию',required:true})}${select({label:'Опыт работы',name:'experience',value:p.experience||'',options:[{value:'',label:'Не указан'},...EXPERIENCES.map(v=>({value:v,label:v}))]})}${textareaField({label:'О профессии',name:'professionAbout',value:p.professionAbout||'',placeholder:'Расскажите о своей профессии'})}</div>`)}
  </div>`;
}

function profileDataForm(p,options={}, {embedded=false}={}){
  const emails=p.emails?.length?p.emails:(options.accountEmail?[options.accountEmail]:[]);
  return `<form class="v2-profile-data-form" data-profile-data-form>
    ${profileDataFields(p,emails,embedded)}
    <div class="form-error" data-profile-error></div>
    ${actionBlock(button('Сохранить',{type:'submit',data:`data-save-profile${embedded?' data-profile-save-always':''}`}))}
  </form>`;
}

function formSnapshot(form){
  if(!form)return '';
  return JSON.stringify([...new FormData(form).entries()].map(([key,value])=>[key,typeof value==='string'?value:'']));
}

function showProfileError(message){
  mountModal(document.body,modal(`<div class="modal-title"><h2>Не удалось сохранить</h2><p>${escapeHtml(message||'Ошибка сервера')}</p></div>`,{variant:'s',title:'Не удалось сохранить'}));
}

function openWorkplaceLimitModal(root,limit){
  const current=Number.isFinite(limit)?String(limit):'текущий лимит';
  const m=mountModal(root,modal(`<div class="modal-title"><h2>Работаете в нескольких местах?</h2><p>Сейчас доступно рабочих пространств: ${escapeHtml(current)}.</p></div>${actionBlock(button('Понятно',{data:'data-close-workplace-limit'}))}`,{variant:'s',title:'Рабочие пространства'}));
  m?.querySelector('[data-close-workplace-limit]')?.addEventListener('click',()=>m.v2Close?.());
}

function collectProfileData(root){
  const current=getProfile();
  const phones=collectRepeatedField(root,'profilePhones');
  return {
    ...current,
    key:'profile',
    name:root.querySelector('[name="profileName"]')?.value.trim()||'',
    surname:root.querySelector('[name="profileSurname"]')?.value.trim()||'',
    phone:phones[0]||'',
    phones,
    telegrams:collectRepeatedField(root,'profileTelegrams'),
    emails:collectRepeatedField(root,'profileEmails'),
    about:root.querySelector('[name="profileAbout"]')?.value.trim()||'',
    photo:root.querySelector('[data-photo-value]')?.value||current.photo||'',
    photoCropX:Number(root.querySelector('[name="profilePhotoCropX"]')?.value||current.photoCropX||50),
    photoCropY:Number(root.querySelector('[name="profilePhotoCropY"]')?.value||current.photoCropY||50),
    profession:root.querySelector('[name="profession"]')?.value||'',
    experience:root.querySelector('[name="experience"]')?.value||'',
    professionAbout:root.querySelector('[name="professionAbout"]')?.value.trim()||''
  };
}

async function persistDraft(root){
  const data=collectProfileData(root);
  await saveProfileData(data);
  return data;
}

function bindProfileData(layer,p,options,onSaved){
  if(layer.querySelector('[data-photo-field]'))initPhotoField(layer);
  initRepeatedFields(layer);
  const form=layer.querySelector('[data-profile-data-form]');
  const saveButton=layer.querySelector('[data-save-profile]');
  const saveActions=saveButton?.closest('.modal-actions');
  const alwaysVisible=saveButton?.hasAttribute('data-profile-save-always');
  const initial=formSnapshot(form);

  const syncDirty=()=>{
    if(!form||!saveActions||alwaysVisible)return;
    saveActions.hidden=formSnapshot(form)===initial;
  };

  form?.addEventListener('input',syncDirty);
  form?.addEventListener('change',syncDirty);

  const save=async()=>{
    const data=collectProfileData(layer);
    if(!data.name||!data.phones.length||!data.profession){
      const target=layer.querySelector('[data-profile-error]');
      if(target)target.textContent='Имя, телефон и профессия обязательны.';
      return false;
    }
    if(saveButton)saveButton.disabled=true;
    try{
      await saveProfileData(data);
      onSaved?.();
      return true;
    }catch(error){
      if(saveButton)saveButton.disabled=false;
      const target=layer.querySelector('[data-profile-error]');
      if(target)target.textContent=error instanceof Error?error.message:'Не удалось сохранить профиль';
      else showProfileError(error instanceof Error?error.message:'Не удалось сохранить профиль');
      return false;
    }
  };

  form?.addEventListener('submit',async e=>{e.preventDefault();await save()});
  syncDirty();
}

function openProfileData(root,navigateBack,options={}){
  const p=getProfile();
  const layer=mountV2ZLayer(root,v2ZLayer(page([
    profileContext(p,'Данные профиля'),
    profileDataForm(p,options)
  ]),{className:'v2-profile-data-layer'}));
  if(!layer)return;
  layer.querySelector('[data-profile-settings]')?.addEventListener('click',()=>openProfileSettings(root,navigateBack,options));
  bindProfileData(layer,p,options,()=>{
    layer.v2Close?.();
    renderProfile(root,navigateBack,options);
  });
}

export function openProfileAppearanceQ(root,{onSaved=null,navigateBack=()=>{},options={}}={}){
  const typeOptions=[
    {value:'profile',label:'Профиль'},
    {value:'workplace',label:'Рабочее пространство'},
  ];
  const workplaces=()=>getWorkplaces();
  return openEntityCardAppearanceQ(root,{
    title:'Вид',
    typeLabel:'Тип карты',
    typeOptions,
    initialType:'profile',
    targetLabel:'Рабочее пространство',
    initialTarget:'all',
    targetOptions:(type)=>type==='workplace'
      ? [{value:'all',label:'Все рабочие пространства'},...workplaces().map((item)=>({value:item.key,label:item.name||'Рабочее пространство'}))]
      : [],
    resolve:(type,target)=>{
      const p=getProfile();
      const values=workplaces();
      if(type==='profile'){
        return {
          appearance:profileCardAppearance(p),
          fields:profileCardFields(p,values),
          photo:p.photo||'',
          photoPosition:avatarPosition(p),
        };
      }
      const template=getCardAppearanceTemplate('workplace');
      const sample=target==='all'
        ? (values[0]||{name:'Рабочее пространство',photo:'',photoCropX:50,photoCropY:50,cardAppearance:{}})
        : (values.find((item)=>item.key===target)||values[0]||{name:'Рабочее пространство',photo:'',photoCropX:50,photoCropY:50,cardAppearance:{}});
      return {
        appearance:target==='all' && template?.appearance ? template.appearance : workplaceCardAppearance(sample),
        fields:workplaceCardFields(sample,p),
        photo:target==='all' ? String(template?.photo||sample.photo||'') : workplaceCardPhoto(sample),
        photoPosition:target==='all' ? String(template?.photoPosition||'50% 50%') : `${crop(sample.photoCropX)}% ${crop(sample.photoCropY)}%`,
      };
    },
    save:async({type,target,appearance,photo,editor})=>{
      if(type==='profile'){
        const current=getProfile();
        await saveProfileData({...current,photo,cardAppearance:appearance});
        return;
      }
      if(target==='all'){
        saveCardAppearanceTemplate('workplace',{
          appearance,
          photo,
          photoPosition:editor?.photoPosition||'50% 50%',
        });
        const values=workplaces().map((item)=>({...item,cardAppearance:{}}));
        if(values.length)await saveWorkplaces(values);
        return;
      }
      const current=workplaces().find((item)=>item.key===target);
      if(!current)return;
      await upsertWorkplace({...current,photo,cardAppearance:appearance});
    },
    onSaved:()=>{if(typeof onSaved==='function')onSaved();else renderProfile(root,navigateBack,options)},
  });
}

function openProfileSettings(root,navigateBack,options={}){
  const p=getProfile();
  const access=getBookAccess();
  const commercialActions=access?.commercialMode==='DEMO'?[
    {id:'demo-status',label:demoRemainingText(access),disabled:true},
    {
      id:'live-request',
      label:access.liveRequestedAt?'Запрос LIVE отправлен':'Запросить LIVE',
      disabled:Boolean(access.liveRequestedAt),
      onSelect:async()=>{
        try{
          await requestLiveMode();
          await loadBookAccess();
        }catch(error){
          showProfileError(error instanceof Error?error.message:'Не удалось отправить запрос LIVE');
        }
      },
    },
  ]:access?.commercialMode==='LIVE'?[
    {
      id:'live-tools',
      label:'LIVE · инструменты',
      onSelect:async()=>{
        try{
          await requestLiveMode({manage:true});
          await loadBookAccess();
        }catch(error){
          showProfileError(error instanceof Error?error.message:'Не удалось открыть инструменты LIVE');
        }
      },
    },
  ]:[];
  return openSharedProfileSettingsMenu({
    actions:[
      ...commercialActions,
      {id:'appearance',label:'Вид',onSelect:()=>openProfileAppearanceQ(root,{navigateBack,options})},
      {id:'password',label:'Изменить пароль',onSelect:()=>openSharedPasswordAction({onSubmit:({currentPassword,newPassword})=>changePassword(currentPassword,newPassword)})},
      {id:'controls',label:'Согласия / Уведомления',onSelect:()=>import('./account-controls.js').then(({openAccountControlsModal})=>openAccountControlsModal())},
      {id:'logout',label:'Выход',variant:'danger',onSelect:()=>logout()},
    ],
  });
}

function openWorkplaceZ2(root,existing,navigateBack,options={}){
  const current=existing||{name:'',photo:'',photoCropX:50,photoCropY:50};
  const title=existing?.name||'Новое рабочее пространство';
  const layer=mountV2ZLayer(root,v2ZLayer(page([
    workspaceHeaderContext({
      title,
      a:{
        kind:'avatar',
        image:current.photo||'',
        imagePosition:`${crop(current.photoCropX)}% ${crop(current.photoCropY)}%`,
        initials:(current.name||'?').slice(0,1).toUpperCase(),
      },
      v:{data:'data-workplace-settings',aria:'Настройки пространства'},
    }),
    workplaceForm(existing,{sourceOnly:true})
  ]),{className:'v2-workplace-data-layer'}));
  if(!layer)return;
  const closeAndRender=()=>{
    layer.v2Close?.();
    renderProfile(root,navigateBack,options);
  };
  layer.querySelector('[data-workplace-settings]')?.addEventListener('click',()=>openWorkplaceSettingsMenu(layer,existing,{onDeleted:closeAndRender}));
  bindWorkplaceForm(layer,existing,{
    onSaved:closeAndRender,
    onDeleted:closeAndRender,
  });
}

function openWorkplace(root,existing,navigateBack,options={}){
  const workplaceLimit=getBookLimit('workplaces.max');
  if(!existing&&workplaceLimit!==null&&getWorkplaces().length>=workplaceLimit){
    openWorkplaceLimitModal(root,workplaceLimit);
    return;
  }
  openWorkplaceZ2(root,existing,navigateBack,options);
}

function rootAddSource(){
  return workplaceAddButton({
    label:'+',
    className:'v2-primary-source-only',
    variant:'',
    data:'data-add-workplace data-v2-primary-action data-v2-primary-label="+"',
  });
}

function renderProfile(root,navigateBack,options={}){
  const p=getProfile();
  const workplacesAllowed=canUseBookCapability('workplaces.access');
  root.innerHTML=page([
    profileContext(p),
    profileCard(p),
    workplacesAllowed?v2Section('Рабочие пространства',workplaceRail()):'',
    workplacesAllowed?rootAddSource():''
  ]);
  root.querySelector('[data-profile-settings]')?.addEventListener('click',()=>openProfileSettings(root,navigateBack,options));
  root.querySelector('[data-profile-card]')?.addEventListener('click',()=>openProfileData(root,navigateBack,options));
  root.querySelector('[data-add-workplace]')?.addEventListener('click',()=>openWorkplace(root,null,navigateBack,options));
  root.querySelectorAll('[data-workplace]').forEach(el=>el.addEventListener('click',()=>openWorkplace(root,getWorkplaces().find(w=>w.key===el.dataset.workplace)||null,navigateBack,options)));
}
