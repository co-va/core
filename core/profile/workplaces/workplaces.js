import { actionBlock, button, collectLinks, colorPicker, escapeHtml, field, initColorPickers, initLinks, initPhotoField, initTimePickers, links, mountModal, mountV2ZLayer, modal, openColorPickerAction, openSharedProfileSettingsMenu, openTimeRangeAction, page, phoneField, photoField, select, setSharedProfilePrimary, textareaField, timePicker, v2ZLayer, workspaceHeaderContext } from '../../../ui/ui.js';
import { getProfile } from '../data.js';
import { deleteWorkplace as deleteWorkplaceData, getWorkplaceReferenceData, getWorkplaces, upsertWorkplace } from './data.js';

function workplaceDefaults(){
  return getWorkplaceReferenceData().defaults||{};
}

function emptyWorkplace(){
  const defaults=workplaceDefaults();
  return {
    photo:'',photoCropX:50,photoCropY:50,name:'',color:'',city:'',address:'',phone:'',
    currency:defaults.currency||'',
    timeZone:defaults.timeZone||'',
    from:defaults.from||'',
    to:defaults.to||'',
    links:[],about:'',cardAppearance:{},visibleInPublicBooking:true,
  };
}

export function workplaceForm(existing=null,{sourceOnly=false,bodyActions=false}={}){
  const reference=getWorkplaceReferenceData();
  const defaults=reference.defaults||{};
  const w=existing||emptyWorkplace();
  const cities=[...new Set([w.city,...(reference.cities||[])].filter(Boolean))];
  const currencies=(reference.currencies||[]).length
    ? reference.currencies
    : (w.currency?[{value:w.currency,label:w.currency}]:[]);
  const primary=sourceOnly
    ? actionBlock(button('Сохранить',{
        type:'submit',
        data:`data-workplace-primary data-v2-primary-label="Сохранить" data-v2-primary-visible="${existing?'false':'true'}"`,
        aria:'Сохранить',
      }))
    : '';
  const body=bodyActions
    ? actionBlock(`${button('Сохранить',{type:'submit'})}${existing?button('Удалить',{variant:'danger',data:'data-delete-workplace-form'}):''}`)
    : '';
  const settingsFields=bodyActions
    ? `${photoField({
        name:'workplacePhoto',
        value:w.photo||'',
        cropX:w.photoCropX,
        cropY:w.photoCropY,
        cropXName:'workplacePhotoCropX',
        cropYName:'workplacePhotoCropY',
      })}
      ${colorPicker({name:'workplaceColor',value:w.color||'',required:true})}
      <div class="work-time-row"><span class="work-time-row__label">График работы</span><div class="work-time-row__fields">${timePicker({label:'С',name:'workplaceFrom',value:w.from||defaults.from||''})}${timePicker({label:'До',name:'workplaceTo',value:w.to||defaults.to||''})}</div></div>`
    : `<input type="hidden" name="workplacePhoto" value="${escapeHtml(w.photo||'')}">
      <input type="hidden" name="workplacePhotoCropX" value="${Number(w.photoCropX||50)}">
      <input type="hidden" name="workplacePhotoCropY" value="${Number(w.photoCropY||50)}">
      <input type="hidden" name="workplaceColor" value="${escapeHtml(w.color||'')}">
      <input type="hidden" name="workplaceFrom" value="${escapeHtml(w.from||defaults.from||'')}">
      <input type="hidden" name="workplaceTo" value="${escapeHtml(w.to||defaults.to||'')}">`;
  return `<form class="compact-form workplace-form" data-workplace-form>
    <input type="hidden" name="workplaceCardAppearance" value="${escapeHtml(JSON.stringify(w.cardAppearance||{}))}">
    <input type="hidden" name="visibleInPublicBooking" value="${w.visibleInPublicBooking===false?'false':'true'}">
    ${settingsFields}
    ${field({label:'Название',name:'workplaceName',value:w.name,placeholder:'Название рабочего пространства',required:true})}
    ${select({label:'Город *',name:'workplaceCity',value:w.city||'',options:cities,placeholder:'Город',searchable:true,allowCustom:false})}
    ${field({label:'Адрес',name:'workplaceAddress',value:w.address,placeholder:'Адрес'})}
    ${phoneField({label:'Телефон',name:'workplacePhone',value:w.phone||''})}
    ${select({label:'Валюта',name:'workplaceCurrency',value:w.currency||defaults.currency||'',options:currencies})}
    <div class="array-group"><span class="array-label">Ссылки</span>${links({links:w.links||[],name:'workplace-links'})}</div>
    ${textareaField({label:'О рабочем пространстве',name:'workplaceAbout',value:w.about||'',placeholder:'Коротко о рабочем пространстве'})}
    <div class="form-error" data-workplace-error></div>
    ${primary}
    ${body}
  </form>`;
}
function formSnapshot(form){
  if(!form)return '';
  return JSON.stringify([...new FormData(form).entries()].map(([key,value])=>[key,typeof value==='string'?value:'']));
}

