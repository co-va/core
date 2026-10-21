import { normalizeEntityCardAppearance } from '../../ui/ui.js';
import { getCardAppearanceTemplate } from '../../core/card-appearance-templates.js';

function firstOf(value, key) {
  return String(Array.isArray(value?.[key]) ? (value[key][0] || '') : '');
}

function phoneOf(value = {}) {
  return String(value?.phones?.[0] || value?.phone || '');
}

function emailOf(value = {}) {
  return firstOf(value,'emails');
}

function telegramOf(value = {}) {
  return firstOf(value,'telegrams');
}

function unreadOf(profile = {}) {
  const tenantId = String(profile?.tenantId || '').trim();
  const globalUnread = typeof globalThis !== 'undefined'
    ? globalThis.__VA_TOOLS_ACCOUNT_UNREAD__?.byTenant?.[tenantId]
    : null;
  const count = Math.max(0, Math.trunc(Number(globalUnread ?? profile?.unreadCount ?? 0) || 0));
  return count > 0 ? `Новых: ${count > 99 ? '99+' : count}` : '';
}

function defaultLines(entries = []) {
  const lines=Array.from({length:9},()=>({field:'',zone:'full',align:'left',size:'m',color:'white',bold:false,italic:false,underline:false,uppercase:false}));
  entries.forEach(({row,field,zone='full',align='left',size='m',color='white',bold=false,italic=false,underline=false,uppercase=false})=>{
    const index=Math.max(0,Math.min(8,Number(row)-1));
    lines[index]={field,zone,align,size,color,bold,italic,underline,uppercase};
  });
  return lines;
}

function hasConfiguredLines(value = {}) {
  return Array.isArray(value?.lines) && value.lines.some((line)=>String(line?.field||'').trim());
}

export function profileCardFields(profile = {}, workplaces = []) {
  const supplied=Array.isArray(workplaces)?workplaces:[];
  const values=supplied.length?supplied:(Array.isArray(profile?.workplaces)?profile.workplaces:[]);
  const first=values[0]||{};
  return [
    {value:'unread',label:'Непрочитанное',text:unreadOf(profile)},
    {value:'workTime',label:'График',text:first.from||first.to?`${first.from||'—'} - ${first.to||'—'}`:''},
    {value:'workplaceName',label:'Рабочее пространство',text:first.name||''},
    {value:'name',label:'Имя и фамилия',text:[profile.name,profile.surname].filter(Boolean).join(' ')},
    {value:'firstName',label:'Имя',text:profile.name||''},
    {value:'surname',label:'Фамилия',text:profile.surname||''},
    {value:'profession',label:'Профессия',text:profile.profession||''},
    {value:'phone',label:'Телефон',text:phoneOf(profile)},
    {value:'email',label:'Email',text:emailOf(profile)},
    {value:'telegram',label:'Telegram',text:telegramOf(profile)},
    {value:'experience',label:'Опыт',text:profile.experience||''},
    {value:'about',label:'О себе',text:profile.about||''},
    {value:'professionAbout',label:'О профессии',text:profile.professionAbout||''},
    {value:'workplaceCount',label:'Количество пространств',text:String(values.length||'')},
  ];
}

export function workplaceCardFields(workplace = {}, profile = {}) {
  return [
    {value:'workTime',label:'График',text:workplace.from||workplace.to?`${workplace.from||'—'} - ${workplace.to||'—'}`:''},
    {value:'workplaceName',label:'Рабочее пространство',text:workplace.name||''},
    {value:'city',label:'Город',text:workplace.city||''},
    {value:'address',label:'Адрес',text:workplace.address||''},
    {value:'workplacePhone',label:'Телефон пространства',text:workplace.phone||''},
    {value:'currency',label:'Валюта',text:workplace.currency||''},
    {value:'workplaceAbout',label:'О рабочем пространстве',text:workplace.about||''},
    {value:'profileName',label:'Имя и фамилия',text:[profile.name,profile.surname].filter(Boolean).join(' ')},
    {value:'profileFirstName',label:'Имя',text:profile.name||''},
    {value:'profileSurname',label:'Фамилия',text:profile.surname||''},
    {value:'profession',label:'Профессия',text:profile.profession||''},
    {value:'profilePhone',label:'Телефон профиля',text:phoneOf(profile)},
    {value:'profileEmail',label:'Email',text:emailOf(profile)},
    {value:'profileTelegram',label:'Telegram',text:telegramOf(profile)},
    {value:'profileExperience',label:'Опыт',text:profile.experience||''},
    {value:'profileAbout',label:'О себе',text:profile.about||''},
    {value:'profileProfessionAbout',label:'О профессии',text:profile.professionAbout||''},
  ];
}

export function profileCardAppearance(profile = {}) {
  if(hasConfiguredLines(profile.cardAppearance)) return normalizeEntityCardAppearance(profile.cardAppearance);
  return normalizeEntityCardAppearance({
    lines:defaultLines([
      {row:1,field:'unread',zone:'left',align:'left',size:'m'},
      {row:1,field:'workTime',zone:'right',align:'right',size:'m'},
      {row:2,field:'workplaceName',zone:'right',align:'right',size:'m'},
      {row:7,field:'name',zone:'full',align:'left',size:'l',bold:true},
      {row:8,field:'profession',zone:'full',align:'left',size:'m'},
      {row:9,field:'phone',zone:'full',align:'left',size:'m'},
    ]),
  });
}

export function workplaceCardAppearance(workplace = {}) {
  if(hasConfiguredLines(workplace.cardAppearance)) return normalizeEntityCardAppearance(workplace.cardAppearance);
  const template=getCardAppearanceTemplate('workplace');
  if(hasConfiguredLines(template?.appearance)) return normalizeEntityCardAppearance(template.appearance);
  return normalizeEntityCardAppearance({
    lines:defaultLines([
      {row:1,field:'workTime',zone:'right',align:'right',size:'m'},
      {row:2,field:'workplaceName',zone:'right',align:'right',size:'m'},
      {row:7,field:'profileName',zone:'full',align:'left',size:'l',bold:true},
      {row:8,field:'profession',zone:'full',align:'left',size:'m'},
      {row:9,field:'profilePhone',zone:'full',align:'left',size:'m'},
    ]),
  });
}

export function workplaceCardPhoto(workplace = {}) {
  return String(workplace.photo || getCardAppearanceTemplate('workplace')?.photo || '');
}
