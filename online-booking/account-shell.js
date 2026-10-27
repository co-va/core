import {
  accountErrorMessage,
  isAccountSystemError,
  getAccountChat,
  getAccountChatSettings,
  getAccountNotifications,
  getGlobalAccountRelationships,
  markAccountNotificationRead,
  sendAccountChatMessage,
  updateGlobalAccount,
  deleteGlobalAccount,
  deleteGlobalAccountRelationship,
  decideGlobalAccountInvestment,
} from '../core/account/index.js';
import { formatPhone } from '../core/phone/index.js';
import { projectRecordStatuses } from '../core/record/index.js';
import { disableWebPush, enableWebPush, getWebPushState } from '../core/notifications/web-push.js';
import {
  actionBlock,
  button,
  details,
  emptyState,
  entityCardRail,
  entityCardStack,
  entityVisualCard,
  normalizeEntityCardAppearance,
  miniCard,
  miniCardRail,
  escapeHtml,
  field,
  v2ListEntries,
  v2ListEntry,
  v2CardDeck,
  v2Header,
  v2V,
  setV2V,
  clearV2V,
  modal,
  openNotice,
  page,
  shortDateTime,
  v2Section,
  v2Shell,
  v2ZLayer,
  mountV2ZLayer,
  initV2Swipe,
  initV2WorkspaceInteraction,
  setV2DeckOpen,
  mountModal,
  openSharedPhotoAction,
  openSharedProfileSettingsMenu,
} from '../ui/ui.js';
import { mountChatList, mountChatThread } from '../core/chat/runtime.js';
import { notificationSettings, settingsPanel } from '../ui/settings/index.js';
import { readOnlyReceipt } from '../ui/receipt/index.js';
import { openAccountConsentSettings } from './consent-settings.js';
import { openAccountPasswordSettings } from './password-settings.js';
import { openAccountPersonalDataZ } from './personal-data.js';
import { profileCardAppearance, profileCardFields, workplaceCardAppearance, workplaceCardFields } from '../core/profile/card-presentation.js';
import {
  calculateInvestmentState,
  cashEntityCardAppearance,
  cashEntityCardFields,
  investmentRoleLabel,
  normalizeInvestmentTerms,
} from '../core/finance/index.js';
import { personalAccountVisualCard } from '../core/loyalty/personal-account/index.js';
import {
  depositCardAppearance,
  depositCardFields,
  depositCardPhoto,
  depositCardPhotoPosition,
} from '../core/loyalty/deposit/card-presentation.js';
import { getGlobalPersonalAccounts } from './personal-account-data.js';
import { getGlobalDeposits } from './deposit-data.js';
import { renderJournal } from '../journal/journal.js';
import { renderAccountCalendarIntegrations } from './calendar-integrations.js';

function money(value) {
  const number = Number(value || 0);
  return `${(Number.isFinite(number) ? number : 0).toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} ₽`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function requestProcedures(request = {}) {
  return Array.isArray(request.procedures) ? request.procedures : [];
}

function requestPricing(request = {}) {
  const finance = request.finance && typeof request.finance === 'object' ? request.finance : {};
  const subtotal = Math.max(0, Number(finance.serviceTotal || 0));
  const discountPercent = Math.max(0, Math.min(100, Number(finance.discountPercent || 0)));
  const discountAmount = Math.max(0, Number(finance.discountTotal || 0));
  const total = Math.max(0, Number(finance.planTotal || 0));
  return { subtotal, discountPercent, total, discountAmount };
}

function requestPayment(request = {}) {
  const payment = request.payment && typeof request.payment === 'object' ? request.payment : {};
  return {
    state: String(payment.state || 'unpaid'),
    paid: Math.max(0, Number(payment.paid || 0)),
    due: Math.max(0, Number(payment.due || 0)),
  };
}

function requestMoment(request = {}) {
  return `${String(request.date || '').slice(0, 10)}T${String(request.from || '00:00').padStart(5, '0')}`;
}

const ACTION_STATUS_LABELS = Object.freeze({
  booked: 'Записался',
  rescheduled: 'Перенёс',
  cancelled: 'Отменил',
});

const PAYMENT_STATUS_LABELS = Object.freeze({
  due: 'К оплате',
  paid: 'Оплачено',
  debt: 'Задолженность',
});

function requestStatuses(request = {}) {
  return projectRecordStatuses(request, request.history, requestPayment(request));
}

function actionStatus(request = {}) {
  const status = requestStatuses(request).action;
  return ACTION_STATUS_LABELS[status] || '';
}

function financeStatus(request = {}) {
  const payment = requestPayment(request);
  const status = requestStatuses(request).payment;
  return {
    label: PAYMENT_STATUS_LABELS[status] || '',
    extra: status === 'due' || status === 'debt' ? money(payment.due) : '',
  };
}

function workplaceName(state, request = {}) {
  const tenantId = String(request?.tenantId || state.tenantId || '');
  const relationship = (Array.isArray(state.relationships) ? state.relationships : [])
    .find((item) => String(item?.tenantId || '') === tenantId);
  const workplaces = Array.isArray(relationship?.context?.workplaces)
    ? relationship.context.workplaces
    : Array.isArray(state.context?.workplaces) ? state.context.workplaces : [];
  return workplaces.find((item) => String(item?.key || '') === String(request.workplaceId || ''))?.name
    || [relationship?.context?.profile?.name, relationship?.context?.profile?.surname].filter(Boolean).join(' ').trim()
    || 'Пространство';
}

function historyDetailBody(state, request) {
  const pricing = requestPricing(request);
  const payment = requestPayment(request);
  const totals = [
    { label: 'Стоимость', value: money(pricing.subtotal) },
    { label: 'Скидка', value: money(pricing.discountAmount) },
    { label: 'Оплачено', value: money(payment.paid), strong: true },
  ];
  const paymentStatus = requestStatuses(request).payment;
  if ((paymentStatus === 'due' || paymentStatus === 'debt') && payment.due > 0.009) {
    totals.push({ label: PAYMENT_STATUS_LABELS[paymentStatus], value: money(payment.due), strong: true });
  }
  return readOnlyReceipt({
    title: workplaceName(state, request),
    status: actionStatus(request),
    date: formatDate(request.date),
    time: request.from || '',
    items: requestProcedures(request).map((item) => ({ label: item?.name || 'Процедура', value: money(item?.cost || 0) })),
    totals,
  });
}

function notificationMessages(feed = {}) {
  return (Array.isArray(feed?.items) ? feed.items : []).map((item) => ({
    id: `notification:${item.id}`,
    direction: 'system',
    kind: 'system',
    body: [item.title, item.body].filter(Boolean).join('\n'),
    createdAt: item.createdAt,
    notificationId: item.id,
    unread: !item.read,
  }));
}

function messageTime(value) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

async function loadMessages(state, tenantId = state.tenantId) {
  const scopeTenantId = String(tenantId || '');
  const [messages, feed] = await Promise.all([
    getAccountChat(scopeTenantId).catch(() => []),
    getAccountNotifications(scopeTenantId).catch(() => ({ items: [], unreadCount: 0 })),
  ]);
  return [...(Array.isArray(messages) ? messages : []), ...notificationMessages(feed)]
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    .map((item) => ({ ...item, time: messageTime(item.createdAt) }));
}

function accountName(state) {
  const account = state.account || {};
  return [account.name, account.surname].filter(Boolean).join(' ').trim() || 'Профиль';
}

function accountPhoto(state) {
  const profile = state.account?.profileData && typeof state.account.profileData === 'object' ? state.account.profileData : {};
  return String(profile.photo || '');
}

const GLOBAL_ACCOUNT_ROOTS = Object.freeze([
  { id: 'profile', label: 'Профиль' },
  { id: 'journal', label: 'Журнал' },
  { id: 'contacts', label: 'Контакты' },
  { id: 'integrations', label: 'Интеграции' },
]);

function accountRootForTab(state) {
  if (state.accountTab === 'profile' || state.accountTab === 'profile-settings') return 'profile';
  if (state.accountTab === 'journal') return 'journal';
  if (state.accountTab === 'contacts' || state.accountTab === 'contact-detail') return 'contacts';
  if (state.accountTab === 'integrations') return 'integrations';
  return 'journal';
}

function accountDeck(state) {
  const fallback = accountRootForTab(state);
  if (!GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === state.accountDeckActive)) state.accountDeckActive = fallback;
  return v2CardDeck(GLOBAL_ACCOUNT_ROOTS, { axis: 'x', active: state.accountDeckActive, data: 'data-account-deck-item', level: 'f' });
}

