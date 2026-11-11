import { apiRequest, clearAuthToken, getCurrentAccount, login } from '../core/auth.js';
import { renderDocumentRegistry } from './document-registry/view.js';
import { DOCUMENT_CATALOG } from './document-registry/catalog.js';
import { renderAdminTools, TOOL_MAP, TOOL_CAPABILITY_BINDINGS } from './commercial-catalog.js';
import { field, passwordField, initPasswordFields } from '../ui/inputs/index.js';
import { v2Sticker } from '../ui/v2/sticker.js';
import { v2Shell } from '../ui/v2/shell.js';
import { v2Header } from '../ui/v2/header.js';
import { v2CardDeck } from '../ui/v2/card-deck.js';
import { initV2WorkspaceInteraction, setV2DeckOpen } from '../ui/v2/workspace-navigation.js';
import { modal, mountModal } from '../ui/modals/index.js';
import { iconButton } from '../ui/buttons/index.js';

const app = document.querySelector('#admin-app');
const state = {
  account: null,
  admin: null,
  tenants: [],
  capabilities: [],
  toolReadiness: [],
  pushEnabled: false,
  section: 'tenants',
};

let adminPollTimer = null;
let cleanupMobileShell = null;

const SESSION_ICONS = {
  push: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M10 21h4"></path></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><path d="m16 17 5-5-5-5"></path><path d="M21 12H9"></path></svg>',
};

function adminSessionIcon(action) {
  const push = action === 'push';
  return iconButton(SESSION_ICONS[action], {
    className: 'admin-session-icon admin-session-icon--' + action,
    data: push ? 'data-enable-admin-push' : 'data-logout',
    aria: push ? 'Включить PUSH' : 'Выйти из аккаунта',
  });
}