function parseCardAppearance(value){
  try{
    const parsed=JSON.parse(String(value||'{}'));
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};
  }catch{return {}}
}

function collectWorkplaceForm(root,existing){
  const form=root.querySelector('[data-workplace-form]');
  const data=new FormData(form);
  const name=String(data.get('workplaceName')||'').trim();
  const city=String(data.get('workplaceCity')||'').trim();
  const color=String(data.get('workplaceColor')||'').trim();
  const profile=getProfile();
  return {
    valid:Boolean(name&&city&&color),
    item:{
      key:existing?.key||crypto.randomUUID(),
      profileId:profile.key,
      photo:String(data.get('workplacePhoto')||''),
      photoCropX:Number(data.get('workplacePhotoCropX')||50),
      photoCropY:Number(data.get('workplacePhotoCropY')||50),
      name,
      color,
      city,
      address:String(data.get('workplaceAddress')||'').trim(),
      phone:String(data.get('workplacePhone')||'').trim(),
      currency:String(data.get('workplaceCurrency')||workplaceDefaults().currency||''),
      from:String(data.get('workplaceFrom')||''),
      to:String(data.get('workplaceTo')||''),
      links:collectLinks(root,'workplace-links'),
      about:String(data.get('workplaceAbout')||'').trim(),
      cardAppearance:parseCardAppearance(data.get('workplaceCardAppearance')),
      visibleInPublicBooking:String(data.get('visibleInPublicBooking')||'true')!=='false',
      createdAt:existing?.createdAt||new Date().toISOString(),
      updatedAt:new Date().toISOString(),
    },
  };
}

async function saveWorkplace(root,existing,onDone){
  const {valid,item}=collectWorkplaceForm(root,existing);
  const error=root.querySelector('[data-workplace-error]');
  if(!valid){if(error)error.textContent='Название, город и цвет обязательны.';return false}
  try{
    const saved=await upsertWorkplace(item);
    if(error)error.textContent='';
    onDone?.(saved);
    return true;
  }catch(saveError){
    if(error)error.textContent=saveError instanceof Error?saveError.message:'Не удалось сохранить рабочее пространство';
    return false;
  }
}

export function bindWorkplaceForm(root,existing=null,{onSaved=()=>{},onDeleted=()=>{}}={}){
  const form=root.querySelector('[data-workplace-form]');
  if(!form)return ()=>{};
  if(root.querySelector('[data-photo-field]'))initPhotoField(root);
  if(root.querySelector('[data-color-picker]'))initColorPickers(root);
  if(root.querySelector('[data-time-picker]'))initTimePickers(root);
  initLinks(root);

  const primary=root.querySelector('[data-workplace-primary]');
  const primaryActions=primary?.closest('.modal-actions');
  const initial=formSnapshot(form);
  let dirty=!existing;

  const syncPrimary=()=>{
    if(!primary)return;
    setSharedProfilePrimary(primary,{visible:dirty,label:'Сохранить'});
    if(primaryActions)primaryActions.hidden=!dirty;
  };
  const syncDirty=()=>{
    dirty=!existing||formSnapshot(form)!==initial;
    syncPrimary();
  };

  form.addEventListener('input',syncDirty);
  form.addEventListener('change',syncDirty);
  form.addEventListener('submit',async(event)=>{
    event.preventDefault();
    if(primary)setSharedProfilePrimary(primary,{visible:true,label:'Сохранить',disabled:true});
    const saved=await saveWorkplace(root,existing,onSaved);
    if(!saved&&primary)setSharedProfilePrimary(primary,{visible:true,label:'Сохранить',disabled:false});
  });

  root.querySelector('[data-delete-workplace-form]')?.addEventListener('click',(event)=>{
    event.preventDefault();
    if(existing)confirmDeleteWorkplace(root,existing.key,onDeleted);
  });
  syncPrimary();

  return ()=>{
    form.removeEventListener('input',syncDirty);
    form.removeEventListener('change',syncDirty);
  };
}

function setWorkplaceDraft(root,name,value,{notify=true}={}){
  const input=root.querySelector(`[name="${CSS.escape(name)}"]`);
  if(!input)return;
  input.value=String(value??'');
  if(notify)input.dispatchEvent(new Event('change',{bubbles:true}));
}

function syncWorkplaceAvatar(root,photo){
  const source=root.querySelector('[data-workspace-context-action]');
  if(source){
    source.dataset.workspaceAImage=String(photo||'');
    source.dataset.workspaceAImagePosition='50% 50%';
    window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  }
}