function renderV2Shell(root, state, { header, body = '', deck = true, className = '', v = null } = {}) {
  const deckMarkup = deck ? accountDeck(state) : '';
  const eDeckMarkup = '';
  const vMarkup = v ? v2V(v) : '';
  let shell = root.querySelector(':scope > [data-v2-app]');
  const canReuseScene = Boolean(deck && shell?.querySelector('[data-v2-card-deck][data-v2-deck-level="f"]'));

  if (!canReuseScene) {
    root.v2WorkspaceInteractionDispose?.();
    root.v2WorkspaceInteractionDispose = null;
    root.innerHTML = v2Shell({
      header,
      body,
      deck: deckMarkup,
      eDeck: eDeckMarkup,
      deckOpen: Boolean(state.accountDeckOpen && deck),
      eOpen: Boolean(state.accountDeckOpen && state.accountEOpen && eDeckMarkup),
      zEnter: Boolean(state.accountZEnter),
      className,
      v: vMarkup,
    });
    shell = root.querySelector(':scope > [data-v2-app]');
  } else {
    const currentHeader = shell.querySelector(':scope > .v2-header');
    if (currentHeader) currentHeader.outerHTML = header;
    const z = shell.querySelector('[data-v2-front] > [data-v2-z]');
    if (z) z.innerHTML = body;
    const vHost = shell.querySelector(':scope > [data-v2-v-host]');
    if (vHost) { vHost.innerHTML = vMarkup; vHost.hidden = !vMarkup; }

    const feHost = shell.querySelector('[data-v2-fe]');
    const currentE = feHost?.querySelector('[data-v2-card-deck][data-v2-deck-level="e"]');
    const nextEIds = [...(eDeckMarkup.matchAll(/data-v2-card-item="([^"]+)"/g))].map((match) => match[1]).join('|');
    const currentEIds = [...(currentE?.querySelectorAll('[data-v2-card-item]') || [])]
      .map((card) => String(card.dataset.v2CardItem || '')).join('|');
    if (nextEIds !== currentEIds) {
      currentE?.remove();
      if (eDeckMarkup && feHost) feHost.insertAdjacentHTML('beforeend', eDeckMarkup);
    }

    setV2DeckOpen(shell, Boolean(state.accountDeckOpen));
    shell.classList.toggle('has-e-deck', Boolean(eDeckMarkup));
    shell.classList.toggle('is-e-open', Boolean(eDeckMarkup && state.accountDeckOpen && state.accountEOpen));
    shell.classList.toggle('is-z-entering', Boolean(state.accountZEnter && !state.accountDeckOpen));
    const preserved = ['v2-app', 'v2-app--with-deck'];
    String(className || '').split(/\s+/).filter(Boolean).forEach((name) => preserved.push(name));
    [...shell.classList].forEach((name) => {
      if (name.startsWith('v2-app--') && !preserved.includes(name) && name !== 'v2-app--with-deck') shell.classList.remove(name);
    });
    preserved.forEach((name) => shell.classList.add(name));
  }

  state.accountZEnter = false;
}

function bindWorkspaceInteraction(root, state, handlers, { bindZ = true, onZRight = null, onZLeft = null } = {}) {
  root.v2WorkspaceInteractionDispose?.();
  const fallbackF = accountRootForTab(state);
  const activeF = GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === state.accountDeckActive)
    ? state.accountDeckActive
    : fallbackF;
  state.accountDeckActive = activeF;
  const dispose = initV2WorkspaceInteraction(root, {
    activeId: activeF,
    deckOpen: state.accountDeckOpen,
    bindZ,
    onZRight,
    onZLeft,
    onDeckOpenChange: (open) => { state.accountDeckOpen = open; },
    onRootSelect: (id) => {
      if (!GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === id)) return;
      state.accountDeckActive = id;
      state.accountDeckOpen = false;
      state.accountZEnter = true;
      state.accountChatOpen = false;
      state.accountTab = id;
      void handlers.render();
    },
  });
  root.v2WorkspaceInteractionDispose = dispose;
  return () => { if (root.v2WorkspaceInteractionDispose === dispose) root.v2WorkspaceInteractionDispose = null; dispose?.(); };
}

async function openChatSettings(state) {
  const [pushState, chatSettings] = await Promise.all([
    getWebPushState(state.tenantId).catch(() => ({ supported: false, enabled: false, subscribed: false, permission: 'unsupported' })),
    getAccountChatSettings(state.tenantId).catch(() => ({ telegram: { linked: false, enabled: false, username: '' } })),
  ]);
  let push = pushState;
  const telegram = chatSettings?.telegram || { linked: false, enabled: false, username: '' };
  const render = () => settingsPanel([
    { type: 'toggle', label: 'Push', checked: Boolean(push.subscribed), data: 'data-chat-push', disabled: !push.supported || !push.enabled || push.permission === 'denied' },
    { label: telegram.linked ? `Telegram: ${telegram.username || 'подключён'}` : 'Telegram не подключён' },
    { label: 'Согласия', data: 'data-chat-consents' },
  ]);
  const layer = mountModal(document.body, modal(render(), { variant: 'q', title: 'Настройки чата' }));
  const redraw = () => {
    const panel = layer?.querySelector('.app-settings-panel');
    if (panel) panel.outerHTML = render();
    bind();
  };
  const bind = () => {
    layer?.querySelector('[data-chat-push]')?.addEventListener('click', async () => {
      push = push.subscribed ? await disableWebPush(state.tenantId) : await enableWebPush(state.tenantId);
      redraw();
    });
    layer?.querySelector('[data-chat-consents]')?.addEventListener('click', () => {
      layer.remove();
      void openAccountConsentSettings(state);
    });
  };
  bind();
}

function relationshipTitle(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [profile.name, profile.surname].filter(Boolean).join(' ').trim() || 'Профиль';
}

function relationshipCard(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  return entityVisualCard({
    appearance: profileCardAppearance(profile),
    fields: profileCardFields(profile, []),
    image: String(profile.photo || ''),
    imagePosition: `${Number(profile.photoCropX || 50)}% ${Number(profile.photoCropY || 50)}%`,
    interactive: true,
    data: `data-global-relationship="${escapeHtml(String(relationship.tenantId || ''))}"`,
    aria: `Открыть ${title}`,
  });
}

const ACCOUNT_PROFILE_CARD_APPEARANCE = normalizeEntityCardAppearance({
  lines: [
    {}, {}, {}, {}, {}, {},
    { field:'name', zone:'full', align:'left', size:'l', color:'white', bold:true },
    { field:'phone', zone:'full', align:'left', size:'m', color:'white' },
    {},
  ],
});

function profileSummary(state) {
  const account = state.account || {};
  const fullName = [account.name, account.surname].map((value) => String(value || '').trim()).filter(Boolean).join(' ') || 'Имя';
  const phone = formatPhone(account.phone || '') || String(account.phone || '') || '—';
  return entityVisualCard({
    appearance: ACCOUNT_PROFILE_CARD_APPEARANCE,
    fields: [
      { value:'name', label:'Имя и фамилия', text:fullName },
      { value:'phone', label:'Телефон', text:phone },
    ],
    image: accountPhoto(state),
    interactive: true,
    data: 'data-account-profile-card',
    aria: 'Редактировать личные данные',
  });
}

function bindGlobalRelationships(root, state, handlers) {
  root.querySelectorAll('[data-global-relationship]').forEach((node) => node.addEventListener('click', () => {
    const tenantId = String(node.dataset.globalRelationship || '');
    if (!tenantId) return;
    state.accountSelectedContactTenantId = tenantId;
    state.accountTab = 'contact-detail';
    state.accountDeckActive = 'contacts';
    state.accountDeckOpen = false;
    void handlers.render();
  }));
}