function syncAdminPushIcon(button, { enabled = false, loading = false } = {}) {
  if (!button) return;
  const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
  button.hidden = !supported;
  if (!supported) return;
  const label = loading ? 'Подключаем PUSH' : enabled ? 'PUSH включён' : 'Включить PUSH';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.classList.toggle('is-enabled', enabled);
  button.classList.toggle('is-loading', loading);
  button.disabled = enabled || loading;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

async function adminRequest(path, options = {}) {
  const response = await apiRequest(`/saas-admin${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || 'Ошибка панели управления');
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function platformNoticeRequest(path, options = {}) {
  const response = await apiRequest(`/platform-notices${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка уведомлений');
  return payload;
}

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - (String(value || '').length % 4)) % 4);
  const base64 = `${String(value || '').replaceAll('-', '+').replaceAll('_', '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function enableAdminPush(promptUser = false) {
  if (
    typeof navigator === 'undefined'
    || !('serviceWorker' in navigator)
    || !('PushManager' in window)
    || !('Notification' in window)
  ) return false;

  const configuration = await platformNoticeRequest('/push/configuration');
  if (!configuration?.enabled || !configuration?.publicKey) return false;

  if (Notification.permission === 'default' && promptUser) {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(configuration.publicKey),
    });
  }
  await platformNoticeRequest('/push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  return true;
}

function startAdminPolling() {
  if (adminPollTimer) window.clearInterval(adminPollTimer);
  adminPollTimer = window.setInterval(async () => {
    try {
      await refreshData();
      if (state.section === 'tenants') renderTenants();
    } catch {
      // Фоновое обновление не должно мешать работе админки.
    }
  }, 30_000);
}

function renderConnectionFailure(message = 'Не удалось связаться с сервером.') {
  cleanupMobileShell?.();
  app.innerHTML = v2Sticker({
    title: 'Нет соединения с сервером',
    body: '<p>Сохранённый вход не удалён. Повторите соединение.</p>'
      + '<p class="auth-error" data-connection-error role="alert">' + escapeHtml(message) + '</p>'
      + '<button type="button" class="v2-sticker-link" data-other-account>Войти заново</button>',
    action: '<button class="ui-button" type="button" data-retry-session>Повторить соединение</button>',
    className: 'v2-sticker-screen--auth admin-auth-screen shared-login-screen',
  });
  const button = app.querySelector('[data-retry-session]');
  const error = app.querySelector('[data-connection-error]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    error.textContent = 'Проверяем соединение…';
    try {
      const account = await getCurrentAccount();
      if (!account) return renderLogin();
      state.account = account;
      await loadAdmin();
    } catch (retryError) {
      if (retryError?.status === 401 || retryError?.status === 403) {
        clearAuthToken();
        return renderLogin(retryError.message);
      }
      error.textContent = retryError instanceof Error ? retryError.message : 'Сервер недоступен';
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
  app.querySelector('[data-other-account]').addEventListener('click', () => {
    clearAuthToken();
    state.account = null;
    renderLogin();
  });
}

async function loginWithOneRetry(identifier, password, onRetry) {
  try {
    return await login(identifier, password);
  } catch (error) {
    if (error?.message !== 'Сервер не ответил вовремя') throw error;
    onRetry?.();
    return login(identifier, password);
  }
}

function renderLogin(message = '') {
  cleanupMobileShell?.();
  const formBody = '<form class="auth-form shared-login-form" id="admin-auth-form" data-login-form>'
    + field({ label: 'Телефон или email', name: 'identifier', type: 'text', required: true, autocomplete: 'username' })
    + passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })
    + '<p class="auth-error" data-login-error role="alert">' + escapeHtml(message) + '</p>'
    + '<button type="button" class="v2-sticker-link" data-admin-forgot>Забыли пароль?</button>'
    + '</form>';
  app.innerHTML = v2Sticker({
    title: 'Вход в Администратор',
    body: formBody,
    action: '<button class="ui-button" type="submit" form="admin-auth-form">Войти</button>',
    className: 'v2-sticker-screen--auth admin-auth-screen shared-login-screen',
  });
  initPasswordFields(app);
  const form = app.querySelector('[data-login-form]');
  const error = app.querySelector('[data-login-error]');
  const button = app.querySelector('[type="submit"][form="admin-auth-form"]');
  app.querySelector('[data-admin-forgot]')?.addEventListener('click', () => {
    renderAdminPasswordResetRequest(form.elements.identifier.value);
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Входим…';
    const data = new FormData(form);
    try {
      state.account = await loginWithOneRetry(data.get('identifier'), data.get('password'), () => {
        error.textContent = 'Сервер не ответил. Пробуем ещё раз…';
      });
    } catch (loginError) {
      error.textContent = loginError instanceof Error ? loginError.message : 'Не удалось войти';
      button.disabled = false;
      button.textContent = 'Войти';
      return;
    }
    try {
      await loadAdmin();
    } catch (loadError) {
      if (loadError?.status === 401 || loadError?.status === 403) {
        clearAuthToken();
        renderLogin(loadError.message);
      } else {
        renderConnectionFailure(loadError instanceof Error ? loadError.message : 'Сервер недоступен');
      }
    }
  });
}

function renderAdminPasswordResetRequest(identifier = '') {
  const body = '<form class="auth-form shared-login-form" id="admin-reset-form">'
    + field({ label: 'Телефон или email', name: 'identifier', value: identifier, type: 'text', required: true, autocomplete: 'username' })
    + '<p class="auth-error" data-reset-error role="alert"></p>'
    + '<button type="button" class="v2-sticker-link" data-reset-back>Вернуться ко входу</button>'
    + '</form>';
  app.innerHTML = v2Sticker({
    title: 'Восстановление пароля',
    body,
    action: '<button class="ui-button" type="submit" form="admin-reset-form">Отправить ссылку</button>',
    className: 'v2-sticker-screen--auth admin-auth-screen shared-login-screen',
  });
  app.querySelector('[data-reset-back]')?.addEventListener('click', () => renderLogin());
  const form = app.querySelector('#admin-reset-form');
  const error = app.querySelector('[data-reset-error]');
  const button = app.querySelector('[form="admin-reset-form"][type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    const requested = String(new FormData(form).get('identifier') || '').trim();
    try {
      const response = await apiRequest('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ identifier: requested, email: requested, surface: 'admin' }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Не удалось отправить ссылку');
      app.innerHTML = v2Sticker({
        title: 'Проверьте почту',
        body: '<p>Если подтверждённый email существует, на него отправлена ссылка для изменения пароля.</p>',
        action: '<button type="button" class="ui-button" data-return-to-admin>Вернуться ко входу</button>',
        className: 'v2-sticker-screen--auth admin-auth-screen shared-login-screen',
      });
      app.querySelector('[data-return-to-admin]')?.addEventListener('click', () => renderLogin());
    } catch (requestError) {
      error.textContent = requestError instanceof Error ? requestError.message : 'Не удалось отправить ссылку';
      button.disabled = false;
    }
  });
}

async function loadAdmin() {
  state.admin = await adminRequest('/me');
  await adminRequest('/document-registry/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: DOCUMENT_CATALOG }),
  });
  await refreshData();
  renderShell();
  startAdminPolling();
  void enableAdminPush(false).then((enabled) => {
    state.pushEnabled = Boolean(enabled);
    syncAdminPushIcon(app.querySelector('[data-enable-admin-push]'), { enabled: state.pushEnabled });
  }).catch(() => {
    state.pushEnabled = false;
    syncAdminPushIcon(app.querySelector('[data-enable-admin-push]'));
  });
}

async function refreshData() {
  const [tenants, capabilities, toolReadiness] = await Promise.all([
    adminRequest('/tenants'),
    adminRequest('/capabilities'),
    adminRequest('/tool-readiness'),
  ]);
  state.tenants = Array.isArray(tenants) ? tenants : [];
  state.capabilities = Array.isArray(capabilities) ? capabilities : [];
  state.toolReadiness = Array.isArray(toolReadiness) ? toolReadiness : [];
}

const ADMIN_SECTIONS = [
  { id: 'overview', label: 'Обзор', icon: 'home' },
  { id: 'owner', label: 'Моё пространство', icon: 'profile' },
  { id: 'document-registry', label: 'Реестр документов', icon: 'documents' },
  { id: 'tenants', label: 'Пользователи', icon: 'people' },
  { id: 'capabilities', label: 'Инструменты', icon: 'settings' },
];

function adminSectionLabel() {
  return ADMIN_SECTIONS.find((item) => item.id === state.section)?.label || 'Пользователи';
}

function watchAdminBreakpoint(dispose = () => {}) {
  const breakpoint = window.matchMedia('(max-width: 760px)');
  const changed = () => { if (state.admin) renderShell(); };
  breakpoint.addEventListener('change', changed);
  cleanupMobileShell = () => {
    breakpoint.removeEventListener('change', changed);
    dispose();
    cleanupMobileShell = null;
  };
}

function bindAdminSessionControls() {
  const pushButton = app.querySelector('[data-enable-admin-push]');
  syncAdminPushIcon(pushButton, { enabled: state.pushEnabled });
  pushButton?.addEventListener('click', async () => {
    syncAdminPushIcon(pushButton, { loading: true });
    const enabled = await enableAdminPush(true).catch(() => false);
    state.pushEnabled = Boolean(enabled);
    syncAdminPushIcon(pushButton, { enabled: state.pushEnabled });
  });
  app.querySelector('[data-logout]')?.addEventListener('click', () => {
    cleanupMobileShell?.();
    if (adminPollTimer) window.clearInterval(adminPollTimer);
    adminPollTimer = null;
    clearAuthToken();
    state.account = null;
    state.admin = null;
    state.pushEnabled = false;
    renderLogin();
  });
}

function renderMobileShell() {
  const deck = v2CardDeck(ADMIN_SECTIONS, { active: state.section, data: 'data-section' })
    + '<div class="admin-mobile-deck-footer"><span>' + escapeHtml(state.admin?.account?.email || '') + '</span>'
    + adminSessionIcon('push')
    + adminSessionIcon('logout') + '</div>';
  const header = v2Header({
    b: { label: adminSectionLabel(), subtitle: 'Администратор' },
    c: { kind: 'mode', data: 'data-admin-deck-toggle', aria: 'Разделы' },
  });
  app.innerHTML = v2Shell({
    header, deck,
    body: '<div class="admin-content" data-content></div>',
    className: 'admin-mobile-app',
  });
  const root = app.querySelector('[data-v2-app]');
  const toggle = app.querySelector('[data-admin-deck-toggle]');
  const deckNode = app.querySelector('[data-v2-card-deck][data-v2-deck-level="f"]');
  const toggleDeck = (open) => {
    const value = setV2DeckOpen(root, open);
    toggle.setAttribute('aria-expanded', String(value));
    if (value) {
      const active = deckNode?.querySelector('.is-active');
      if (active && deckNode) {
        deckNode.scrollLeft = Math.max(0, active.offsetLeft + active.offsetWidth / 2 - deckNode.clientWidth / 2);
        deckNode.dispatchEvent(new Event('scroll'));
      }
    }
  };
  const stopNavigation = initV2WorkspaceInteraction(root, {
    activeId: state.section,
    onRootSelect: (id) => {
      if (!ADMIN_SECTIONS.some((item) => item.id === id)) return;
      toggleDeck(false);
      state.section = id;
      renderCurrentSection();
    },
    onDeckOpenChange: (open) => toggle.setAttribute('aria-expanded', String(open)),
  });
  toggle.addEventListener('click', () => toggleDeck(!root.classList.contains('is-deck-open')));
  const keydown = (event) => { if (event.key === 'Escape') toggleDeck(false); };
  window.addEventListener('keydown', keydown);
  watchAdminBreakpoint(() => {
    stopNavigation();
    window.removeEventListener('keydown', keydown);
  });
  bindAdminSessionControls();
  renderCurrentSection();
}

function renderShell() {
  cleanupMobileShell?.();
  if (window.matchMedia('(max-width: 760px)').matches) {
    renderMobileShell();
    return;
  }
  app.innerHTML = '<div class="admin-shell">'
    + '<aside class="admin-sidebar">'
    + '<div class="admin-brand">ACVERO<span>Администратор</span></div>'
    + '<nav class="admin-nav" aria-label="Разделы администратора">'
    + ADMIN_SECTIONS.map((item) => '<button type="button" data-section="' + item.id + '">' + escapeHtml(item.label) + '</button>').join('')
    + '</nav><div class="admin-sidebar-foot">Управление системой</div></aside>'
    + '<header class="admin-toolbar">'
    + '<div class="admin-toolbar-context"><span>Платформа</span><span class="admin-toolbar-divider">/</span><span data-toolbar-title>Пользователи</span></div>'
    + '<div class="admin-toolbar-user"><span>' + escapeHtml(state.admin?.account?.email || '') + '</span>'
    + adminSessionIcon('push')
    + adminSessionIcon('logout') + '</div></header>'
    + '<main class="admin-main"><div class="admin-content" data-content></div></main>'
    + '</div>';
  app.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = button.dataset.section;
      renderCurrentSection();
    });
  });
  watchAdminBreakpoint();
  bindAdminSessionControls();
  renderCurrentSection();
}

function setActiveSection(title) {
  const titleNode = app.querySelector('[data-toolbar-title], .admin-mobile-app .v2-header__title-label');
  if (titleNode) titleNode.textContent = title;
  app.querySelectorAll('[data-section]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.section === state.section);
  });
}

function renderCurrentSection() {
  if (state.section === 'overview') return renderOverview();
  if (state.section === 'owner') return renderOwnerBook();
  if (state.section === 'document-registry') {
    return renderDocumentRegistry(app.querySelector('[data-content]'), {
      escapeHtml,
      setTitle: setActiveSection,
      loadHistory: () => adminRequest('/document-registry/history'),
    });
  }
  if (state.section === 'capabilities') return renderCapabilities();
  return renderTenants();
}

// Dashboard state is local to Admin presentation; no new API, ledger or shadow counter.
let overviewWindowWeeks = 8;
let overviewDetailGroup = '';
let overviewUserStats = null;
let overviewUserStatsStatus = 'idle';

function requestOverviewUserStats(force = false) {
  if (overviewUserStatsStatus === 'loading' || (!force && overviewUserStatsStatus !== 'idle')) return;
  overviewUserStatsStatus = 'loading';
  void adminRequest('/overview/user-accounts')
    .then((result) => {
      if (![result?.registered, result?.newLast30Days, result?.loggedInLast30Days].every(Number.isFinite)) {
        throw new Error('Некорректная статистика');
      }
      overviewUserStats = result;
      overviewUserStatsStatus = 'ready';
    })
    .catch(() => {
      overviewUserStatsStatus = 'unavailable';
    })
    .finally(() => {
      if (state.section === 'overview') renderOverview();
    });
}

function overviewToolSummary(rows) {
  const ready = rows.filter((item) => item.status === 'READY').length;
  const testing = rows.filter((item) => item.status === 'TESTING').length;
  const notReady = rows.filter((item) => item.status === 'NOT_READY').length;
  return { ready, testing, notReady, total: rows.length };
}

function overviewGroupRows(group, regular) {
  if (group === 'registered') return regular.filter((item) => Boolean(item.ownerProfile));
  if (group === 'live' || group === 'demo') {
    return regular.filter((item) => item.ownerProfile && String(item.access?.commercialMode || 'DEMO').toUpperCase() === group.toUpperCase());
  }
  if (group === 'pending') return regular.filter((item) => !item.ownerProfile && item.invitation?.status === 'PENDING');
  if (group === 'suspended') return regular.filter((item) => item.status === 'SUSPENDED');
  return [];
}

function overviewRegistrationWeeks(registered, weeks = 8, now = new Date()) {
  const monday = (value) => {
    const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return date;
  };
  const first = monday(now);
  first.setDate(first.getDate() - (weeks - 1) * 7);
  const weekNumber = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 604800000;
  const start = weekNumber(first);
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const mondayDate = new Date(first);
    mondayDate.setDate(mondayDate.getDate() + 7 * index);
    return { date: mondayDate, count: 0 };
  });
  for (const item of registered) {
    const date = new Date(item.ownerProfile?.registeredAt || '');
    if (!Number.isFinite(date.getTime()) || date > now) continue;
    const index = Math.round(weekNumber(monday(date)) - start);
    if (index >= 0 && index < weeks) buckets[index].count += 1;
  }
  return buckets;
}

function renderOverview() {
  setActiveSection('Обзор');
  const content = app.querySelector('[data-content]');
  const regular = state.tenants.filter((item) => !item.isOwnerBook);
  const registered = overviewGroupRows('registered', regular);
  const demo = overviewGroupRows('demo', regular);
  const live = overviewGroupRows('live', regular);
  const pending = overviewGroupRows('pending', regular);
  const suspended = overviewGroupRows('suspended', regular);
  const toolRows = Array.isArray(state.toolReadiness) ? state.toolReadiness : [];
  const toolsByApp = [
    { label: 'Кабинет', type: 'cabinet', ...overviewToolSummary(toolRows.filter((row) => String(row.key || '').startsWith('cabinet.'))) },
    { label: 'Записи', type: 'records', ...overviewToolSummary(toolRows.filter((row) => String(row.key || '').startsWith('records.'))) },
  ];
  const userStats = overviewUserStatsStatus === 'ready' ? overviewUserStats : null;
  const bars = overviewRegistrationWeeks(registered, overviewWindowWeeks);
  const maxBar = Math.max(1, ...bars.map((bar) => bar.count));
  const recent = bars.reduce((sum, bar) => sum + bar.count, 0);
  const periodLabel = overviewWindowWeeks === 4 ? '4 недели' : overviewWindowWeeks === 8 ? '8 недель' : '12 недель';
  const groupCards = [
    { key: 'registered', value: registered.length, title: 'Зарегистрированы', theme: 'primary' },
    { key: 'demo', value: demo.length, title: 'DEMO' },
    { key: 'live', value: live.length, title: 'LIVE' },
    { key: 'pending', value: pending.length, title: 'Ожидают' },
  ];
  const selected = groupCards.find((item) => item.key === overviewDetailGroup)
    || (overviewDetailGroup === 'suspended'
      ? { key: 'suspended', title: 'Приостановлены', value: suspended.length }
      : null);
  const details = selected ? overviewGroupRows(selected.key, regular) : [];
  const issueRows = [
    { label: 'Ожидают регистрации', count: pending.length, group: 'pending' },
    { label: 'Приостановлены', count: suspended.length, group: 'suspended' },
  ].filter((item) => item.count > 0);

  content.innerHTML = `
    <div class="admin-overview">
      <div class="admin-heading admin-overview-heading">
        <div><h2>Состояние платформы</h2></div>
      </div>
      <div class="admin-overview-app-head">
        <h3>Кабинет <span class="admin-overview-head-suffix">/ Professional</span></h3>
      </div>
      <section class="admin-overview-metrics" aria-label="Аккаунты Кабинета">
        ${groupCards.map((item) => `
          <button type="button" class="admin-overview-metric${item.theme ? ' is-primary' : ''}${overviewDetailGroup === item.key ? ' is-selected' : ''}"
            data-overview-group="${item.key}" aria-pressed="${overviewDetailGroup === item.key}">
            <span class="admin-overview-metric-label">${item.title}</span>
            <strong class="admin-overview-metric-value">${item.value}</strong>
            <span class="admin-overview-metric-action" aria-hidden="true">↗</span>
          </button>`).join('')}
      </section>
      ${selected ? `
        <section class="admin-overview-detail" aria-label="${escapeHtml(selected.title)}">
          <div class="admin-overview-detail-heading">
            <div><strong>${escapeHtml(selected.title)} · ${details.length}</strong></div>
            <button type="button" class="admin-overview-close" data-overview-close aria-label="Свернуть подробности">×</button>
          </div>
          <div class="admin-overview-detail-list">
            ${details.length ? details.map((item) => `
              <button type="button" class="admin-overview-person" data-overview-tenant="${escapeHtml(item.tenantId)}">
                <span><strong>${escapeHtml(item.ownerProfile?.name || item.invitation?.name || item.tenantName || 'Без имени')}</strong>
                <small>${escapeHtml(item.ownerProfile?.email || item.invitation?.email || '')}</small></span>
                <span class="admin-overview-person-status">${item.ownerProfile ? escapeHtml(String(item.access?.commercialMode || 'DEMO')) : 'Ожидает'} <span aria-hidden="true">↗</span></span>
              </button>`).join('') : '<p class="admin-overview-empty">В этой категории пока никого нет.</p>'}
          </div>
        </section>` : ''}
      <div class="admin-overview-layout">
        <section class="admin-overview-panel admin-overview-chart-panel">
          <div class="admin-overview-panel-head">
            <div><h3>Новые регистрации</h3></div>
            <div class="admin-overview-period" role="group" aria-label="Период графика">
              ${[4, 8, 12].map((weeks) => `<button type="button" data-overview-weeks="${weeks}" aria-pressed="${overviewWindowWeeks === weeks}">${weeks} нед.</button>`).join('')}
            </div>
          </div>
          <div class="admin-overview-chart-summary"><strong>${recent}</strong><span>за последние ${periodLabel}</span></div>
          <div class="admin-overview-bars" role="img" aria-label="Регистрации по неделям за ${periodLabel}">
            ${bars.map((bar, index) => `
              <div class="admin-overview-bar-cell">
                <span class="admin-overview-bar-value">${bar.count || ''}</span>
                <span class="admin-overview-bar-track">
                  <span class="admin-overview-bar${index === bars.length - 1 ? ' is-current' : ''}"
                    style="--bar-height:${bar.count ? Math.max(9, Math.round(100 * bar.count / maxBar)) : 3}%"></span>
                </span>
                <span class="admin-overview-bar-label">${new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(bar.date)}</span>
              </div>`).join('')}
          </div>
        </section>
        <section class="admin-overview-panel admin-overview-focus">
          <div class="admin-overview-panel-head"><div><h3>Требует внимания</h3></div></div>
          ${issueRows.length ? `<div class="admin-overview-focus-list">
            ${issueRows.map((row) => `<button type="button" data-overview-group="${row.group}" class="admin-overview-focus-row">
              <span>${row.label}</span><strong>${row.count}</strong><span aria-hidden="true">↗</span>
            </button>`).join('')}
          </div>` : `<div class="admin-overview-clear"><span class="admin-overview-clear-mark" aria-hidden="true">✓</span>
            <strong>Нет ожидающих действий</strong>
          </div>`}
          <button type="button" class="admin-overview-panel-link" data-overview-section="tenants">Открыть пользователей <span aria-hidden="true">↗</span></button>
        </section>
      </div>
      <section class="admin-overview-user-section" aria-label="Статистика приложения Записи">
        <div class="admin-overview-app-head">
          <h3>Записи <span class="admin-overview-head-suffix">/ User</span></h3>
        </div>
        <div class="admin-overview-user-metrics">
          <div class="admin-overview-metric">
            <span class="admin-overview-metric-label">Зарегистрированы</span>
            <strong class="admin-overview-metric-value">${userStats ? userStats.registered : '—'}</strong>
          </div>
          <div class="admin-overview-metric">
            <span class="admin-overview-metric-label">Новые · 30 дней</span>
            <strong class="admin-overview-metric-value">${userStats ? userStats.newLast30Days : '—'}</strong>
          </div>
          <div class="admin-overview-metric">
            <span class="admin-overview-metric-label">Входили · 30 дней</span>
            <strong class="admin-overview-metric-value">${userStats ? userStats.loggedInLast30Days : '—'}</strong>
          </div>
        </div>
      </section>
      <section class="admin-overview-tools-section">
        <div class="admin-overview-app-head">
          <h3>Готовность функций <span class="admin-overview-head-suffix">/ Инструменты</span></h3>
          <button type="button" class="admin-overview-inline-link" data-overview-section="capabilities" aria-label="Открыть инструменты">Открыть инструменты <span aria-hidden="true">↗</span></button>
        </div>
        <div class="admin-overview-tools-by-app">
          ${toolsByApp.map((group) => `
            <div class="admin-overview-panel admin-overview-tools" data-overview-tool-app="${group.type}">
              <div class="admin-overview-panel-head"><h3>${group.label} <span class="admin-overview-head-suffix">/ ${group.type === 'cabinet' ? 'Professional' : 'User'}</span></h3></div>
              <div class="admin-overview-tool-counts">
                <span><i class="is-ready"></i>Готово <strong>${group.ready}</strong></span>
                <span><i class="is-testing"></i>Проверка <strong>${group.testing}</strong></span>
                <span><i class="is-not-ready"></i>Не готово <strong>${group.notReady}</strong></span>
              </div>
              <div class="admin-overview-tool-track" role="img" aria-label="${group.label}: готово ${group.ready}, проверка ${group.testing}, не готово ${group.notReady}">
                ${group.total ? `
                  <span class="is-ready" style="width:${100 * group.ready / group.total}%"></span>
                  <span class="is-testing" style="width:${100 * group.testing / group.total}%"></span>
                  <span class="is-not-ready" style="width:${100 * group.notReady / group.total}%"></span>
                ` : '<span class="is-empty" style="width:100%"></span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </section>
    </div>`;

  if (overviewUserStatsStatus === 'idle') requestOverviewUserStats();

  content.querySelectorAll('[data-overview-group]').forEach((button) => {
    button.addEventListener('click', () => {
      overviewDetailGroup = overviewDetailGroup === button.dataset.overviewGroup ? '' : button.dataset.overviewGroup;
      renderOverview();
    });
  });
  content.querySelector('[data-overview-close]')?.addEventListener('click', () => {
    overviewDetailGroup = '';
    renderOverview();
  });
  content.querySelectorAll('[data-overview-weeks]').forEach((button) => {
    button.addEventListener('click', () => {
      overviewWindowWeeks = Number(button.dataset.overviewWeeks) || 8;
      renderOverview();
    });
  });
  content.querySelectorAll('[data-overview-tenant]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = 'tenants';
      renderCurrentSection();
      openAccessDrawer(button.dataset.overviewTenant);
    });
  });
  content.querySelectorAll('[data-overview-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = button.dataset.overviewSection;
      renderCurrentSection();
    });
  });
}