function workplaceDraftFromForm(root,existing=null){
  const form=root.querySelector('[data-workplace-form]');
  if(!form)return existing||emptyWorkplace();
  const data=new FormData(form);
  return {
    ...(existing||emptyWorkplace()),
    name:String(data.get('workplaceName')||'').trim(),
    city:String(data.get('workplaceCity')||'').trim(),
    address:String(data.get('workplaceAddress')||'').trim(),
    phone:String(data.get('workplacePhone')||'').trim(),
    currency:String(data.get('workplaceCurrency')||workplaceDefaults().currency||''),
    from:String(data.get('workplaceFrom')||''),
    to:String(data.get('workplaceTo')||''),
    photo:String(data.get('workplacePhoto')||''),
    photoCropX:Number(data.get('workplacePhotoCropX')||50),
    photoCropY:Number(data.get('workplacePhotoCropY')||50),
    cardAppearance:parseCardAppearance(data.get('workplaceCardAppearance')),
    visibleInPublicBooking:String(data.get('visibleInPublicBooking')||'true')!=='false',
  };
}

export function openWorkplaceSettingsMenu(root,existing=null,{onDeleted=()=>{}}={}){
  const form=root.querySelector('[data-workplace-form]');
  if(!form)return null;
  const data=()=>new FormData(form);
  const currentVisibility=()=>String(data().get('visibleInPublicBooking')||'true')!=='false';
  const controls=[
    {
      id:'public-booking-visibility',
      label:'Показывать в общей онлайн-записи',
      checked:currentVisibility(),
      onToggle:async(checked)=>{
        const previous=currentVisibility();
        try{
          if(existing)await upsertWorkplace({...existing,visibleInPublicBooking:checked});
          setWorkplaceDraft(root,'visibleInPublicBooking',checked?'true':'false',{notify:!existing});
          return checked;
        }catch(error){
          setWorkplaceDraft(root,'visibleInPublicBooking',previous?'true':'false',{notify:false});
          throw error;
        }
      },
      onError:(error)=>{
        const target=root.querySelector('[data-workplace-error]');
        if(target)target.textContent=error instanceof Error?error.message:'Не удалось сохранить настройку онлайн-записи';
      },
    },
  ];
  const actions=[
    {
      id:'color',
      label:'Выбор цвета',
      onSelect:()=>openColorPickerAction({
        value:String(data().get('workplaceColor')||''),
        onSelect:(value)=>setWorkplaceDraft(root,'workplaceColor',value),
      }),
    },
    {
      id:'schedule',
      label:'График работы',
      onSelect:()=>openTimeRangeAction({
        from:String(data().get('workplaceFrom')||workplaceDefaults().from||''),
        to:String(data().get('workplaceTo')||workplaceDefaults().to||''),
        onSave:({from,to})=>{
          setWorkplaceDraft(root,'workplaceFrom',from);
          setWorkplaceDraft(root,'workplaceTo',to);
        },
      }),
    },
  ];
  if(existing){
    actions.push({
      id:'delete',
      label:'Удалить пространство',
      variant:'critical',
      onSelect:()=>confirmDeleteWorkplace(root,existing.key,onDeleted),
    });
  }
  return openSharedProfileSettingsMenu({
    title:'Настройки пространства',
    controls,
    actions,
    data:'data-workplace-settings-menu',
  });
}

export function openWorkplaceModal(root, existing = null, onDone = () => {}) {
  const html=workplaceForm(existing,{bodyActions:true});
  const m=mountModal(root,modal(html,{variant:'q',title:existing?'Рабочее пространство':'Новое рабочее пространство'}));
  if(!m)return null;
  bindWorkplaceForm(m,existing,{
    onSaved:()=>{m.v2Close?.();onDone();},
    onDeleted:()=>{m.v2Close?.();onDone();},
  });
  return m;
}

export function confirmDeleteWorkplace(root,key,onDeleted=()=>{}){
  const w=getWorkplaces().find(x=>x.key===key);if(!w)return;
  const m=mountModal(root,modal(`<div class="modal-title"><h2>Удалить пространство?</h2><p>${escapeHtml(w.name||'Рабочее пространство')} будет убрано из активных пространств. Исторические данные сохранятся.</p></div><div class="form-error" data-workplace-delete-error></div><div class="modal-actions">${button('Удалить',{variant:'danger',data:'data-confirm-delete-workplace'})}${button('Отмена',{variant:'secondary',data:'data-cancel-delete-workplace'})}</div>`,{variant:'x',title:'Удаление рабочего пространства'}));
  if(!m)return;
  m.querySelector('[data-cancel-delete-workplace]').onclick=()=>m.v2Close?.();
  m.querySelector('[data-confirm-delete-workplace]').onclick=async()=>{
    try{
      if(await deleteWorkplaceData(key)){m.v2Close?.();onDone();}else m.v2Close?.();
    }catch(deleteError){
      const error=m.querySelector('[data-workplace-delete-error]');
      if(error)error.textContent=deleteError instanceof Error?deleteError.message:'Не удалось удалить рабочее пространство';
    }
  };
}