function bindGlobalChatButton(root, state, handlers) {
  root.querySelector('[data-account-open-chat-root]')?.addEventListener('click', () => {
    state.accountSelectedChatTenantId = '';
    state.accountTab = 'messages';
    state.accountDeckOpen = false;
    void handlers.render();
  });
}

function bindGlobalProfileSettingsEntry(root, state, handlers) {
  root.querySelector('[data-account-profile-settings]')?.addEventListener('click', () => {
    if (document.querySelector('[data-account-profile-settings-menu]')) return;
    openGlobalProfileSettingsMenu(state, handlers);
  });
}

function syncGlobalProfileHeader(root, state, handlers) {
  const current = root.querySelector('[data-v2-header]');
  if (!current) return;
  current.outerHTML = v2Header({
    a: {
      kind: 'avatar',
      label: accountName(state),
      image: accountPhoto(state),
    },
    b: accountName(state),
    d: { kind: 'chat', data: 'data-account-open-chat-root', aria: 'Чат' },
  });
  bindGlobalProfileSettingsEntry(root, state, handlers);
  bindGlobalChatButton(root, state, handlers);
}

function accountProfileData(state) {
  return state.account?.profileData && typeof state.account.profileData === 'object'
    ? state.account.profileData
    : {};
}

async function saveAccountPhoto(state, value) {
  const account = await updateGlobalAccount({
    profileData: {
      ...accountProfileData(state),
      photo: String(value || ''),
    },
  });
  state.account = account;
  return account;
}

function openAccountPhotoSettings(state, handlers) {
  return openSharedPhotoAction({
    photo:accountPhoto(state),
    onReplace:async(src)=>{
      await saveAccountPhoto(state,src);
      await handlers.render?.();
    },
    onDelete:async()=>{
      await saveAccountPhoto(state,'');
      await handlers.render?.();
    },
    onError:(error)=>openNotice({
      title:'Фото не сохранено',
      message:accountErrorMessage(error,'Не удалось изменить фото'),
      action:'Закрыть',
      variant:'technical',
    }),
  });
}

async function loadGlobalNotificationState(state, relationships = state.relationships) {
  const scopedRelationships = Array.isArray(relationships) ? relationships : [];
  const tenantIds = scopedRelationships.map((item) => String(item?.tenantId || '')).filter(Boolean);
  const [pushStates, chatStates] = await Promise.all([
    Promise.all(tenantIds.map((tenantId) => getWebPushState(tenantId).catch(() => ({
      tenantId,
      supported: false,
      enabled: false,
      subscribed: false,
      permission: 'unsupported',
    })))),
    Promise.all(tenantIds.map((tenantId) => getAccountChatSettings(tenantId).catch(() => ({
      telegram: { linked: false, enabled: false, username: '' },
    })))),
  ]);
  return { tenantIds, pushStates, chatStates };
}

async function openGlobalAccountControls(root, state, handlers, relationships = state.relationships) {
  const existing = root.querySelector('[data-account-controls-modal]');
  if (existing) return existing;

  const scopedRelationships = Array.isArray(relationships) ? relationships : [];
  const notificationState = await loadGlobalNotificationState(state, scopedRelationships);
  const pushSupported = notificationState.pushStates.some((item) => item?.supported && item?.enabled);
  const pushSubscribed = notificationState.pushStates.some((item) => item?.subscribed);
  const telegram = notificationState.chatStates.find((item) => item?.telegram?.linked)?.telegram || null;

  const representatives = scopedRelationships.length
    ? miniCardRail(scopedRelationships.map((relationship, index) => {
        const profile = relationship?.context?.profile || {};
        const title = relationshipTitle(relationship);
        return miniCard({
          title,
          subtitle: String(profile.profession || '').trim(),
          image: String(profile.photo || ''),
          initials: title.slice(0, 1).toUpperCase(),
          interactive: true,
          data: `data-account-consent-contact="${index}"`,
          aria: `Открыть согласия ${title}`,
          actionLabel: 'Согласия',
        });
      }))
    : emptyState('Контактов пока нет', 'Согласия появятся после связи с контактом.');

  const content = `<div data-account-controls-modal>
    ${v2Section('Уведомления', notificationSettings([
      {
        label: 'Telegram',
        description: telegram ? `Подключён ${telegram.username || ''}`.trim() : 'Канал не подключён.',
        checked: Boolean(telegram),
        disabled: true,
        data: 'data-account-notification-telegram',
      },
      {
        label: 'Email',
        description: state.account?.email ? `Сервисные сообщения на ${state.account.email}` : 'Email не указан.',
        checked: Boolean(state.account?.email),
        disabled: true,
        data: 'data-account-notification-email',
      },
      {
        label: 'Push',
        description: pushSupported ? 'Push-уведомления на этом устройстве.' : 'Push на этом устройстве сейчас недоступны.',
        checked: pushSubscribed,
        disabled: !pushSupported,
        data: 'data-account-notification-push',
      },
    ]))}
    ${v2Section('Согласия', representatives)}
  </div>`;

  const layer = mountModal(document.body, modal(content, {
    variant: 'q',
    title: 'Согласия / Уведомления',
    className: 'modal--account-controls',
  }));

  layer?.querySelector('[data-account-notification-push]')?.addEventListener('change', async (event) => {
    const control = event.currentTarget;
    control.disabled = true;
    const status = layer.querySelector('[data-notification-status]');
    if (status) status.textContent = 'Сохраняем…';
    try {
      if (control.checked) {
        for (const tenantId of notificationState.tenantIds) await enableWebPush(tenantId);
      } else {
        for (const tenantId of notificationState.tenantIds) await disableWebPush(tenantId);
      }
      if (status) status.textContent = 'Сохранено.';
    } catch (error) {
      control.checked = !control.checked;
      if (status) status.textContent = accountErrorMessage(error, 'Не удалось изменить Push');
    } finally {
      control.disabled = !pushSupported;
    }
  });

  layer?.querySelectorAll('[data-account-consent-contact]').forEach((node) => node.addEventListener('click', () => {
    const relationship = scopedRelationships[Number(node.dataset.accountConsentContact)];
    const tenantId = String(relationship?.tenantId || '');
    if (!tenantId) return;
    void openAccountConsentSettings(state, {
      tenantId,
      onChanged: () => {},
    });
  }));

  return layer;
}

function confirmDeleteAccount(state, handlers) {
  const content = `<div class="form-grid">
    <div class="muted">Все действующие согласия будут отозваны. Профиль станет недоступен, исторические данные сохранятся.</div>
    ${button('Удалить профиль', { variant: 'critical', data: 'data-account-delete-confirm' })}
    ${button('Отмена', { variant: 'outline', data: 'data-account-delete-cancel' })}
  </div>`;
  const layer = mountModal(document.body, modal(content, { variant: 'x', title: 'Удалить профиль' }));
  layer?.querySelector('[data-account-delete-cancel]')?.addEventListener('click', () => layer.v2Close?.());
  layer?.querySelector('[data-account-delete-confirm]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await deleteGlobalAccount();
      layer.v2Close?.();
      handlers.onLogout?.();
    } catch (error) {
      event.currentTarget.disabled = false;
      openNotice({
        title: 'Профиль не удалён',
        message: accountErrorMessage(error, 'Не удалось удалить профиль'),
        action: 'Закрыть',
        variant: 'technical',
      });
    }
  });
}

function openGlobalProfileSettingsMenu(state, handlers) {
  return openSharedProfileSettingsMenu({
    actions:[
      {id:'photo',label:'Фото',onSelect:()=>openAccountPhotoSettings(state,handlers)},
      {id:'password',label:'Изменить пароль',onSelect:()=>openAccountPasswordSettings(state)},
      {id:'controls',label:'Согласия / Уведомления',onSelect:()=>void openGlobalAccountControls(document.body,state,handlers)},
      {id:'logout',label:'Выход',variant:'danger',onSelect:()=>handlers.onLogout?.()},
      {id:'delete',label:'Удалить профиль',variant:'critical',onSelect:()=>confirmDeleteAccount(state,handlers)},
    ],
    data:'data-account-profile-settings-menu',
  });
}