function renderOwnerBook() {
  setActiveSection('Моё пространство');
  const owner = state.tenants.find((item) => item.isOwnerBook);
  const content = app.querySelector('[data-content]');
  if (!owner) {
    content.innerHTML = '<div class="admin-card" style="padding:20px">Личное рабочее пространство пока не определено.</div>';
    return;
  }
  content.innerHTML = `
    <div class="admin-heading"><div><h2>Моё пространство</h2><p>Личное рабочее пространство администратора остаётся отдельным от списка пользователей.</p></div></div>
    <div class="admin-card" style="padding:20px">
      <strong>${escapeHtml(owner.ownerProfile?.name || owner.tenantName)}</strong>
      <p style="color:var(--muted)">${escapeHtml(owner.ownerProfile?.email || '')}</p>
      <button class="admin-button" data-edit-owner>Настроить доступы</button>
    </div>`;
  content.querySelector('[data-edit-owner]').addEventListener('click', () => openAccessDrawer(owner.tenantId));
}

function openDeleteTenantModal(tenantId) {
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant || tenant.isOwnerBook) return;

  const name = tenant.ownerProfile?.name || tenant.invitation?.name || tenant.tenantName || 'Пользователь';
  const email = tenant.ownerProfile?.email || tenant.invitation?.email || '';
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-delete-backdrop';
  backdrop.innerHTML = `
    <section class="admin-delete-modal" role="dialog" aria-modal="true" aria-labelledby="admin-delete-title">
      <h2 id="admin-delete-title">Удалить пользователя?</h2>
      <p class="admin-delete-person"><strong>${escapeHtml(name)}</strong>${email ? `<span>${escapeHtml(email)}</span>` : ''}</p>
      <p class="admin-delete-copy">Будут полностью удалены профиль, рабочее пространство и все его тестовые данные. Отменить это действие будет невозможно.</p>
      <p class="admin-delete-error" data-delete-error></p>
      <div class="admin-delete-actions">
        <button type="button" class="admin-button secondary" data-delete-cancel>Отмена</button>
        <button type="button" class="admin-button danger" data-delete-confirm>Удалить</button>
      </div>
    </section>`;
  const sharedX = Boolean(app.querySelector('.admin-mobile-app'));
  if (sharedX) {
    const html = modal(backdrop.innerHTML, { title: 'Удалить пользователя?', variant: 'x', xRole: 'action', className: 'admin-delete-x' });
    const mounted = mountModal(app.querySelector('[data-v2-app]'), html);
    if (!mounted) return;
    backdrop = mounted;
  } else document.body.append(backdrop);

  const close = () => { if (sharedX) backdrop.v2Close?.(); else backdrop.remove(); };
  backdrop.querySelector('[data-delete-cancel]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('[data-delete-confirm]')?.addEventListener('click', async (event) => {
    const control = event.currentTarget;
    const errorNode = backdrop.querySelector('[data-delete-error]');
    control.disabled = true;
    control.textContent = 'Удаляем…';
    errorNode.textContent = '';
    try {
      await adminRequest(`/tenants/${encodeURIComponent(tenantId)}`, { method: 'DELETE' });
      close();
      await refreshData();
      renderTenants();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : 'Не удалось удалить пользователя';
      control.disabled = false;
      control.textContent = 'Удалить';
    }
  });
}

