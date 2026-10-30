import { apiRequest } from '../../core/auth.js';
import { disablePlatformPush, enablePlatformPush, getPlatformPushState } from '../../core/platform-notices.js';
import { button, documentTile, documentTiles, emptyState, escapeHtml, field, modal, mountModal, openDocumentViewer, v2Section } from '../../ui/ui.js';
import { notificationSettings } from '../../ui/settings/index.js';

async function request(path, options = {}) {
  const response = await apiRequest(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось загрузить настройки');
  return payload;
}

function moment(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function consentCards(consents) {
  if (!consents.length) return emptyState('Согласий пока нет', 'Здесь появятся актуальные согласия вашей учётной записи.');
  return documentTiles(consents.map((item) => documentTile({
    title:item.title || 'Документ',
    version:item.displayVersion || item.currentVersion || item.eventVersion || '',
    openData:`data-account-consent-open="${escapeHtml(item.key)}"`,
    toggleData:`data-consent-toggle="${escapeHtml(item.key)}" data-active="${item.active ? 'true' : 'false'}"`,
    toggleChecked:Boolean(item.active),
    aria:`Открыть документ ${item.title || ''}`,
    toggleAria:`${item.active ? 'Отозвать' : 'Дать'} согласие: ${item.title || ''}`,
  })), { layout:'rail' });
}

function serviceMarkup(state, pushState) {
  const emailEnabled = state.serviceNotifications?.email !== false;
  const telegramAvailable = state.serviceNotifications?.telegramAvailable === true;
  const telegramEnabled = telegramAvailable && state.serviceNotifications?.telegram !== false;
  const pushSupported = Boolean(pushState?.supported && pushState?.enabled);
  const pushEnabled = Boolean(pushState?.subscribed);

  return notificationSettings([
    {
      label: 'Telegram',
      description: telegramAvailable ? 'Канал подключён.' : 'Канал платформенного аккаунта не подключён.',
      checked: telegramEnabled,
      disabled: !telegramAvailable,
      data: 'data-service-telegram',
    },
    {
      label: 'Email',
      description: 'Сервисные сообщения на email учётной записи.',
      checked: emailEnabled,
      data: 'data-service-email',
    },
    {
      label: 'Push',
      description: pushSupported ? 'Push-уведомления на этом устройстве.' : 'Push на этом устройстве сейчас недоступен.',
      checked: pushEnabled,
      disabled: !pushSupported,
      data: 'data-service-push',
    },
  ]);
}

function emailMarkup(emailState = {}) {
  const status = emailState.verified ? 'Email подтверждён.' : 'Email не подтверждён.';
  return `<div class="form-grid">
    ${field({ label: 'Email', name: 'platformAccountEmail', value: emailState.email || '', type: 'email', required: true, autocomplete: 'email', data: 'data-platform-account-email' })}
    <div class="muted" data-platform-account-email-status>${escapeHtml(status)}</div>
    ${button(emailState.verified ? 'Изменить email' : 'Подтвердить / изменить email', { type: 'button', variant: 'outline', data: 'data-platform-account-email-save' })}
  </div>`;
}

function openConsentDocument(item) {
  return openDocumentViewer({
    title:item.title || 'Документ',
    version:item.displayVersion || item.currentVersion || item.eventVersion || '',
    content:String(item?.documentText || '').trim(),
  });
}

async function renderPanelState(root,state,pushState=null,emailState={}){
  const consents=Array.isArray(state.consents)?state.consents:[];
  const push=pushState || await getPlatformPushState().catch(()=>({supported:false,enabled:false,subscribed:false}));
  root.innerHTML=`
    ${v2Section('Email',emailMarkup(emailState))}
    ${v2Section('Уведомления',serviceMarkup(state,push))}
    ${v2Section('Согласия',consentCards(consents))}
  `;

  root.querySelector('[data-platform-account-email-save]')?.addEventListener('click',async(event)=>{
    const control=event.currentTarget;
    const input=root.querySelector('[data-platform-account-email]');
    const status=root.querySelector('[data-platform-account-email-status]');
    const nextEmail=String(input?.value||'').trim().toLowerCase();
    if(!nextEmail){ if(status)status.textContent='Укажите email.'; return; }
    control.disabled=true;
    if(status)status.textContent='Отправляем письмо…';
    try{
      const current=String(emailState.email||'').trim().toLowerCase();
      if(nextEmail===current){
        if(emailState.verified){ if(status)status.textContent='Email уже подтверждён.'; return; }
        await request('/auth/email-verification/request',{method:'POST'});
      }else{
        await request('/auth/email-verification/change',{
          method:'POST',
          body:JSON.stringify({email:nextEmail}),
        });
      }
      if(status)status.textContent=`Письмо отправлено на ${nextEmail}. Email изменится только после подтверждения.`;
    }catch(error){
      if(status)status.textContent=error instanceof Error?error.message:'Не удалось отправить письмо';
    }finally{
      control.disabled=false;
    }
  });

  root.querySelectorAll('[data-account-consent-open]').forEach((control)=>{
    control.addEventListener('click',()=>{
      const item=consents.find((entry)=>entry.key===control.dataset.accountConsentOpen);
      if(item)openConsentDocument(item);
    });
  });

  root.querySelectorAll('[data-consent-toggle]').forEach((control)=>{
    control.addEventListener('click',async()=>{
      const key=control.dataset.consentToggle;
      const active=control.dataset.active==='true';
      control.disabled=true;
      try{
        const next=await request(`/profile/account-controls/consents/${encodeURIComponent(key)}`,{
          method:'PUT',
          body:JSON.stringify({active:!active}),
        });
        await renderPanelState(root,next,push,emailState);
      }catch(error){
        control.disabled=false;
        const status=root.querySelector('[data-controls-status]');
        if(status)status.textContent=error instanceof Error?error.message:'Не удалось изменить согласие';
      }
    });
  });

  root.querySelector('[data-service-email]')?.addEventListener('change',async(event)=>{
    const input=event.currentTarget;
    const status=root.querySelector('[data-controls-status]');
    input.disabled=true;
    if(status)status.textContent='Сохраняем…';
    try{
      const next=await request('/profile/account-controls/service-notifications',{
        method:'PUT',
        body:JSON.stringify({email:input.checked}),
      });
      input.checked=next.serviceNotifications?.email!==false;
      if(status)status.textContent='Сохранено.';
    }catch(error){
      input.checked=!input.checked;
      if(status)status.textContent=error instanceof Error?error.message:'Не удалось сохранить';
    }finally{
      input.disabled=false;
    }
  });

  root.querySelector('[data-service-push]')?.addEventListener('change',async(event)=>{
    const input=event.currentTarget;
    const status=root.querySelector('[data-controls-status]');
    input.disabled=true;
    if(status)status.textContent='Сохраняем…';
    try{
      const next=input.checked?await enablePlatformPush():await disablePlatformPush();
      input.checked=Boolean(next?.subscribed);
      input.disabled=!(next?.supported&&next?.enabled);
      if(status)status.textContent=input.checked?'Push включён.':'Push выключен.';
    }catch(error){
      input.checked=!input.checked;
      if(status)status.textContent=error instanceof Error?error.message:'Не удалось изменить Push';
    }finally{
      if(push?.supported&&push?.enabled)input.disabled=false;
    }
  });
}

export async function renderAccountControlsPanel(root){
  root.innerHTML=emptyState('Загрузка','Получаем актуальные состояния.');
  try{
    const [state,push,emailState]=await Promise.all([
      request('/profile/account-controls'),
      getPlatformPushState().catch(()=>({supported:false,enabled:false,subscribed:false})),
      request('/auth/email-verification/status').catch(()=>({email:'',verified:false})),
    ]);
    await renderPanelState(root,state,push,emailState);
  }catch(error){
    root.innerHTML=emptyState('Раздел недоступен',error instanceof Error?error.message:'Не удалось загрузить данные');
  }
}

export function openAccountControlsModal() {
  const layer = mountModal(document.body, modal('<div data-profile-account-controls-panel></div>', {
    variant: 'q',
    title: 'Согласия / Уведомления',
    className: 'modal--account-controls',
  }));
  const host = layer?.querySelector('[data-profile-account-controls-panel]');
  if (host) void renderAccountControlsPanel(host);
  return layer;
}