async function renderGlobalMessages(root, state, handlers) {
  const relationships = Array.isArray(state.relationships) ? state.relationships : [];
  const selectedTenantId = String(state.accountSelectedChatTenantId || '');
  const selected = relationships.find((relationship) => String(relationship?.tenantId || '') === selectedTenantId) || null;

  const surface = ({ title, a, c, d, body }) => renderV2Shell(root, state, {
    header: v2Header({ a, b: title, c, d }),
    body,
    deck: false,
    className: selected ? 'v2-app--chat' : 'v2-app--chat-list',
  });

  if (!selected) {
    mountChatList(root, {
      title: 'Чат',
      threads: relationships,
      surface,
      onSettings: () => {
        state.accountTab = 'profile-settings';
        state.accountDeckActive = 'profile';
        void handlers.render();
      },
      onContacts: () => {
        state.accountTab = 'contacts';
        state.accountDeckActive = 'contacts';
        state.accountDeckOpen = false;
        void handlers.render();
      },
      onOpenThread: (relationship) => {
        state.accountSelectedChatTenantId = String(relationship?.tenantId || '');
        void handlers.render();
      },
      threadTitle: relationshipTitle,
      threadSubtitle: () => '',
      threadTime: () => '',
      emptyTitle: 'Диалогов пока нет',
      emptyText: 'После появления связи диалог будет доступен здесь.',
    });
    initV2Swipe(root, {
      onRight: () => {
        const returnRoot = GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === state.accountDeckActive)
          ? state.accountDeckActive
          : 'journal';
        state.accountTab = returnRoot;
        state.accountDeckOpen = true;
        state.accountDeckActive = returnRoot;
        void handlers.render();
      },
    });
    return;
  }

  const messages = await loadMessages(state, selectedTenantId);
  mountChatThread(root, {
    title: relationshipTitle(selected),
    messages,
    viewer: 'account',
    surface,
    onSettings: () => void openChatSettings({ ...state, tenantId: selectedTenantId }),
    onContacts: () => {
      state.accountSelectedChatTenantId = '';
      void handlers.render();
    },
    onSend: async ({ body, attachments }) => {
      await sendAccountChatMessage(selectedTenantId, body, attachments);
      await handlers.render();
    },
    sendErrorMessage: 'Не удалось отправить сообщение',
    onMessageOpen: ({ node, message }) => {
      if (!message?.notificationId || !message.unread) return;
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', 'Открыть уведомление');
      const openNotification = async () => {
        if (!message.unread) return;
        try {
          await markAccountNotificationRead(selectedTenantId, message.notificationId);
          message.unread = false;
          node.removeAttribute('tabindex');
          node.removeAttribute('role');
          node.removeAttribute('aria-label');
        } catch {}
      };
      node.addEventListener('click', () => void openNotification());
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        void openNotification();
      });
    },
  });
  initV2Swipe(root, {
    onRight: () => {
      state.accountSelectedChatTenantId = '';
      void handlers.render();
    },
  });
}

async function renderGlobalProfile(root, state, handlers) {
  const header = v2Header({
    a: { kind: 'avatar', label: accountName(state), image: accountPhoto(state) },
    b: accountName(state),
    d: { kind: 'chat', data: 'data-account-open-chat-root', aria: 'Чат' },
  });
  renderV2Shell(root, state, {
    header,
    v: { data: 'data-account-profile-settings', aria: 'Настройки профиля' },
    body: entityCardStack([profileSummary(state)]),
  });
  bindWorkspaceInteraction(root, state, handlers);
  bindGlobalProfileSettingsEntry(root, state, handlers);
  bindGlobalChatButton(root, state, handlers);

  root.querySelector('[data-account-profile-card]')?.addEventListener('click', () => {
    if (root.querySelector('.account-personal-data-z')) return;
    const editor = openAccountPersonalDataZ(root, state, {
      onDirtyChange: (dirty) => {
        if (editor) editor.dataset.accountDirty = dirty ? 'true' : 'false';
        syncGlobalProfileHeader(root, state, handlers);
      },
      onClosed: () => syncGlobalProfileHeader(root, state, handlers),
      onSaved: () => handlers.render?.(),
    });
    if (editor) editor.dataset.accountDirty = 'false';
    syncGlobalProfileHeader(root, state, handlers);
  });
}

async function renderGlobalIntegrations(root, state, handlers) {
  const header = v2Header({
    a: { kind: 'avatar', label: accountName(state), image: accountPhoto(state) },
    b: 'Интеграции',
    d: { kind: 'chat', data: 'data-account-open-chat-root', aria: 'Чат' },
  });
  renderV2Shell(root, state, {
    header,
    body: '<div data-account-calendar-integrations-root></div>',
  });
  bindWorkspaceInteraction(root, state, handlers);
  bindGlobalChatButton(root, state, handlers);
  const host = root.querySelector('[data-account-calendar-integrations-root]');
  if (host) await renderAccountCalendarIntegrations(host);
}

async function renderGlobalProfileSettings(root, state, handlers) {
  state.accountTab = 'profile';
  await renderGlobalProfile(root, state, handlers);
  openGlobalProfileSettingsMenu(state, handlers);
}

function accountInvestments(state, status = '') {
  const rows = [];
  for (const relationship of Array.isArray(state.relationships) ? state.relationships : []) {
    const investments = Array.isArray(relationship?.context?.investments)
      ? relationship.context.investments
      : [];
    for (const investment of investments) {
      const terms = normalizeInvestmentTerms(investment);
      if (status && terms.participantStatus !== status) continue;
      rows.push({
        tenantId: String(relationship?.tenantId || ''),
        relationship,
        investment,
        terms,
      });
    }
  }
  return rows;
}

function accountInvestmentCard(row) {
  const investment = row.investment;
  const state = calculateInvestmentState(investment, investment.movements || []);
  return entityVisualCard({
    appearance: cashEntityCardAppearance(investment, 'investment'),
    fields: cashEntityCardFields(investment, state.result, 'investment', '', {
      roleLabel: investmentRoleLabel('external'),
      balanceLabel: 'Результат',
      balanceValue: state.result,
    }),
    image: String(investment.photo || ''),
    interactive: true,
    data: `data-account-investment="${escapeHtml(row.tenantId)}:${escapeHtml(String(investment.id || ''))}"`,
    aria: `Открыть инвестицию ${String(investment.name || '')}`,
  });
}

function accountInvestmentProposalCard(row) {
  const investment = row.investment;
  const state = calculateInvestmentState(investment, investment.movements || []);
  return entityVisualCard({
    appearance: cashEntityCardAppearance(investment, 'investment'),
    fields: cashEntityCardFields(investment, state.result, 'investment', '', {
      roleLabel: investmentRoleLabel('external'),
      balanceLabel: 'Результат',
      balanceValue: state.result,
    }),
    image: String(investment.photo || ''),
    interactive: true,
    data: `data-account-investment-proposal="${escapeHtml(`${row.tenantId}:${investment.id}`)}"`,
    aria: `Открыть предложение ${String(investment.name || '')}`,
  });
}