const INVITATION_TOOL_GROUP_LABELS = {
  profile: 'Профиль',
  work: 'Основные',
  people: 'Основные',
  finance: 'Финансы',
  journal: 'Журнал',
  settings: 'Настройки',
};

function invitationToolSelector() {
  const groups = new Map();
  state.capabilities.forEach((item) => {
    if (item.valueType !== 'BOOLEAN') return;
    const label = INVITATION_TOOL_GROUP_LABELS[item.groupKey] || item.groupKey || 'Инструменты';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  });
  return `<div class="admin-invite-tools" data-invite-tools>
    <div class="admin-invite-tools-head">
      <div><h4>Доступ по ссылке</h4><p class="admin-service-note">Выбери только те инструменты, которые должны быть доступны человеку в DEMO по этой ссылке.</p></div>
      <div class="admin-inline-actions">
        <button class="admin-button secondary" type="button" data-select-all-invite-tools>Выбрать всё</button>
        <button class="admin-button secondary" type="button" data-clear-invite-tools>Снять всё</button>
      </div>
    </div>
    ${[...groups.entries()].map(([group, items]) => `<section class="admin-invite-tool-group">
      <strong>${escapeHtml(group)}</strong>
      <div class="admin-invite-tool-list">
        ${items.map((item) => `<label class="admin-invite-tool">
          <input type="checkbox" value="${escapeHtml(item.key)}" data-invite-tool>
          <span>${escapeHtml(item.name)}</span>
        </label>`).join('')}
      </div>
    </section>`).join('')}
  </div>`;
}

function selectedInvitationTools(root) {
  return [...root.querySelectorAll('[data-invite-tool]:checked')]
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
}

function renderTenants() {
  setActiveSection('Пользователи');
  const content = app.querySelector('[data-content]');
  const tenants = state.tenants.filter((item) => !item.isOwnerBook);
  content.innerHTML = `
    <div class="admin-heading"><div><h2>Пользователи</h2><p>Режимы и доступ пользователей.</p></div></div>
    <section class="admin-invite-panel">
      <div class="admin-invite-head">
        <div>
          <h3>Регистрационная ссылка</h3>
          <p class="admin-service-note">Настрой доступ и создай одноразовую ссылку.</p>
        </div>
      </div>
      <details class="admin-invite-access">
        <summary>Настроить доступ по ссылке</summary>
        ${invitationToolSelector()}
      </details>
      <div class="admin-invite-primary-actions">
        <button class="admin-button" type="button" data-create-invite-link>Создать ссылку</button>
      </div>
      <div class="admin-invite-link" data-invite-link hidden>
        <label class="admin-field">
          <span>Ссылка для регистрации</span>
          <input type="text" readonly data-invite-link-value>
        </label>
        <button class="admin-button secondary" type="button" data-copy-invite-link>Копировать</button>
      </div>
      <p class="admin-inline-message" data-invite-message></p>
    </section>
    <div class="admin-card">
      <table class="admin-table">
        <thead><tr><th>Пользователь</th><th>Email</th><th>Режим</th><th>Состояние</th></tr></thead>
        <tbody>${tenants.map(tenantRow).join('') || '<tr><td colspan="4">Пока нет созданных профилей.</td></tr>'}</tbody>
      </table>
    </div>`;

  const message = content.querySelector('[data-invite-message]');
  const createLinkButton = content.querySelector('[data-create-invite-link]');
  const inviteLinkBox = content.querySelector('[data-invite-link]');
  const inviteLinkInput = content.querySelector('[data-invite-link-value]');
  const copyLinkButton = content.querySelector('[data-copy-invite-link]');

  content.querySelector('[data-select-all-invite-tools]')?.addEventListener('click', () => {
    content.querySelectorAll('[data-invite-tool]').forEach((input) => { input.checked = true; });
  });
  content.querySelector('[data-clear-invite-tools]')?.addEventListener('click', () => {
    content.querySelectorAll('[data-invite-tool]').forEach((input) => { input.checked = false; });
  });

  createLinkButton?.addEventListener('click', async () => {
    message.textContent = '';
    message.classList.remove('error');
    const tools = selectedInvitationTools(content);
    if (!tools.length) {
      content.querySelector('.admin-invite-access')?.setAttribute('open', '');
      message.textContent = 'Выбери хотя бы один инструмент или нажми «Выбрать всё».';
      message.classList.add('error');
      return;
    }
    createLinkButton.disabled = true;
    createLinkButton.textContent = 'Создаём…';
    try {
      const result = await adminRequest('/invitations/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools }),
      });
      const url = String(result?.url || '').trim();
      if (!url) throw new Error('Ссылка не получена');
      inviteLinkInput.value = url;
      inviteLinkBox.hidden = false;
      message.textContent = 'Ссылка готова. Она действует 7 дней и используется один раз.';
      await refreshData();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось создать ссылку';
      message.classList.add('error');
    } finally {
      createLinkButton.disabled = false;
      createLinkButton.textContent = 'Создать ссылку';
    }
  });

  copyLinkButton?.addEventListener('click', async () => {
    const url = String(inviteLinkInput?.value || '').trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inviteLinkInput.focus();
      inviteLinkInput.select();
      document.execCommand('copy');
    }
    copyLinkButton.textContent = 'Скопировано';
    window.setTimeout(() => { copyLinkButton.textContent = 'Копировать'; }, 1200);
  });

  content.querySelectorAll('[data-tenant]').forEach((row) => {
    row.addEventListener('click', () => openAccessDrawer(row.dataset.tenant));
  });

  content.querySelectorAll('[data-delete-tenant]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const tenantId = button.dataset.deleteTenant;
      if (tenantId) openDeleteTenantModal(tenantId);
    });
  });
}