function accountInvestmentSummary(investment) {
  const state = calculateInvestmentState(investment, investment.movements || []);
  const terms = normalizeInvestmentTerms(investment);
  const rows = [
    v2ListEntry({ title: 'Вложено', rightTop: money(state.contributed) }),
    v2ListEntry({ title: 'Возвращено капитала', rightTop: money(state.returnedCapital) }),
    v2ListEntry({ title: 'Получено дохода', rightTop: money(state.income) }),
    v2ListEntry({ title: 'Расходы', rightTop: money(state.expenses) }),
    v2ListEntry({ title: 'Текущая стоимость', rightTop: money(state.currentValue) }),
  ];
  if (['profit-share', 'revenue-share', 'fixed-return'].includes(terms.participationModel)) {
    rows.push(
      v2ListEntry({ title: 'Доход по условиям', rightTop: money(state.entitledIncome) }),
      v2ListEntry({ title: 'Осталось получить', rightTop: money(state.incomeDue) }),
    );
  }
  rows.push(
    v2ListEntry({ title: 'Результат', rightTop: money(state.result) }),
    v2ListEntry({ title: 'ROI', rightTop: state.roi == null ? '—' : `${Number(state.roi).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%` }),
    v2ListEntry({ title: 'Годовая доходность', rightTop: state.annualizedReturn == null ? '—' : `${Number(state.annualizedReturn).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%` }),
    v2ListEntry({ title: 'Окуплено', rightTop: state.paybackRatio == null ? '—' : `${Number(state.paybackRatio).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%` }),
  );
  if (state.paybackDate) rows.push(v2ListEntry({ title: 'Точка окупаемости', rightTop: formatDate(state.paybackDate) }));
  return v2ListEntries(rows);
}

function accountInvestmentTermsRows(row) {
  const terms = row.terms;
  const modelLabels = {
    returnable: 'Возвратная инвестиция',
    equity: 'Доля',
    'profit-share': 'Процент от прибыли',
    'revenue-share': 'Процент от выручки',
    'fixed-return': 'Фиксированная доходность',
    joint: 'Совместный проект',
    other: 'Другое',
  };
  const rows = [
    v2ListEntry({ title: 'Проект', rightTop: relationshipTitle(row.relationship) }),
    terms.objectName ? v2ListEntry({ title: 'Объект', rightTop: terms.objectName }) : '',
    v2ListEntry({ title: 'Условия участия', rightTop: modelLabels[terms.participationModel] || 'Инвестиция' }),
    terms.targetAmount > 0 ? v2ListEntry({ title: 'План вложения', rightTop: money(terms.targetAmount) }) : '',
    terms.sharePercent > 0 ? v2ListEntry({ title: 'Доля', rightTop: `${terms.sharePercent}%` }) : '',
    terms.returnPercent > 0 ? v2ListEntry({ title: 'Доходность / процент', rightTop: `${terms.returnPercent}%` }) : '',
  ].filter(Boolean);
  return v2ListEntries(rows);
}

function accountInvestmentHistory(investment = {}) {
  const movementTitles = {
    INVESTMENT_CONTRIBUTION: 'Вложение',
    INVESTMENT_CAPITAL_RETURN: 'Возврат капитала',
    INVESTMENT_INCOME: 'Доход',
    INVESTMENT_EXPENSE: 'Расход',
  };
  const eventTitles = {
    valuation: 'Изменение оценки',
    saving: 'Экономия',
    reinvestment: 'Реинвестирование',
    'project-profit': 'Прибыль проекта',
    'project-revenue': 'Выручка проекта',
  };
  const movements = (Array.isArray(investment.movements) ? investment.movements : [])
    .filter((item) => item?.operationStatus !== 'cancelled' && item?.economicType !== 'REVERSAL')
    .map((item) => ({
      title: movementTitles[String(item?.economicType || '')] || 'Финансовая операция',
      subtitle: String(item?.note || ''),
      amount: Math.max(0, Number(item?.amount ?? item?.total) || 0),
      moment: String(item?.occurredAt || ''),
    }));
  const events = (Array.isArray(investment.investmentEvents) ? investment.investmentEvents : [])
    .filter((item) => item && !item.deletedAt)
    .map((item) => ({
      title: eventTitles[String(item?.type || '')] || 'Событие инвестиции',
      subtitle: String(item?.note || ''),
      amount: Math.max(0, Number(item?.amount) || 0),
      moment: String(item?.occurredDate || item?.occurredAt || ''),
    }));
  const rows = [...movements, ...events]
    .filter((item) => item.moment)
    .sort((a, b) => b.moment.localeCompare(a.moment))
    .map((item) => v2ListEntry({
      title: item.title,
      subtitle: item.subtitle,
      rightTop: money(item.amount),
      rightBottom: formatDate(String(item.moment).slice(0, 10)),
    }));
  return rows.length ? v2ListEntries(rows) : emptyState('Операций пока нет', 'История инвестиции появится здесь.');
}

function mutateAccountInvestmentStatus(state, tenantId, investmentId, status) {
  const relationship = (Array.isArray(state.relationships) ? state.relationships : [])
    .find((item) => String(item?.tenantId || '') === String(tenantId || ''));
  const investment = (Array.isArray(relationship?.context?.investments) ? relationship.context.investments : [])
    .find((item) => String(item?.id || '') === String(investmentId || ''));
  if (!investment) return;
  investment.investmentTerms = {
    ...(investment.investmentTerms || {}),
    participantStatus: status,
    participantRespondedAt: new Date().toISOString(),
  };
}

function openAccountInvestmentProposal(state, handlers, row) {
  const content = `${v2Section('Условия', accountInvestmentTermsRows(row))}
    <div class="modal-actions">
      ${button('Принять', { data: 'data-account-investment-accept' })}
      ${button('Отклонить', { variant: 'danger', data: 'data-account-investment-decline' })}
    </div>`;
  const layer = mountModal(document.body, modal(content, {
    title: String(row.investment?.name || 'Инвестиция'),
    variant: 'x',
    surface: 'app',
  }));
  if (!layer) return null;

  const decide = async (decision) => {
    try {
      await decideGlobalAccountInvestment(row.tenantId, row.investment.id, decision);
      const relationships = await getGlobalAccountRelationships();
      state.relationships = Array.isArray(relationships) ? relationships : [];
      layer.v2Close?.();
      await handlers.render?.();
    } catch (error) {
      openNotice({ message: accountErrorMessage(error, 'Не удалось сохранить решение') });
    }
  };
  layer.querySelector('[data-account-investment-accept]')?.addEventListener('click', () => void decide('accepted'));
  layer.querySelector('[data-account-investment-decline]')?.addEventListener('click', () => void decide('declined'));
  return layer;
}

function openAccountInvestmentDetail(root, state, handlers, row, restoreHeader = null) {
  const investment = row.investment;
  const restore = typeof restoreHeader === 'function' ? restoreHeader : () => {};
  const layer = mountV2ZLayer(root, v2ZLayer(page([
    v2Section('Расчёт', accountInvestmentSummary(investment)),
    v2Section('История', accountInvestmentHistory(investment)),
    v2Section('Условия', accountInvestmentTermsRows(row)),
  ]), { className: 'account-investment-z' }), {
    stack: true,
    onClose: restore,
  });
  if (!layer) return null;
  setGlobalAccountHeader(root, v2Header({
    b: String(investment.name || 'Инвестиция'),
    d: { kind: 'chat', data: 'data-account-investment-chat', aria: 'Чат' },
  }));
  clearV2V(root);
  root.querySelector('[data-account-investment-chat]')?.addEventListener('click', () => {
    state.accountSelectedChatTenantId = row.tenantId;
    state.accountTab = 'messages';
    state.accountDeckOpen = false;
    void handlers.render?.();
  });
  return layer;
}

function bindAccountInvestments(scope, root, state, handlers, accepted, pending, restoreHeader = null) {
  scope.querySelectorAll('[data-account-investment]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = String(node.dataset.accountInvestment || '');
      const row = accepted.find((item) => `${item.tenantId}:${item.investment.id}` === key);
      if (row) openAccountInvestmentDetail(root, state, handlers, row, restoreHeader);
    });
  });
  scope.querySelectorAll('[data-account-investment-proposal]').forEach((node) => {
    node.addEventListener('click', () => {
      const key = String(node.dataset.accountInvestmentProposal || '');
      const row = pending.find((item) => `${item.tenantId}:${item.investment.id}` === key);
      if (row) openAccountInvestmentProposal(state, handlers, row);
    });
  });
}

function disposeGlobalAccountJournal(root) {
  root.accountJournalDispose?.();
  root.accountJournalDispose = null;
}