function tenantRow(item) {
  const pending = !item.ownerProfile && item.invitation?.status === 'PENDING';
  const name = item.ownerProfile?.name || item.invitation?.name || item.tenantName;
  const email = item.ownerProfile?.email || item.invitation?.email || '';
  const mode = String(item.access?.commercialMode || 'DEMO');
  const statusClass = item.status === 'SUSPENDED' ? 'suspended' : pending ? 'pending' : 'active';
  const statusLabel = item.status === 'SUSPENDED' ? 'Отключён' : pending ? 'Ждёт регистрации' : item.ownerProfile ? 'Активен' : 'Создан';
  const modeClass = mode === 'LIVE' ? 'active' : 'pending';
  const testerBadge = item.isTester ? ' <span class="admin-pill pending">Тестировщик</span>' : '';
  const remove = `<button class="admin-button danger" data-delete-tenant="${escapeHtml(item.tenantId)}">Удалить</button>`;
  return `<tr data-tenant="${escapeHtml(item.tenantId)}"><td><strong>${escapeHtml(name)}</strong>${testerBadge}</td><td>${email ? escapeHtml(email) : '—'}</td><td><span class="admin-pill ${modeClass}">${escapeHtml(mode)}</span></td><td><span class="admin-pill ${statusClass}">${statusLabel}</span> ${remove}</td></tr>`;
}

function renderCapabilities() {
  setActiveSection('Инструменты');
  renderAdminTools(app.querySelector('[data-content]'));
}

function formatAdminMoment(value, fallback = '—') {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function readinessLabel(key) {
  const item = state.toolReadiness.find((row) => row.key === key);
  return ({ NOT_READY: 'Не готово', TESTING: 'Проверка', READY: 'Готово' })[item?.status] || 'Не готово';
}

function renderRegistryLeaf(item, resolved, readonly = false) {
  const key = item.readinessKey || '';
  const keys = TOOL_CAPABILITY_BINDINGS[key] || [];
  const capabilities = readonly ? [] : keys.map((name) => state.capabilities.find((capability) => capability.key === name)).filter(Boolean);
  const controls = capabilities.map((capability) => capabilityEditor(capability, resolved.get(capability.key))).join('');
  const note = readonly
    ? 'Управляется отдельно в приложении «Записи».'
    : 'Отдельное индивидуальное разрешение пока не предусмотрено.';
  return '<div class="admin-capability-order-row" data-readiness-key="' + escapeHtml(key) + '">' +
    '<div class="admin-capability-control">' +
    '<div class="admin-capability"><div><strong>' + escapeHtml(item.label) +
    '</strong><small>' + escapeHtml(readinessLabel(key)) + ' · ' + escapeHtml(key) + '</small></div></div>' +
    (controls || '<p class="admin-service-note">' + note + '</p>') +
    '</div></div>';
}

function renderRegistrySection(item, resolved, readonly = false) {
  const children = Array.isArray(item.items) ? item.items : [];
  if (!children.length) return renderRegistryLeaf(item, resolved, readonly);
  const sharedKey = readonly ? '' : String(item.capabilityKey || '');
  const shared = sharedKey ? state.capabilities.find((capability) => capability.key === sharedKey) : null;
  const sharedControl = shared
    ? '<div class="admin-capability-order-row">' + capabilityEditor(shared, resolved.get(shared.key)) + '</div>'
    : '';
  return '<details class="admin-section"><summary><strong>' + escapeHtml(item.label) +
    '</strong> · ' + children.length + '</summary>' +
    sharedControl +
    children.map((child) => renderRegistryLeaf(child, resolved, readonly)).join('') +
    '</details>';
}

function renderTenantRegistry(resolved) {
  return '<section class="admin-section"><h4>Кабинет</h4>' +
    TOOL_MAP.cabinet.map((item) => renderRegistrySection(item, resolved)).join('') +
    '</section><details class="admin-section"><summary><strong>Записи</strong> · отдельное приложение</summary>' +
    TOOL_MAP.records.map((item) => renderRegistrySection(item, resolved, true)).join('') +
    '</details>';
}

function openAccessDrawer(tenantId) {
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant) return;
  const resolved = new Map((tenant.access?.capabilities || []).map((item) => [item.key, item]));
  const mode = String(tenant.access?.commercialMode || 'DEMO');
  const demoActivated = tenant.access?.demoActivatedAt || tenant.invitation?.activatedAt || '';
  const demoExpires = tenant.access?.demoExpiresAt || tenant.invitation?.demoExpiresAt || '';
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="admin-drawer">
      <div class="admin-drawer-head">
        <div><h3>${escapeHtml(tenant.ownerProfile?.name || tenant.invitation?.name || tenant.tenantName || 'Пользователь')}</h3><p>${escapeHtml(tenant.ownerProfile?.email || tenant.invitation?.email || '')}</p></div>
        <button class="admin-close" data-close aria-label="Закрыть">×</button>
      </div>

      <section class="admin-section">
        <h4>Режим</h4>
        <div class="admin-mode-card">
          <strong>${escapeHtml(mode)}</strong>
          ${mode === 'DEMO' ? `<span>${demoActivated ? `DEMO началось ${escapeHtml(formatAdminMoment(demoActivated))}` : 'DEMO ещё не началось'}</span><span>${demoExpires ? `DEMO до ${escapeHtml(formatAdminMoment(demoExpires))}` : 'Срок появится после активации'}</span>` : '<span>Рабочий режим LIVE активен.</span>'}
        </div>
      </section>

      <section class="admin-section">
        <h4>Роль доступа</h4>
        <div class="admin-capability">
          <div>
            <strong data-tester-label>${tenant.isTester ? 'Тестировщик' : 'Пользователь'}</strong>
            <small>Назначается администратором. Не зависит от ссылки или DEMO/LIVE.</small>
          </div>
          <button type="button" class="admin-toggle${tenant.isTester ? ' is-on' : ''}"
            role="switch" aria-label="Тестировщик" aria-checked="${tenant.isTester ? 'true' : 'false'}"
            data-tester-toggle></button>
        </div>
      </section>

      <section class="admin-section">
        <h4>Инструменты пользователя</h4>
        <p class="admin-service-note">Состав и порядок совпадают с реестром «Инструменты». Здесь меняются индивидуальные разрешения.</p>
        <div data-capability-order-list>
          ${renderTenantRegistry(resolved)}
        </div>
      </section>

      <section class="admin-section">
        <h4>Состояние пространства</h4>
        <button class="admin-button ${tenant.status === 'SUSPENDED' ? '' : 'danger'}" data-status>${tenant.status === 'SUSPENDED' ? 'Включить пространство' : 'Отключить пространство'}</button>
      </section>

      ${tenant.ownerProfile?.email ? `
      <section class="admin-section">
        <h4>Техническое письмо</h4>
        <p class="admin-service-note">Это служебная отправка уже зарегистрированному пользователю: ${escapeHtml(tenant.ownerProfile.email)}</p>
        <form class="admin-form" data-technical-email-form>
          <label class="admin-field"><span>Тема</span><input name="subject" maxlength="200" required></label>
          <label class="admin-field"><span>Текст</span><textarea name="body" rows="6" maxlength="20000" required></textarea></label>
          <div><button class="admin-button secondary" type="submit">Отправить письмо</button></div>
          <p class="admin-inline-message" data-technical-email-message></p>
        </form>
      </section>` : ''}

      <div class="admin-actions"><button class="admin-button secondary" data-close>Закрыть</button><button class="admin-button" data-save>Сохранить изменения</button></div>
      <p class="admin-inline-message" data-save-message></p>
    </aside>`;
  const sharedQ = Boolean(app.querySelector('.admin-mobile-app'));
  if (sharedQ) {
    const html = modal(backdrop.innerHTML, { title: 'Доступ', variant: 'q', className: 'admin-access-q' });
    const mounted = mountModal(app.querySelector('[data-v2-app]'), html);
    if (!mounted) return;
    backdrop = mounted;
  } else document.body.append(backdrop);

  const close = () => { if (sharedQ) backdrop.v2Close?.(); else backdrop.remove(); };
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });

  const testerToggle = backdrop.querySelector('[data-tester-toggle]');
  testerToggle?.addEventListener('click', () => {
    const enabled = testerToggle.getAttribute('aria-checked') !== 'true';
    testerToggle.setAttribute('aria-checked', String(enabled));
    testerToggle.classList.toggle('is-on', enabled);
    backdrop.querySelector('[data-tester-label]').textContent = enabled ? 'Тестировщик' : 'Пользователь';
  });

  backdrop.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.toggle('is-on');
      button.dataset.current = button.classList.contains('is-on') ? 'true' : 'false';
    });
  });

  backdrop.querySelector('[data-status]')?.addEventListener('click', async () => {
    const next = tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      await refreshData();
      close();
      renderCurrentSection();
    } catch (error) {
      const message = backdrop.querySelector('[data-save-message]');
      message.textContent = error instanceof Error ? error.message : 'Не удалось изменить состояние';
      message.classList.add('error');
    }
  });

  const technicalEmailForm = backdrop.querySelector('[data-technical-email-form]');
  technicalEmailForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const buttonNode = technicalEmailForm.querySelector('button[type="submit"]');
    const message = technicalEmailForm.querySelector('[data-technical-email-message]');
    const data = new FormData(technicalEmailForm);
    message.textContent = '';
    message.classList.remove('error');
    buttonNode.disabled = true;
    buttonNode.textContent = 'Отправляем…';
    try {
      const result = await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/technical-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: data.get('subject'), body: data.get('body') }),
      });
      message.textContent = `Письмо отправлено на ${result.recipientEmail}.`;
      technicalEmailForm.reset();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось отправить письмо';
      message.classList.add('error');
    } finally {
      buttonNode.disabled = false;
      buttonNode.textContent = 'Отправить письмо';
    }
  });

  backdrop.querySelector('[data-save]')?.addEventListener('click', async () => {
    const changes = [];
    backdrop.querySelectorAll('[data-capability]').forEach((element) => {
      const key = element.dataset.capability;
      const type = element.dataset.type;
      if (type === 'BOOLEAN') {
        const current = element.dataset.current === 'true';
        const original = element.dataset.original === 'true';
        if (current !== original) changes.push({ key, enabled: current });
      } else {
        const raw = element.value.trim();
        const current = raw === '' ? null : Number(raw);
        const originalRaw = element.dataset.original;
        const original = originalRaw === '' ? null : Number(originalRaw);
        if (current !== original) changes.push({ key, limit: current });
      }
    });

    const testerChanged = (testerToggle?.getAttribute('aria-checked') === 'true') !== Boolean(tenant.isTester);
    const message = backdrop.querySelector('[data-save-message]');
    if (!changes.length && !testerChanged) {
      message.textContent = 'Изменений нет.';
      return;
    }

    try {
      if (changes.length || testerChanged) {
        await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: changes, ...(testerChanged ? { isTester: testerToggle.getAttribute('aria-checked') === 'true' } : {}) }),
        });
      }
      message.textContent = 'Изменения сохранены.';
      message.classList.remove('error');
      await refreshData();
      window.setTimeout(() => { close(); renderCurrentSection(); }, 300);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось сохранить инструменты';
      message.classList.add('error');
    }
  });
}

document.addEventListener('admin:tool-readiness-changed', () => { void refreshData(); });

function capabilityEditor(capability, resolved) {
  if (capability.valueType === 'LIMIT') {
    const value = resolved?.limit == null ? '' : String(resolved.limit);
    return `<label class="admin-capability"><div>${escapeHtml(capability.name)}<small>${escapeHtml(capability.key)} · пусто = без ограничения</small></div><input class="admin-limit" type="number" min="0" data-capability="${escapeHtml(capability.key)}" data-type="LIMIT" data-original="${escapeHtml(value)}" value="${escapeHtml(value)}" placeholder="∞"></label>`;
  }
  const enabled = resolved?.enabled !== false;
  return `<div class="admin-capability"><div>${escapeHtml(capability.name)}<small>${escapeHtml(capability.key)}</small></div><button type="button" class="admin-toggle ${enabled ? 'is-on' : ''}" data-toggle data-capability="${escapeHtml(capability.key)}" data-type="BOOLEAN" data-original="${enabled}" data-current="${enabled}" aria-label="${escapeHtml(capability.name)}"></button></div>`;
}

try {
  state.account = await getCurrentAccount();
  if (!state.account) {
    renderLogin();
  } else {
    await loadAdmin();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Нет доступа к панели управления';
  if (error?.status === 401 || error?.status === 403) {
    clearAuthToken();
    renderLogin(message);
  } else {
    renderConnectionFailure(message);
  }
}