async function renderGlobalJournal(root, state, handlers) {
  disposeGlobalAccountJournal(root);
  const header = v2Header({
    a: { kind: 'avatar', label: accountName(state), image: accountPhoto(state) },
    b: 'Журнал',
    d: { kind: 'chat', data: 'data-account-open-chat-root', aria: 'Чат' },
  });
  renderV2Shell(root, state, {
    header,
    body: '<div data-account-journal-root></div>',
  });
  const journalRoot = root.querySelector('[data-account-journal-root]');
  if (journalRoot) {
    root.accountJournalDispose = renderJournal(journalRoot, {
      context: 'account',
      initialDate: state.accountJournalDate instanceof Date ? state.accountJournalDate : undefined,
      records: () => Array.isArray(state.accountRecords) ? state.accountRecords : [],
      resolveRecordContext: (record) => {
        const relationship = (Array.isArray(state.relationships) ? state.relationships : [])
          .find((item) => String(item?.tenantId || '') === String(record?.tenantId || '')) || null;
        const workplaces = Array.isArray(relationship?.context?.workplaces) ? relationship.context.workplaces : [];
        return {
          professional: relationship?.context?.profile || null,
          workplace: workplaces.find((item) => String(item?.key || item?.id || '') === String(record?.workplaceId || '')) || null,
        };
      },
    }) || null;
  }
  bindWorkspaceInteraction(root, state, handlers);
  bindGlobalChatButton(root, state, handlers);
}

function relationshipSearchText(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [
    relationshipTitle(relationship),
    profile.profession,
    profile.phone,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLocaleLowerCase('ru');
}

function contactsBody(relationships = [], query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  const filtered = needle
    ? relationships.filter((relationship) => relationshipSearchText(relationship).includes(needle))
    : relationships;
  if (!filtered.length) {
    return emptyState(needle ? 'Ничего не найдено' : 'Контактов пока нет', needle ? 'Измени запрос поиска.' : 'Новые контакты появятся здесь.');
  }
  return entityCardStack(filtered.map(relationshipCard));
}

async function renderGlobalContacts(root, state, handlers) {
  const relationships = Array.isArray(state.relationships) ? state.relationships : [];
  const searchable = relationships.length > 15;
  const header = v2Header({
    a: { kind: 'avatar', label: accountName(state), image: accountPhoto(state) },
    b: 'Контакты',
    d: { kind: 'chat', data: 'data-account-open-chat-root', aria: 'Чат' },
  });
  renderV2Shell(root, state, {
    header,
    v: { data: 'data-account-profile-settings', aria: 'Настройки контактов' },
    body: `${searchable ? field({ name: 'accountContactSearch', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'data-account-contact-search' }) : ''}<div data-account-contact-list>${contactsBody(relationships)}</div>`,
  });
  bindWorkspaceInteraction(root, state, handlers);
  bindGlobalProfileSettingsEntry(root, state, handlers);
  bindGlobalRelationships(root, state, handlers);
  bindGlobalChatButton(root, state, handlers);
  const search = root.querySelector('[data-account-contact-search]');
  search?.addEventListener('input', () => {
    const host = root.querySelector('[data-account-contact-list]');
    if (!host) return;
    host.innerHTML = contactsBody(relationships, search.value);
    bindGlobalRelationships(root, state, handlers);
  });
}

function selectedGlobalRelationship(state) {
  const tenantId = String(state.accountSelectedContactTenantId || '');
  return (Array.isArray(state.relationships) ? state.relationships : [])
    .find((relationship) => String(relationship?.tenantId || '') === tenantId) || null;
}

function globalContactRecords(state, tenantId) {
  return (Array.isArray(state.accountRecords) ? state.accountRecords : [])
    .filter((request) => String(request?.tenantId || '') === String(tenantId || ''));
}

function confirmDeleteGlobalContact(state, handlers, relationship) {
  const tenantId = String(relationship?.tenantId || '');
  const title = relationshipTitle(relationship);
  if (!tenantId) return;
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Удалить контакт?</h2><p>${escapeHtml(title)} будет убран из Контактов. Все действующие согласия будут отозваны. Исторические данные сохранятся.</p></div><div class="form-error" data-contact-delete-error></div><div class="modal-actions">${button('Удалить', { variant: 'danger', data: 'data-confirm-delete-contact' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-contact' })}</div>`, { variant: 'x', title: 'Удаление контакта' }));
  if (!layer) return;
  layer.querySelector('[data-cancel-delete-contact]')?.addEventListener('click', () => layer.v2Close?.());
  layer.querySelector('[data-confirm-delete-contact]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    try {
      await deleteGlobalAccountRelationship(tenantId);
      state.relationships = (Array.isArray(state.relationships) ? state.relationships : [])
        .filter((item) => String(item?.tenantId || '') !== tenantId);
      state.accountRecords = (Array.isArray(state.accountRecords) ? state.accountRecords : [])
        .filter((request) => String(request?.tenantId || '') !== tenantId);
      state.accountSelectedContactTenantId = '';
      state.accountSelectedChatTenantId = '';
      state.accountTab = 'contacts';
      state.accountDeckActive = 'contacts';
      layer.v2Close?.();
      await handlers.render?.();
    } catch (error) {
      event.currentTarget.disabled = false;
      const errorNode = layer.querySelector('[data-contact-delete-error]');
      if (errorNode) errorNode.textContent = accountErrorMessage(error, 'Не удалось удалить контакт');
    }
  });
}

function openGlobalContactSettings(state, handlers, relationship) {
  const tenantId = String(relationship?.tenantId || '');
  if (!tenantId) return null;
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'controls',
        label: 'Согласия / Уведомления',
        onSelect: () => void openGlobalAccountControls(document.body, state, handlers, [relationship]),
      },
      {
        id: 'delete',
        label: 'Удалить',
        variant: 'critical',
        onSelect: () => confirmDeleteGlobalContact(state, handlers, relationship),
      },
    ],
    data: 'data-global-contact-settings-menu',
  });
}

function contactHeaderMarkup(relationship) {
  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  return v2Header({
    a: { kind: 'avatar', label: title, image: String(profile.photo || '') },
    b: title,
    d: { kind: 'chat', data: 'data-global-contact-chat', aria: 'Чат' },
  });
}

function setGlobalAccountHeader(root, markup) {
  const header = root.querySelector('[data-v2-header]');
  if (header) header.outerHTML = markup;
}

function contactWorkplaces(relationship, records = []) {
  const interacted = new Set((Array.isArray(records) ? records : [])
    .map((request) => String(request?.workplaceId || request?.workplaceKey || '').trim())
    .filter(Boolean));
  return (Array.isArray(relationship?.context?.workplaces) ? relationship.context.workplaces : [])
    .filter((workplace) => interacted.has(String(workplace?.key || '').trim()));
}

function contactWorkplaceRail(relationship, records = []) {
  const profile = relationship?.context?.profile || {};
  const workplaces = contactWorkplaces(relationship, records);
  if (!workplaces.length) return '';
  return entityCardRail(workplaces.map((workplace) => entityVisualCard({
    appearance: workplaceCardAppearance(workplace),
    fields: workplaceCardFields(workplace, workplace.cardProfile || profile),
    image: String(workplace.photo || ''),
    imagePosition: `${Number(workplace.photoCropX || 50)}% ${Number(workplace.photoCropY || 50)}%`,
    interactive: true,
    data: `data-global-contact-workplace="${escapeHtml(String(workplace.key || ''))}"`,
    aria: `Открыть ${String(workplace.name || 'рабочее пространство')}`,
  })), { className: 'v2-profile-workplaces' });
}

function contactPersonalAccountCard(relationship, account) {
  return personalAccountVisualCard({
    title: relationshipTitle(relationship),
    balance: Math.max(0, Number(account?.balance || 0)),
    data: 'data-global-contact-personal-account',
    aria: 'Открыть Личный счёт',
  });
}

function contactDepositStatus(status = '') {
  if (status === 'expired') return 'Срок завершён';
  if (status === 'closed') return 'Закрыт';
  return 'Активен';
}

function contactDepositCard(deposit = {}) {
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  return entityVisualCard({
    appearance: depositCardAppearance(),
    fields: depositCardFields({
      uei: String(deposit?.person?.uei || ''),
      title: String(deposit?.programName || 'Депозит'),
      subtitle: String(terms.termRule || 'Бессрочно'),
      status: contactDepositStatus(deposit?.status),
      metaLeft: String(terms.benefit || 'Без дополнительной выгоды'),
      metaRight: money(deposit?.balance),
    }),
    image: depositCardPhoto(),
    imagePosition: depositCardPhotoPosition(),
    interactive: true,
    data: `data-global-contact-deposit="${escapeHtml(String(deposit?.depositId || ''))}"`,
    aria: `Открыть депозит ${String(deposit?.programName || '')}`,
  });
}

function contactDepositHistory(deposit = {}) {
  const labels = {
    'deposit-funding': 'Внесение',
    'deposit-benefit': 'Выгода',
    'deposit-benefit-reversal': 'Отмена выгоды',
    'deposit-withdrawal': 'Возврат остатка',
    payment: 'Использование при оплате',
    refund: 'Возврат оплаты',
  };
  const rows = (Array.isArray(deposit?.history) ? deposit.history : [])
    .slice()
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')))
    .map((movement) => v2ListEntry({
      title: labels[String(movement?.kind || '')] || 'Операция',
      subtitle: shortDateTime(movement?.occurredAt, '—'),
      rightTop: `${String(movement?.direction || '').toUpperCase() === 'IN' ? '+' : '−'}${money(movement?.amount)}`,
    }));
  return rows.length ? v2ListEntries(rows) : emptyState('Истории пока нет', 'Движения депозита появятся здесь.');
}

function openGlobalContactDepositLayer(root, state, handlers, relationship, deposit, restoreHeader) {
  const tenantId = String(relationship?.tenantId || '');
  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  const layer = mountV2ZLayer(root, v2ZLayer(page([
    details([
      { label: 'Депозит', value: String(deposit?.programName || 'Депозит') },
      { label: 'Остаток', value: money(deposit?.balance) },
      { label: 'Внесено', value: money(deposit?.fundedAmount) },
      { label: 'Срок', value: String(terms.termRule || 'Бессрочно') },
      { label: 'Состояние', value: contactDepositStatus(deposit?.status) },
    ]),
    v2Section('История', contactDepositHistory(deposit)),
  ]), { className: 'account-contact-deposit-z' }), {
    stack: true,
    onClose: () => restoreHeader?.(),
  });
  if (!layer) return null;
  setGlobalAccountHeader(root, v2Header({
    a: { kind: 'avatar', label: title, image: String(profile.photo || ''), disabled: true },
    b: String(deposit?.programName || 'Депозит'),
    d: { kind: 'chat', data: 'data-global-deposit-chat', aria: 'Чат' },
  }));
  clearV2V(root);
  root.querySelector('[data-global-deposit-chat]')?.addEventListener('click', () => {
    state.accountSelectedChatTenantId = tenantId;
    state.accountTab = 'messages';
    state.accountDeckOpen = false;
    void handlers.render();
  });
  return layer;
}

function contactPersonalAccountHistory(account = {}) {
  const labels = {
    funding: 'Пополнение',
    withdrawal: 'Возврат',
    payment: 'Оплата',
    'payment-refund': 'Возврат оплаты',
    refund: 'Возврат оплаты',
  };
  const rows = (Array.isArray(account?.movements) ? account.movements : [])
    .slice()
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')))
    .map((movement) => {
      const direction = String(movement?.direction || '').toUpperCase();
      return v2ListEntry({
        title: labels[String(movement?.kind || '')] || 'Операция',
        subtitle: shortDateTime(movement?.occurredAt, '—'),
        rightTop: `${direction === 'IN' ? '+' : '−'}${money(movement?.amount)}`,
        rightBottom: `Остаток ${money(movement?.balanceAfter)}`,
      });
    });
  return rows.length
    ? v2ListEntries(rows)
    : emptyState('Истории пока нет', 'Движения Личного счёта появятся здесь.');
}

function contactPersonalAccountDebts(account = {}) {
  const rows = (Array.isArray(account?.debts) ? account.debts : [])
    .slice()
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')))
    .map((debt) => {
      const open = String(debt?.status || '') !== 'closed' && Number(debt?.outstandingAmount || 0) > 0.009;
      return v2ListEntry({
        title: open ? 'Задолженность' : 'Задолженность погашена',
        subtitle: shortDateTime(debt?.occurredAt, '—'),
        rightTop: money(open ? debt?.outstandingAmount : debt?.originalAmount),
        rightBottom: open ? 'К оплате' : 'Погашено',
      });
    });
  return rows.length ? v2ListEntries(rows) : '';
}

function openGlobalContactPersonalAccountLayer(root, state, handlers, relationship, account, restoreHeader) {
  const tenantId = String(relationship?.tenantId || '');
  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  const limit = Math.max(0, Math.min(100, Number(account?.spendLimitPercent ?? 100)));
  const debts = contactPersonalAccountDebts(account);
  const body = page([
    details([
      { label: 'Личный счёт', value: money(account?.balance) },
      { label: 'Задолженность', value: money(account?.debtTotal) },
      { label: 'Оплата Личным счётом', value: limit >= 100 ? 'Без ограничений' : `До ${limit}%` },
    ]),
    v2Section('История', contactPersonalAccountHistory(account)),
    debts ? v2Section('Задолженность', debts) : '',
  ]);
  const layer = mountV2ZLayer(root, v2ZLayer(body, { className: 'account-contact-personal-account-z' }), {
    stack: true,
    onClose: () => restoreHeader?.(),
  });
  if (!layer) return null;
  setGlobalAccountHeader(root, v2Header({
    a: { kind: 'avatar', label: title, image: String(profile.photo || ''), disabled: true },
    b: 'Личный счёт',
    d: { kind: 'chat', data: 'data-global-personal-account-chat', aria: 'Чат' },
  }));
  clearV2V(root);
  root.querySelector('[data-global-personal-account-chat]')?.addEventListener('click', () => {
    state.accountSelectedChatTenantId = tenantId;
    state.accountTab = 'messages';
    state.accountDeckOpen = false;
    void handlers.render();
  });
  return layer;
}

function contactHistoryMiniCard(state, request, index, dataName = 'data-global-contact-history') {
  const procedures = requestProcedures(request).map((item) => String(item?.name || '').trim()).filter(Boolean);
  const pricing = requestPricing(request);
  return miniCard({
    title: workplaceName(state, request),
    value: procedures[0] || 'Запись',
    subtitle: [formatDate(request.date), request.from].filter(Boolean).join(' · '),
    rows: [
      { label: 'Сумма', value: money(pricing.total) },
    ],
    interactive: true,
    data: `${dataName}="${index}"`,
    aria: `Открыть запись ${formatDate(request.date)} ${request.from || ''}`,
  });
}

function contactHistoryRail(state, records = [], dataName = 'data-global-contact-history') {
  const rows = (Array.isArray(records) ? records : [])
    .slice()
    .sort((a, b) => requestMoment(b).localeCompare(requestMoment(a)));
  return rows.length
    ? miniCardRail(rows.map((request, index) => contactHistoryMiniCard(state, request, index, dataName)))
    : '';
}

function bindContactHeaderActions(root, state, handlers, relationship, {
  workplaceKey = '',
  repeatRequest = null,
  actionRoot = root,
} = {}) {
  const tenantId = String(relationship?.tenantId || '');
  root.querySelector('[data-global-contact-settings]')?.addEventListener('click', () => {
    openGlobalContactSettings(state, handlers, relationship);
  });
  actionRoot?.querySelector('[data-global-contact-booking]')?.addEventListener('click', () => {
    handlers.onStartBooking?.(tenantId, {
      workplaceKey: String(workplaceKey || ''),
      repeatRequest,
    });
  });
  root.querySelector('[data-global-contact-chat]')?.addEventListener('click', () => {
    state.accountSelectedChatTenantId = tenantId;
    state.accountTab = 'messages';
    state.accountDeckOpen = false;
    void handlers.render();
  });
}

function openGlobalContactHistoryLayer(root, state, handlers, relationship, request, restoreHeader) {
  const tenantId = String(relationship?.tenantId || '');
  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  const canRepeat = requestProcedures(request).length > 0;
  const body = `${historyDetailBody(state, request)}${canRepeat ? actionBlock(button('Повторить', {
    data: 'data-global-contact-booking',
    aria: 'Повторить процедуру',
  })) : ''}`;
  const layer = mountV2ZLayer(root, v2ZLayer(body, { className: 'account-contact-history-z' }), {
    stack: true,
    onClose: () => restoreHeader?.(),
  });
  if (!layer) return null;

  setGlobalAccountHeader(root, v2Header({
    a: { kind: 'avatar', label: title, image: String(profile.photo || '') },
    b: workplaceName(state, request),
    d: { kind: 'chat', data: 'data-global-contact-chat', aria: 'Чат' },
  }));
  setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });
  bindContactHeaderActions(root, state, handlers, relationship, { repeatRequest: request, actionRoot: layer });
  return layer;
}

function openGlobalContactWorkplaceLayer(root, state, handlers, relationship, workplace, records, restoreHeader) {
  const key = String(workplace?.key || '');
  if (!key) return null;
  const rows = (Array.isArray(records) ? records : [])
    .filter((request) => String(request?.workplaceId || request?.workplaceKey || '') === key)
    .sort((a, b) => requestMoment(b).localeCompare(requestMoment(a)));
  const history = rows.length
    ? v2Section('История', miniCardRail(rows.map((request, index) => contactHistoryMiniCard(state, request, index, 'data-global-workplace-history'))))
    : emptyState('История пока пустая', 'Записи этого пространства появятся здесь.');
  const body = `${history}${actionBlock(button('Записаться', {
    data: 'data-global-contact-booking',
    aria: 'Записаться',
  }))}`;
  const layer = mountV2ZLayer(root, v2ZLayer(body, { className: 'account-contact-workplace-z' }), {
    stack: true,
    onClose: () => restoreHeader?.(),
  });
  if (!layer) return null;

  const profile = relationship?.context?.profile || {};
  const title = relationshipTitle(relationship);
  const showHeader = () => {
    setGlobalAccountHeader(root, v2Header({
      a: { kind: 'avatar', label: title, image: String(profile.photo || '') },
      b: String(workplace.name || title),
      d: { kind: 'chat', data: 'data-global-contact-chat', aria: 'Чат' },
    }));
    setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });
    bindContactHeaderActions(root, state, handlers, relationship, { workplaceKey: key, actionRoot: layer });
  };
  showHeader();

  layer.querySelectorAll('[data-global-workplace-history]').forEach((node) => node.addEventListener('click', () => {
    const request = rows[Number(node.dataset.globalWorkplaceHistory)];
    if (!request) return;
    openGlobalContactHistoryLayer(root, state, handlers, relationship, request, showHeader);
  }));
  return layer;
}

async function renderGlobalContactDetail(root, state, handlers) {
  const relationship = selectedGlobalRelationship(state);
  if (!relationship) {
    state.accountTab = 'contacts';
    state.accountDeckActive = 'contacts';
    await handlers.render();
    return;
  }

  const tenantId = String(relationship.tenantId || '');
  const records = globalContactRecords(state, tenantId);
  const [personalAccounts, deposits] = await Promise.all([
    getGlobalPersonalAccounts().catch(() => []),
    getGlobalDeposits().catch(() => []),
  ]);
  const personalAccount = personalAccounts.find((item) => String(item?.tenantId || '') === tenantId) || null;
  const contactDeposits = deposits.filter((item) => String(item?.tenantId || '') === tenantId);
  await renderGlobalContacts(root, state, handlers);

  const workplaces = contactWorkplaceRail(relationship, records);
  const programCards = [
    personalAccount ? contactPersonalAccountCard(relationship, personalAccount) : '',
    ...contactDeposits.map(contactDepositCard),
  ].filter(Boolean);
  const programs = programCards.length ? entityCardRail(programCards) : '';
  const acceptedInvestments = accountInvestments(state, 'accepted').filter((item) => item.tenantId === tenantId);
  const pendingInvestments = accountInvestments(state, 'pending').filter((item) => item.tenantId === tenantId);
  const financeCards = [
    ...acceptedInvestments.map(accountInvestmentCard),
    ...pendingInvestments.map(accountInvestmentProposalCard),
  ];
  const finance = financeCards.length ? entityCardRail(financeCards) : '';
  const content = [
    workplaces ? v2Section('Пространства', workplaces) : '',
    programs ? v2Section('Программы', programs) : '',
    finance ? v2Section('Инвестиции / займы', finance) : '',
  ].filter(Boolean).join('') || emptyState('Профиль пока пустой', 'Данные взаимодействия появятся здесь.');
  const body = `${content}${actionBlock(button('Записаться', {
    data: 'data-global-contact-booking',
    aria: 'Записаться',
  }))}`;

  let layer = null;
  const showContactHeader = () => {
    setGlobalAccountHeader(root, contactHeaderMarkup(relationship));
    setV2V(root, { data: 'data-global-contact-settings', aria: 'Настройки' });
    bindContactHeaderActions(root, state, handlers, relationship, { actionRoot: layer });
  };

  layer = mountV2ZLayer(root, v2ZLayer(body, { className: 'account-contact-detail-z' }), {
    stack: true,
    onClose: () => {
      state.accountTab = 'contacts';
      state.accountDeckActive = 'contacts';
      state.accountSelectedContactTenantId = '';
      void handlers.render();
    },
  });
  if (!layer) return;
  showContactHeader();

  layer.querySelectorAll('[data-global-contact-workplace]').forEach((node) => node.addEventListener('click', () => {
    const workplace = (Array.isArray(relationship?.context?.workplaces) ? relationship.context.workplaces : [])
      .find((item) => String(item?.key || '') === String(node.dataset.globalContactWorkplace || ''));
    if (!workplace) return;
    openGlobalContactWorkplaceLayer(root, state, handlers, relationship, workplace, records, showContactHeader);
  }));

  layer.querySelector('[data-global-contact-personal-account]')?.addEventListener('click', () => {
    if (!personalAccount) return;
    openGlobalContactPersonalAccountLayer(root, state, handlers, relationship, personalAccount, showContactHeader);
  });

  layer.querySelectorAll('[data-global-contact-deposit]').forEach((node) => node.addEventListener('click', () => {
    const deposit = contactDeposits.find((item) => String(item?.depositId || '') === String(node.dataset.globalContactDeposit || ''));
    if (!deposit) return;
    openGlobalContactDepositLayer(root, state, handlers, relationship, deposit, showContactHeader);
  }));

  bindAccountInvestments(layer, root, state, handlers, acceptedInvestments, pendingInvestments, showContactHeader);
}

export async function renderGlobalAccount(root, state, callbacks = {}) {
  state.globalAccount = true;
  state.accountTab ||= 'journal';
  state.accountDeckOpen = Boolean(state.accountDeckOpen);
  state.accountEOpen = false;
  state.accountEActive = '';
  state.accountZEnter = Boolean(state.accountZEnter);
  if (!GLOBAL_ACCOUNT_ROOTS.some((item) => item.id === state.accountDeckActive)) state.accountDeckActive = accountRootForTab(state);
  if (state.accountTab !== 'journal') disposeGlobalAccountJournal(root);

  const handlers = {
    render: () => renderGlobalAccount(root, state, callbacks),
    onStartBooking: callbacks.onStartBooking,
    onLogout: callbacks.onLogout,
  };

  if (state.accountTab === 'messages') return renderGlobalMessages(root, state, handlers);
  if (state.accountTab === 'profile-settings') return renderGlobalProfileSettings(root, state, handlers);
  if (state.accountTab === 'profile') return renderGlobalProfile(root, state, handlers);
  if (state.accountTab === 'integrations') return renderGlobalIntegrations(root, state, handlers);
  if (state.accountTab === 'journal') return renderGlobalJournal(root, state, handlers);
  if (state.accountTab === 'contact-detail') return renderGlobalContactDetail(root, state, handlers);
  if (state.accountTab === 'contacts') return renderGlobalContacts(root, state, handlers);
  return renderGlobalJournal(root, state, handlers);
}
