import { apiRequest, clearAuthToken, getCurrentAccount, login } from '../core/auth.js';
import { startAccountPresence, stopAccountPresence } from './presence.js';
import { renderDocumentRegistry } from './document-registry/view.js';
import { DOCUMENT_CATALOG } from './document-registry/catalog.js';
import { renderAdminTools, loadTariffs, updateTariffSettings, TOOL_MAP, TOOL_CAPABILITY_BINDINGS, TOOL_COMMERCIAL_BINDINGS, visibleToolChildren } from './commercial-catalog.js';
import { enhanceCommercialTenantTools } from './commercial-tenant.js';
import { renderCommercialFinance } from './commercial-finance.js';
import { field, passwordField, initPasswordFields } from '../ui/inputs/index.js';
import { v2Sticker } from '../ui/v2/sticker.js';
import { v2Shell } from '../ui/v2/shell.js';
import { v2Header } from '../ui/v2/header.js';
import { v2CardDeck, v2NavigationIcon } from '../ui/v2/card-deck.js';
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
  section: 'overview',
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

// Poll only the accounts when their table is visible. Never recreate active
// role selectors or the registration-link editor just to refresh online labels.
async function refreshTenantNetwork() {
  const tenants = await adminRequest('/tenants');
  // A request started in Users must never redraw Users after navigation to Tools.
  if (state.section !== 'tenants' || !Array.isArray(tenants)) return;
  const content = app.querySelector('[data-content]');
  state.tenants = tenants;
  const liveRows = [...(content?.querySelectorAll('[data-tenant]') || [])];
  const liveIds = liveRows.map((row) => row.dataset.tenant);
  const nextIds = tenants.map((item) => item.tenantId);
  if (liveIds.length !== nextIds.length || liveIds.some((id) => !nextIds.includes(id))) {
    renderTenants();
    return;
  }
  const byId = new Map(tenants.map((item) => [item.tenantId, item]));
  liveRows.forEach((row) => {
    const fresh = byId.get(row.dataset.tenant);
    if (!fresh) return;
    const scratch = document.createElement('tbody');
    scratch.innerHTML = tenantRow(fresh);
    const updated = scratch.querySelector('[data-online-cell]');
    const current = row.querySelector('[data-online-cell]');
    if (current && updated) current.innerHTML = updated.innerHTML;
    // Keep a focused or pending edit untouched, but apply external role changes.
    const select = row.querySelector('[data-inline-tester]');
    if (select && !select.disabled && document.activeElement !== select) {
      select.value = String(Boolean(fresh.isTester));
      select.dataset.previous = select.value;
    }
  });
}

function startAdminPolling() {
  if (adminPollTimer) window.clearInterval(adminPollTimer);
  adminPollTimer = window.setInterval(async () => {
    if (document.visibilityState === 'hidden') return;
    try {
      if (state.section === 'tenants') await refreshTenantNetwork();
      else await refreshData();
    } catch {
      // Network presence and routine refresh must not interrupt the Admin UI.
    }
  }, 30_000);
}

function renderConnectionFailure(message = 'Не удалось связаться с сервером.') {
  stopAccountPresence();
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
  stopAccountPresence();
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
  // Shares the Professional backend heartbeat: no second online state or login work.
  // The first confirmed signal refreshes only the visible network cells.
  startAccountPresence({
    onForegroundReport: () => {
      if (state.section === 'tenants') void refreshTenantNetwork().catch(() => {});
    },
  });
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
  { id: 'tenants', label: 'Пользователи', icon: 'people' },
  { id: 'capabilities', label: 'Инструменты', icon: 'settings' },
  { id: 'tariffs', label: 'Тарифы', icon: 'tags' },
  { id: 'finance', label: 'Финансы', icon: 'finance' },
  { id: 'document-registry', label: 'Реестр документов', icon: 'documents' },
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
    stopAccountPresence();
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
    + ADMIN_SECTIONS.map((item) => '<button type="button" data-section="' + item.id + '">' + v2NavigationIcon(item.icon) + '<span>' + escapeHtml(item.label) + '</span></button>').join('')
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
  if (state.section === 'document-registry') {
    return renderDocumentRegistry(app.querySelector('[data-content]'), {
      escapeHtml,
      setTitle: setActiveSection,
      loadHistory: () => adminRequest('/document-registry/history'),
      loadCurrentDocuments: () => adminRequest('/document-registry/current'),
      loadDrafts: () => adminRequest('/document-registry/drafts'),
      saveDraft: (draft) => adminRequest('/document-registry/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      }),
      publishDraft: (key) => adminRequest('/document-registry/drafts/' + encodeURIComponent(key) + '/publish', {
        method: 'POST',
      }),
      loadVersions: () => adminRequest('/document-registry/versions'),
      // This published core endpoint already exists on the live backend and
      // returns source versions of the 3 Professional working templates.
      // The new Admin current endpoint may not yet be deployed there.
      loadWorkingTemplates: async () => {
        const response = await apiRequest('/tenant-document-archive/platform-bases');
        const items = await response.json().catch(() => []);
        if (!response.ok || !Array.isArray(items)) {
          throw new Error('Не удалось загрузить версии рабочих документов');
        }
        return items;
      },
      // Canonical global User agreement: public snapshot endpoint is already
      // used by the User registration flow, not the Professional template base.
      loadAccountTerms: async () => {
        const response = await apiRequest('/account/terms');
        if (!response.ok) throw new Error('Не удалось загрузить Условия аккаунта');
        return response.json();
      },
    });
  }
  if (state.section === 'capabilities') return renderCapabilities();
  if (state.section === 'tariffs') return renderTariffs();
  if (state.section === 'finance') return renderFinanceSection();
  renderTenants();
  // On section entry, refresh network cells independently of the 30s poll.
  void refreshTenantNetwork().catch(() => {});

}

// Dashboard state is local to Admin presentation; no new API, ledger or shadow counter.
let overviewWindowWeeks = 8;
let overviewDetailGroup = '';
let overviewUserStats = null;
let overviewUserStatsStatus = 'idle';
let overviewTariffData = null;
let overviewTariffStatus = 'idle';
let overviewSelectedTariff = '';
let overviewTariffMessage = '';

function requestOverviewTariffs(force = false) {
  // The isolated Overview contract tests evaluate this section without imports.
  if (typeof loadTariffs !== 'function') { overviewTariffStatus = 'unavailable'; return; }
  if (overviewTariffStatus === 'loading' || (!force && overviewTariffStatus !== 'idle')) return;
  overviewTariffStatus = 'loading';
  void loadTariffs(force)
    .then((data) => {
      overviewTariffData = data;
      overviewTariffStatus = 'ready';
    })
    .catch(() => {
      overviewTariffStatus = 'unavailable';
    })
    .finally(() => {
      if (state.section === 'tariffs') renderTariffs();
    });
}

if (typeof document !== 'undefined') document.addEventListener('admin:tariff-changed', () => {
  overviewTariffStatus = 'idle';
  overviewTariffData = null;
  if (state.section === 'tariffs') renderTariffs();
});

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

function renderTariffs() {
  setActiveSection('Тарифы');
  const content = app.querySelector('[data-content]');
  if (!content) return;
  const liveTariffs = overviewTariffStatus === 'ready' ? overviewTariffData?.tiers || [] : [];
  const tariffCards = [
    { key: 'tariff.start', name: 'Start' },
    { key: 'tariff.start-plus', name: 'Start+' },
    { key: 'tariff.pro', name: 'Pro' },
  ].map((tariff) => ({ ...tariff, ...liveTariffs.find((item) => item.key === tariff.key) }));
  const selectedTariff = tariffCards.find((item) => item.key === overviewSelectedTariff);
  const formatTariffPrice = (item) => item.key === 'tariff.start' ? '0 ₽'
    : Number(item.priceMinor) > 0
      ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(item.priceMinor) / 100) + ' ₽'
      : '—';

  content.innerHTML = `
    <div class="admin-overview admin-tariff-section">
      <div class="admin-heading"><h2>Тарифы</h2></div>
      <p class="admin-tariff-context">Состав и лимиты определяются в «Инструментах». Здесь настраиваются цена за 30 дней и бонусные дни.</p>
      <div class="admin-overview-tariffs-heading">
        <strong>Тарифы <span>/ Professional</span></strong>
        <span>Выберите Start+ или Pro для настройки цены и срока</span>
      </div>
      <section class="admin-overview-metrics admin-overview-tariff-metrics" aria-label="Тарифы Professional">
        ${tariffCards.map((item) => `
          <button type="button" class="admin-overview-metric${overviewSelectedTariff === item.key ? ' is-selected' : ''}"
            data-overview-tariff="${item.key}" aria-pressed="${overviewSelectedTariff === item.key}">
            <span class="admin-overview-metric-label">${item.name}</span>
            <strong class="admin-overview-metric-value">${formatTariffPrice(item)}</strong>
            <span class="admin-overview-metric-hint">Подключено: ${Number.isInteger(item.connected) ? item.connected : '—'}</span>
            <span class="admin-overview-metric-action" aria-hidden="true">↗</span>
          </button>`).join('')}
      </section>
      ${overviewSelectedTariff && overviewTariffStatus === 'unavailable' ? `
        <section class="admin-overview-detail"><p class="admin-overview-empty">Данные тарифов недоступны.</p></section>` : ''}
      ${overviewSelectedTariff && overviewTariffStatus === 'ready' && selectedTariff ? `
        <section class="admin-overview-detail" aria-label="Состав тарифа ${escapeHtml(selectedTariff.name)}">
          <div class="admin-overview-detail-heading">
            <div><strong>${escapeHtml(selectedTariff.name)}</strong></div>
            <button type="button" class="admin-overview-close" data-overview-tariff-close aria-label="Свернуть тариф">×</button>
          </div>
          ${selectedTariff.key !== 'tariff.start' ? `
            <div class="admin-overview-tariff-editor">
              <div class="admin-overview-tariff-controls">
                <label class="admin-field"><span>Цена за 30 дней, ₽</span>
                  <input type="number" min="0" step="0.01" inputmode="decimal" data-overview-tariff-price
                    value="${selectedTariff.priceMinor ? selectedTariff.priceMinor / 100 : ''}" placeholder="Цена не установлена">
                </label>
              </div>
              <div class="admin-overview-tariff-periods">
                <div class="admin-overview-tariff-period-row is-heading">
                  <span>Оплата</span><span>Бонус времени</span><span>Всего дней</span><span>Стоимость, ₽</span>
                </div>
                ${[1, 6, 12].map((months) => {
                  const period = selectedTariff.periods?.find((item) => item.months === months);
                  const percent = period?.bonusPercent ?? (months === 6 ? 20 : months === 12 ? 50 : 0);
                  const bonusDays = Math.round(months * 30 * percent / 100);
                  const fullDays = months * 30 + bonusDays;
                  return `<div class="admin-overview-tariff-period-row" data-overview-tariff-months="${months}">
                    <span>${months} ${months === 1 ? 'месяц' : 'месяцев'} <small>${months * 30} дней</small></span>
                    <span>${months === 1 ? '—' : `
                      <label class="admin-overview-tariff-percent">
                        <input type="number" min="0" max="100" step="1" inputmode="numeric"
                          data-overview-tariff-bonus="${months}" value="${percent}" aria-label="Бонус за ${months} месяцев"> %
                      </label>`}</span>
                    <span data-overview-tariff-days="${months}">${fullDays} дней${bonusDays ? ` (+${bonusDays})` : ''}</span>
                    <span data-overview-tariff-sum="${months}">${selectedTariff.priceMinor
                      ? escapeHtml(new Intl.NumberFormat('ru-RU').format(selectedTariff.priceMinor * months / 100)) + ' ₽'
                      : '—'}</span>
                  </div>`;
                }).join('')}
              </div>
              <div class="admin-overview-tariff-footer">
                <button type="button" class="admin-button" data-overview-tariff-save="${selectedTariff.key}">Сохранить тариф</button>
                <span class="admin-inline-message" data-overview-tariff-message aria-live="polite">${escapeHtml(overviewTariffMessage)}</span>
              </div>
            </div>` : '<p class="admin-overview-tariff-free">Бесплатный LIVE Start без ограничения срока. Цена и бонусы не требуются.</p>'}
          <div class="admin-overview-tariff-tools-heading">
            <strong>Состав тарифа</strong>
            <button type="button" class="admin-overview-inline-link" data-overview-section="capabilities">Настроить в «Инструментах» <span aria-hidden="true">↗</span></button>
          </div>
          <div class="admin-overview-detail-list admin-overview-tariff-list">
            ${selectedTariff.tools?.length ? selectedTariff.tools.map((tool) => `
              <div class="admin-overview-person">
                <span><strong>${escapeHtml(tool.name)}</strong></span>
              </div>`).join('') : '<p class="admin-overview-empty">Инструменты не назначены.</p>'}
          </div>
        </section>` : ''}

    </div>`;
  if (overviewTariffStatus === 'idle') requestOverviewTariffs();
  content.querySelectorAll('[data-overview-tariff]').forEach((button) => {
    button.addEventListener('click', () => {
      overviewSelectedTariff = overviewSelectedTariff === button.dataset.overviewTariff ? '' : button.dataset.overviewTariff;
      overviewDetailGroup = '';
      overviewTariffMessage = '';
      renderOverview();
    });
  });
  content.querySelector('[data-overview-tariff-close]')?.addEventListener('click', () => {
    overviewSelectedTariff = '';
    renderOverview();
  });
  const tariffPriceInput = content.querySelector('[data-overview-tariff-price]');
  const tariffBonusInputs = [...content.querySelectorAll('[data-overview-tariff-bonus]')];
  const refreshTariffPreview = () => {
    const amount = Number(String(tariffPriceInput?.value || '').replace(',', '.'));
    const validPrice = tariffPriceInput?.value !== '' && Number.isFinite(amount) && amount > 0;
    for (const months of [1,6,12]) {
      const bonus = months === 1 ? 0 :
        Number(content.querySelector('[data-overview-tariff-bonus="' + months + '"]')?.value || 0);
      const safeBonus = Number.isFinite(bonus) && bonus >= 0 ? bonus : 0;
      const gift = Math.round(months * 30 * safeBonus / 100);
      const days = content.querySelector('[data-overview-tariff-days="' + months + '"]');
      const cost = content.querySelector('[data-overview-tariff-sum="' + months + '"]');
      if (days) days.textContent = (months * 30 + gift) + ' дней' + (gift ? ' (+' + gift + ')' : '');
      if (cost) cost.textContent = validPrice
        ? new Intl.NumberFormat('ru-RU', {maximumFractionDigits:2}).format(amount * months) + ' ₽' : '—';
    }
  };
  tariffPriceInput?.addEventListener('input', refreshTariffPreview);
  tariffBonusInputs.forEach((input) => input.addEventListener('input', refreshTariffPreview));
  content.querySelector('[data-overview-tariff-save]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const message = content.querySelector('[data-overview-tariff-message]');
    const rawPrice = String(tariffPriceInput?.value || '').trim();
    const price = rawPrice ? Number(rawPrice.replace(',', '.')) : 0;
    const priceMinor = Math.round(price * 100);
    const bonus6 = Number(content.querySelector('[data-overview-tariff-bonus="6"]')?.value);
    const bonus12 = Number(content.querySelector('[data-overview-tariff-bonus="12"]')?.value);
    const validBonuses = [bonus6,bonus12].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 100);
    if (!Number.isFinite(price) || price < 0 || Math.abs(price * 100 - priceMinor) > 0.000001 || !validBonuses) {
      if (message) { message.textContent = 'Проверьте цену и бонусы (0–100%)'; message.classList.add('error'); }
      return;
    }
    button.disabled = true;
    if (message) { message.textContent = 'Сохранение…'; message.classList.remove('error'); }
    try {
      overviewTariffData = await updateTariffSettings(button.dataset.overviewTariffSave, priceMinor, bonus6, bonus12);
      overviewTariffStatus = 'ready';
      overviewTariffMessage = priceMinor > 0 ? 'Тариф сохранён' : 'Бонусы сохранены; цена ещё не установлена';
      renderOverview();
    } catch (error) {
      if (message) { message.textContent = error instanceof Error ? error.message : 'Не удалось сохранить тариф'; message.classList.add('error'); }
      button.disabled = false;
    }
  });

  content.querySelectorAll('[data-overview-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = button.dataset.overviewSection;
      renderCurrentSection();
    });
  });
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
    { key: 'registered', value: registered.length, title: 'Зарегистрированы', hint: 'Всего аккаунтов', theme: 'primary' },
    { key: 'demo', value: demo.length, title: 'DEMO', hint: 'Пробный режим' },
    { key: 'live', value: live.length, title: 'LIVE', hint: 'Рабочий режим' },
    { key: 'pending', value: pending.length, title: 'Ожидают', hint: 'Завершения регистрации' },
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
            <span class="admin-overview-metric-hint">${item.hint}</span>
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
            <span class="admin-overview-metric-hint">Всего аккаунтов</span>
          </div>
          <div class="admin-overview-metric">
            <span class="admin-overview-metric-label">Новые</span>
            <strong class="admin-overview-metric-value">${userStats ? userStats.newLast30Days : '—'}</strong>
            <span class="admin-overview-metric-hint">За последние 30 дней</span>
          </div>
          <div class="admin-overview-metric">
            <span class="admin-overview-metric-label">Входили</span>
            <strong class="admin-overview-metric-value">${userStats ? userStats.loggedInLast30Days : '—'}</strong>
            <span class="admin-overview-metric-hint">С входом за 30 дней</span>
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
      overviewSelectedTariff = '';
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

function openDeleteTenantModal(tenantId, onDeleted = () => {}) {
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
      onDeleted();
      await refreshData();
      renderTenants();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : 'Не удалось удалить пользователя';
      control.disabled = false;
      control.textContent = 'Удалить';
    }
  });
}

// Reuse the account capability hierarchy for invitations; never maintain a second tool catalog.
const selectedRegistrationToolKeys = new Set();

function syncRegistrationLinkAction(root) {
  const button = root?.querySelector('[data-create-invite-link]');
  if (button && button.dataset.pending !== 'true') {
    button.disabled = selectedRegistrationToolKeys.size === 0;
  }
}

function openRegistrationToolDrawer() {
  const resolved = new Map(state.capabilities.map((capability) => [
    capability.key, { enabled: selectedRegistrationToolKeys.has(capability.key), limit: null },
  ]));
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="admin-drawer admin-document-drawer" role="dialog" aria-modal="true" aria-label="Инструменты регистрации">
      <div class="admin-drawer-head">
        <div><h3>Инструменты регистрации</h3><p>Доступ нового аккаунта</p></div>
        <button type="button" class="admin-close" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="admin-document-reading">
        <div data-capability-order-list>${renderTenantRegistry(resolved, { isTester: true })}</div>
        <div class="admin-inline-actions">
          <button type="button" class="admin-button" data-apply-invite>Применить</button>
        </div>
      </div>
    </aside>`;
  // Registration links accept Boolean capability switches, never capacity overrides.
  backdrop.querySelectorAll('[data-type="LIMIT"]').forEach((input) => {
    input.closest('.admin-access-inline-limit')?.remove();
  });
  const sharedQ = Boolean(app.querySelector('.admin-mobile-app'));
  if (sharedQ) {
    const html = modal(backdrop.innerHTML, { title: 'Инструменты', variant: 'q', className: 'admin-access-q admin-document-q' });
    const mounted = mountModal(app.querySelector('[data-v2-app]'), html);
    if (!mounted) return;
    backdrop = mounted;
  } else document.body.append(backdrop);
  const close = () => { if (sharedQ) backdrop.v2Close?.(); else backdrop.remove(); };
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.classList.toggle('is-on');
      button.dataset.current = String(button.classList.contains('is-on'));
      button.setAttribute('aria-checked', button.dataset.current);
    });
  });
  backdrop.querySelectorAll('[data-toggle-group]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      const enabled = button.getAttribute('aria-checked') !== 'true';
      button.setAttribute('aria-checked', String(enabled));
      button.classList.toggle('is-on', enabled);
      button.closest('.admin-access-grant-group').querySelectorAll('[data-capability][data-type="BOOLEAN"]')
        .forEach((input) => { input.dataset.current = String(enabled); });
    });
  });
  backdrop.querySelector('[data-apply-invite]')?.addEventListener('click', () => {
    selectedRegistrationToolKeys.clear();
    backdrop.querySelectorAll('[data-capability][data-type="BOOLEAN"][data-current="true"]')
      .forEach((button) => selectedRegistrationToolKeys.add(button.dataset.capability));
    close();
    const content = app.querySelector('[data-content]');
    syncRegistrationLinkAction(content);
    const oldLink = content.querySelector('[data-invite-link]');
    if (oldLink) oldLink.hidden = true;
    const linkValue = content.querySelector('[data-invite-link-value]');
    if (linkValue) linkValue.value = '';
    const message = content.querySelector('[data-invite-message]');
    if (message) {
      message.textContent = '';
      message.classList.remove('error');
      message.hidden = true;
    }
  });
}

function renderFinanceSection() {
  setActiveSection('Финансы');
  const content = app.querySelector('[data-content]');
  if (!content) return;
  content.innerHTML = '<div class="admin-heading"><h2>Финансы</h2></div>' +
    '<section class="admin-card admin-empty-card">Загружаем счета и платежи…</section>';
  void adminRequest('/finance/overview')
    .then((data) => {
      if (state.section !== 'finance') return;
      const tenantName = (id) => {
        const entry = state.tenants.find((item) => item.tenantId === id);
        return entry?.ownerProfile?.name || entry?.invitation?.name || entry?.tenantName || id;
      };
      renderCommercialFinance(content, data, {
        escapeHtml, tenantName,
        onTenant: (tenantId) => {
          state.section = 'tenants';
          renderCurrentSection();
          openAccessDrawer(tenantId);
        },
      });
    })
    .catch((error) => {
      if (state.section !== 'finance') return;
      content.innerHTML = '<div class="admin-heading"><h2>Финансы</h2></div>' +
        '<section class="admin-card admin-empty-card" role="alert">' +
        escapeHtml(error instanceof Error ? error.message : 'Данные финансов недоступны') + '</section>';
    });
}

function renderTenants() {
  setActiveSection('Пользователи');
  const content = app.querySelector('[data-content]');
  const owner = state.tenants.find((item) => item.isOwnerBook);
  const tenants = state.tenants.filter((item) => !item.isOwnerBook);
  content.innerHTML = `
    <div class="admin-users-layout">
      <section class="admin-users-section" aria-labelledby="admin-registration-link-title">
        <h2 class="admin-users-section-title" id="admin-registration-link-title">Регистрационная ссылка</h2>
        <div class="admin-invite-panel">
          <div class="admin-invite-strip" data-invite-strip>
            <button class="admin-invite-open" type="button" data-configure-invite-tools aria-label="Настроить инструменты нового аккаунта">
              <span>Инструменты</span><span class="admin-invite-arrow" aria-hidden="true">›</span>
            </button>
            <button class="admin-button admin-invite-create" type="button" data-create-invite-link disabled>Создать ссылку</button>
          </div>
          <div class="admin-invite-link" data-invite-link hidden>
            <input class="admin-invite-link-value" type="text" readonly data-invite-link-value aria-label="Ссылка для регистрации">
            <button class="admin-button secondary" type="button" data-copy-invite-link>Копировать</button>
          </div>
          <p class="admin-inline-message" data-invite-message role="status" hidden></p>
        </div>
      </section>
      <section class="admin-users-section" aria-labelledby="admin-my-account-title">
        <h2 class="admin-users-section-title" id="admin-my-account-title">Мой аккаунт</h2>
        <div class="admin-card">
          <table class="admin-table admin-accounts-table">
            <thead><tr><th>Пользователь</th><th>Роль</th><th>Режим</th><th>Тариф</th><th>Доступ</th><th>В сети</th></tr></thead>
            <tbody>${owner ? tenantRow(owner) : '<tr><td colspan="6">Административный аккаунт не найден.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      <section class="admin-users-section" aria-labelledby="admin-all-users-title">
        <h2 class="admin-users-section-title" id="admin-all-users-title">Все пользователи</h2>
        <div class="admin-card">
          <table class="admin-table admin-accounts-table">
            <thead><tr><th>Пользователь</th><th>Роль</th><th>Режим</th><th>Тариф</th><th>Доступ</th><th>В сети</th></tr></thead>
            <tbody>${tenants.map(tenantRow).join('') || '<tr><td colspan="6">Пока нет других пользователей.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
    </div>`;

  const message = content.querySelector('[data-invite-message]');
  const createLinkButton = content.querySelector('[data-create-invite-link]');
  const inviteLinkBox = content.querySelector('[data-invite-link]');
  const inviteLinkInput = content.querySelector('[data-invite-link-value]');
  const copyLinkButton = content.querySelector('[data-copy-invite-link]');

  syncRegistrationLinkAction(content);
  content.querySelector('[data-invite-strip]')?.addEventListener('click', (event) => {
    if (!event.target.closest('[data-create-invite-link]')) openRegistrationToolDrawer();
  });

  createLinkButton?.addEventListener('click', async (event) => {
    event.stopPropagation();
    const tools = [...selectedRegistrationToolKeys];
    // Disabled until the modal applies at least one tool. No error and no modal.
    if (createLinkButton.disabled || !tools.length) return;
    message.textContent = '';
    message.classList.remove('error');
    message.hidden = true;
    createLinkButton.dataset.pending = 'true';
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
      // The link already exists; a background list refresh cannot turn success into an error.
      void refreshData().catch(() => {});
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось создать ссылку';
      message.classList.add('error');
      message.hidden = false;
    } finally {
      delete createLinkButton.dataset.pending;
      createLinkButton.textContent = 'Создать ссылку';
      syncRegistrationLinkAction(content);
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
    row.addEventListener('keydown', (event) => {
      if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
      event.preventDefault();
      openAccessDrawer(row.dataset.tenant);
    });
  });
  // This selector changes only the tester flag; capability overrides stay untouched.
  content.querySelectorAll('[data-inline-tester]').forEach((select) => {
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('keydown', (event) => event.stopPropagation());
    select.addEventListener('change', async (event) => {
      event.stopPropagation();
      const row = select.closest('[data-tenant]');
      const tenantId = row?.dataset.tenant;
      const previous = select.dataset.previous === 'true';
      if (!tenantId) return;
      const next = select.value === 'true';
      const errorLabel = row.querySelector('[data-tester-error]');
      if (errorLabel) { errorLabel.hidden = true; errorLabel.textContent = ''; }
      if (next === previous) return;
      select.disabled = true;
      try {
        await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isTester: next }),
        });
        const tenant = state.tenants.find((item) => item.tenantId === tenantId);
        if (tenant) tenant.isTester = next;
        select.dataset.previous = String(next);
      } catch (error) {
        select.value = String(previous);
        if (errorLabel) {
          errorLabel.textContent = error instanceof Error ? error.message : 'Не удалось изменить статус';
          errorLabel.hidden = false;
        }
      } finally {
        if (select.isConnected) select.disabled = false;
      }
    });
  });
}

function tenantRow(item) {
  const pending = !item.ownerProfile && item.invitation?.status === 'PENDING';
  const name = item.ownerProfile?.name || item.invitation?.name || item.tenantName || 'Без имени';
  const email = item.ownerProfile?.email || item.invitation?.email || '';
  const displayedEmail = email.endsWith('@registration.invalid') ? '' : email;
  const mode = String(item.access?.commercialMode || 'DEMO');
  const accessClass = item.status === 'SUSPENDED' ? 'suspended' : pending ? 'pending' : 'active';
  const accessLabel = item.status === 'SUSPENDED' ? 'Отключён'
    : pending ? 'Ждёт регистрации'
    : item.ownerProfile ? 'Разрешён' : 'Не зарегистрирован';
  const testerOptions = item.isOwnerBook ? '' : `<span class="admin-inline-role-editor"><select class="admin-inline-role-select" data-inline-tester
      data-previous="${Boolean(item.isTester)}" aria-label="Тестировщик: ${escapeHtml(name)}">
      <option value="false"${item.isTester ? '' : ' selected'}>—</option>
      <option value="true"${item.isTester ? ' selected' : ''}>Тестировщик</option>
    </select><small data-tester-error class="admin-inline-error" role="alert" hidden></small></span>`;
  let network = '—';
  if (item.ownerProfile && typeof item.presence?.online === 'boolean') {
    const connected = item.presence.online;
    const rawLastVisit = item.presence.lastSeenAt ? new Date(item.presence.lastSeenAt) : null;
    const lastVisit = rawLastVisit && Number.isFinite(rawLastVisit.getTime())
      ? rawLastVisit.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '')
      : '';
    // Only desktop/iPad changes presentation here; mobile Admin retains its current
    // status detail until the separately planned mobile redesign.
    const mobile = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(max-width: 760px)').matches;
    const rawTime = mobile ? Number(item.presence.totalOnlineMs) : 0;
    const minutes = Number.isFinite(rawTime) && rawTime >= 60_000 ? Math.floor(rawTime / 60_000) : 0;
    const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} ч${minutes % 60 ? ` ${minutes % 60} мин` : ''}`
      : minutes ? `${minutes} мин` : '';
    // lastSeenAt is a verified activity timestamp, not necessarily login time.
    const detail = mobile ? [lastVisit, duration].filter(Boolean).join(' — ') : lastVisit;
    network = `<span class="admin-account-presence ${connected ? 'is-online' : 'is-offline'}">${connected ? 'В сети' : 'Не в сети'}</span>
      ${detail ? `<small class="admin-network-detail"${mobile ? '' : ' title="Последняя активность"'}>${escapeHtml(detail)}</small>` : ''}`;
  }
  return `<tr data-tenant="${escapeHtml(item.tenantId)}" tabindex="0" role="button" aria-label="Открыть аккаунт ${escapeHtml(name)}">
    <td data-label="Пользователь"><strong>${escapeHtml(name)}</strong>${displayedEmail ? `<small class="admin-account-email">${escapeHtml(displayedEmail)}</small>` : ''}</td>
    <td data-label="Роль">${item.isOwnerBook ? 'Администратор' : 'Пользователь'}${testerOptions}</td>
    <td data-label="Режим"><span class="admin-pill ${mode === 'LIVE' ? 'active' : 'pending'}">${escapeHtml(mode)}</span></td>
    <td data-label="Тариф">${escapeHtml(item.plan?.name || '—')}</td>
    <td data-label="Доступ"><span class="admin-pill ${accessClass}">${accessLabel}</span></td>
    <td data-label="В сети" data-online-cell>${network}</td>
  </tr>`;
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

// A single catalog and capability binding power both the main Tools registry and
// this compact account presentation. Access permissions remain owned by Core.
function toolReadable(item, readonly, tenant) {
  if (readonly) return false;
  const key = String(item.readinessKey || '');
  // Workplace creation is governed by its account grant, not by readiness.
  if (!key || key === 'cabinet.profile.workspaces') {
    if (item.id !== 'service') return true;
  }
  const mode = String(tenant?.access?.commercialMode || 'DEMO').toUpperCase();
  const allowed = (status) => status === 'READY' ||
    (status === 'TESTING' && Boolean(mode === 'DEMO' || tenant?.isTester || tenant?.isOwnerBook));
  // Service has one actual services.access grant, and two independent mode statuses.
  if (item.id === 'service' && !key) {
    return ['cabinet.service.procedures', 'cabinet.service.products']
      .some((modeKey) => allowed(state.toolReadiness.find((row) => row.key === modeKey)?.status));
  }
  return allowed(state.toolReadiness.find((row) => row.key === key)?.status || 'NOT_READY');
}

function toolName(item) {
  if (item.readinessKey === 'cabinet.profile.workspaces') return 'Рабочее пространство';
  return String(item.label || '').startsWith('График (') ? 'График' : String(item.label || '');
}

function toolChildren(area, item) {
  // Commercial K tools are configured in Tools, not duplicated in an
  // individual account's capability hierarchy.
  return visibleToolChildren(area, item).filter((child) => child.kind !== 'check');
}

// Same F/E/R visible hierarchy as the Tools registry. K components are metadata,
// not independently selectable rows. Their Core readiness records are untouched.
function accountToolKey(area, item, parentKey = '') {
  if (item.readinessKey) return item.readinessKey;
  if (item.id) return area + '.' + item.id;
  if (parentKey === 'cabinet.finance' && item.label === 'Касса') return 'cabinet.finance.cash';
  return parentKey + '.' + String(item.label || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-');
}

function accountToolKind(item, depth) {
  return depth === 0 ? 'F' : item.kind === 'e' ? 'E' : 'R';
}

function toolControl(capability, resolved, locked) {
  if (!capability) return '';
  if (capability.valueType === 'LIMIT') {
    const value = resolved?.limit == null ? '' : String(resolved.limit);
    return '<input class="admin-limit" type="number" min="0" data-capability="' +
      escapeHtml(capability.key) + '" data-type="LIMIT" data-original="' + escapeHtml(value) +
      '" value="' + escapeHtml(value) + '" placeholder="∞" aria-label="Количество рабочих пространств"' +
      (locked ? ' disabled' : '') + '>';
  }
  const enabled = resolved?.enabled !== false;
  return '<button type="button" class="admin-toggle' + (enabled ? ' is-on' : '') +
    '" data-toggle data-capability="' + escapeHtml(capability.key) +
    '" data-type="BOOLEAN" data-original="' + enabled + '" data-current="' + enabled +
    '" role="switch" aria-checked="' + enabled + '" aria-label="' + escapeHtml(capability.name) +
    '"' + (locked ? ' disabled' : '') + '></button>';
}

function toolControls(item, resolved, tenant, key, parentKey, hasChildren, seen) {
  const keys = [
    ...(item.capabilityKey ? [String(item.capabilityKey)] : []),
    ...(TOOL_CAPABILITY_BINDINGS[key] || []),
  ];
  // Several catalog rows share one Core capability (Cash/Wallets, Loans/DDS).
  // Show each grant exactly once or simultaneous edits would conflict.
  const caps = [...new Set(keys)]
    .filter((capabilityKey) => !seen.has(capabilityKey))
    .map((capabilityKey) => state.capabilities.find((row) => row.key === capabilityKey))
    .filter(Boolean);
  caps.forEach((capability) => seen.add(capability.key));
  const disabled = !toolReadable(item, false, tenant);
  const grants = caps.filter((cap) => cap.valueType !== 'LIMIT');
  const limit = caps.find((cap) => cap.valueType === 'LIMIT');
  if (!grants.length) {
    // K components and R modes without independent Core entitlements inherit
    // the parent availability. A disabled switch conveys inherited state without
    // pretending this component has a separately writable capability.
    const inherited = TOOL_CAPABILITY_BINDINGS[parentKey] || [];
    const inheritedEnabled = inherited.some((grantKey) => resolved.get(grantKey)?.enabled === true);
    const available = toolReadable(item, false, tenant);
    const inheritedSwitch = !hasChildren && item.readinessKey
      ? '<button type="button" class="admin-toggle' + (inheritedEnabled && available ? ' is-on' : '') +
        '" disabled role="switch" aria-checked="' + String(inheritedEnabled && available) +
        '" aria-label="' + escapeHtml(toolName(item)) +
        ': доступ наследуется, отдельного переключателя нет" title="Доступ наследуется от родительского инструмента"></button>'
      : '';
    return { grant: inheritedSwitch, limit: limit ? toolControl(limit, resolved.get(limit.key), disabled) : '' };
  }
  if (grants.length === 1) return {
    grant: toolControl(grants[0], resolved.get(grants[0].key), disabled),
    limit: limit ? toolControl(limit, resolved.get(limit.key), disabled) : '',
  };
  // A composite E-row is one instrument. One UI switch drives all of its
  // existing Boolean capability keys; the data model is not replaced.
  const enabled = grants.every((cap) => resolved.get(cap.key)?.enabled !== false);
  const hidden = grants.map((cap) =>
    '<input type="hidden" data-capability="' + escapeHtml(cap.key) +
    '" data-type="BOOLEAN" data-original="' + String(resolved.get(cap.key)?.enabled !== false) +
    '" data-current="' + String(resolved.get(cap.key)?.enabled !== false) + '">').join('');
  return {
    grant: '<span class="admin-access-grant-group">' + hidden +
      '<button type="button" class="admin-toggle' + (enabled ? ' is-on' : '') +
      '" data-toggle-group role="switch" aria-checked="' + enabled +
      '" aria-label="' + escapeHtml(toolName(item)) + '"' + (disabled ? ' disabled' : '') + '></button></span>',
    limit: limit ? toolControl(limit, resolved.get(limit.key), disabled) : '',
  };
}

function accountToolRow(item, resolved, tenant, area, depth, parentKey, hasChildren, allowCommercial, seen) {
  const key = accountToolKey(area, item, parentKey);
  const kind = accountToolKind(item, depth);
  const { grant, limit } = toolControls(item, resolved, tenant, key, parentKey, hasChildren, seen);
  const locked = !toolReadable(item, false, tenant);
  // Commercial conditions use the same row as the actual tool. The tenant
  // commercial service fills these slots; it never creates a second list.
  const product = allowCommercial ? (TOOL_COMMERCIAL_BINDINGS[key] || '') : '';
  const title = '<span class="admin-access-tool-name">' + escapeHtml(toolName(item)) + '</span>';
  return '<span class="admin-access-tool-row' + (locked && grant ? ' is-unavailable' : '') +
    '" data-tool-kind="' + kind + '" data-tool-depth="' + depth + '" data-tool-key="' + escapeHtml(key) + '">' +
    '<span class="admin-access-tool-identity">' + title + (limit ? '<span class="admin-access-inline-limit">' + limit + '</span>' : '') + '</span>' +
    '<span class="admin-access-tool-commercial"' + (product ? ' data-commercial-slot="' + escapeHtml(product) + '"' : '') + '></span>' +
    '<span class="admin-access-tool-grant">' + grant + '</span>' +
    '</span>';
}

function renderRegistrySection(item, resolved, tenant = null, area = 'cabinet', depth = 0, parentKey = '', allowCommercial = true, seen = new Set()) {
  const key = accountToolKey(area, item, parentKey);
  const children = toolChildren(area, item);
  const row = accountToolRow(item, resolved, tenant, area, depth, parentKey, children.length > 0, allowCommercial, seen);
  if (!children.length) return row;
  // The row itself is the disclosure summary. Never repeat the parent label.
  return '<details class="admin-access-tool-group" open><summary class="admin-access-tool-group-title">' +
    row + '</summary><div class="admin-access-tool-group-body">' +
    children.map((child) => renderRegistrySection(child, resolved, tenant, area, depth + 1, key, allowCommercial, seen)).join('') +
    '</div></details>';
}

function renderTenantRegistry(resolved, tenant = null, allowCommercial = true) {
  const seen = new Set();
  return '<div class="admin-access-tool-category" data-account-tools="professional">' +
    '<div class="admin-access-tool-head"><span>Кабинет / Professional</span><span>' +
      (allowCommercial ? 'Условия' : '') + '</span><span>Доступ</span></div>' +
    TOOL_MAP.cabinet.map((item) => renderRegistrySection(item, resolved, tenant, 'cabinet', 0, '', allowCommercial, seen)).join('') +
    '</div>';
}

function openAccessDrawer(tenantId) {
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant) return;
  const resolved = new Map((tenant.access?.capabilities || []).map((item) => [item.key, item]));
  const mode = String(tenant.access?.commercialMode || 'DEMO');
  const demoActivated = tenant.access?.demoActivatedAt || tenant.invitation?.activatedAt || '';
  const demoExpires = tenant.access?.demoExpiresAt || tenant.invitation?.demoExpiresAt || '';
  const personName = tenant.ownerProfile?.name || tenant.invitation?.name || tenant.tenantName || 'Пользователь';
  const personEmail = tenant.ownerProfile?.email || tenant.invitation?.email || '';
  let backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop admin-document-drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="admin-drawer admin-document-drawer admin-access-drawer" role="dialog" aria-modal="true" aria-label="Управление доступом пользователя">
      <div class="admin-drawer-head">
        <div><h3>${escapeHtml(personName)}</h3><p>${escapeHtml(personEmail)}</p></div>
        <button type="button" class="admin-close" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="admin-document-reading">
        <div class="admin-access-summary">
          <div class="admin-overview-metric admin-access-summary-card">
            <span class="admin-overview-metric-label">Режим</span>
            <strong class="admin-access-summary-value">${escapeHtml(mode)}</strong>
            <span class="admin-access-summary-detail">${mode === 'DEMO'
              ? demoExpires ? 'До ' + escapeHtml(formatAdminMoment(demoExpires)) : 'До активации'
              : 'Рабочий доступ'}</span>
          </div>
          <div class="admin-overview-metric admin-access-summary-card">
            <span class="admin-overview-metric-label">Роль</span>
            <strong class="admin-access-summary-value" data-tester-label>${tenant.isOwnerBook ? 'Администратор' : tenant.isTester ? 'Тестировщик' : 'Пользователь'}</strong>
            ${tenant.isOwnerBook ? '' : `<button type="button" class="admin-toggle admin-access-role-toggle${tenant.isTester ? ' is-on' : ''}"
              role="switch" aria-label="Тестировщик" aria-checked="${tenant.isTester ? 'true' : 'false'}"
              data-tester-toggle></button>`}
          </div>
        </div>
        <section class="admin-section admin-access-tools">
          <h4>Инструменты</h4>
          <div data-capability-order-list>${renderTenantRegistry(resolved, tenant)}</div>
          <div class="admin-inline-actions admin-access-save-actions">
            <button type="button" class="admin-button" data-save>Сохранить доступ</button>
          </div>
          <p class="admin-inline-message" data-save-message role="status"></p>
          ${tenant.isOwnerBook ? '' : `<section class="admin-access-tool-conditions">
            <h4>Условия и оплата</h4>
            <div class="commercial-tenant-section" data-commercial-tenant-tools></div>
          </section>`}
        </section>
        ${tenant.isOwnerBook ? '' : `<section class="admin-section admin-access-account-actions">
          <h4>Управление аккаунтом</h4>
          <div class="admin-inline-actions">
            <button type="button" class="admin-button ${tenant.status === 'SUSPENDED' ? 'secondary' : 'danger'}" data-status>${tenant.status === 'SUSPENDED' ? 'Включить пространство' : 'Отключить пространство'}</button>
            <button type="button" class="admin-button danger" data-delete-account>Удалить аккаунт</button>
          </div>
        </section>`}
        ${tenant.ownerProfile?.email ? `<section class="admin-section admin-access-email">
          <h4>Написать email</h4>
          <form class="admin-form" data-technical-email-form>
            <label class="admin-field"><span>Тема</span><input name="subject" maxlength="200" required></label>
            <label class="admin-field"><span>Сообщение</span><textarea name="body" rows="5" maxlength="20000" required></textarea></label>
            <button class="admin-button" type="submit">Отправить письмо</button>
            <p class="admin-inline-message" data-technical-email-message role="status"></p>
          </form>
        </section>` : ''}
      </div>
    </aside>`;
  const sharedQ = Boolean(app.querySelector('.admin-mobile-app'));
  if (sharedQ) {
    const html = modal(backdrop.innerHTML, { title: personName, variant: 'q', className: 'admin-access-q admin-document-q' });
    const mounted = mountModal(app.querySelector('[data-v2-app]'), html);
    if (!mounted) return;
    backdrop = mounted;
  } else document.body.append(backdrop);

  if (!tenant.isOwnerBook) void enhanceCommercialTenantTools(backdrop.querySelector('[data-commercial-tenant-tools]'), tenantId);

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
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault(); // A switch must not collapse its F/E/R parent.
      if (button.disabled) return;
      button.classList.toggle('is-on');
      button.dataset.current = button.classList.contains('is-on') ? 'true' : 'false';
      button.setAttribute('aria-checked', button.dataset.current);
    });
  });
  backdrop.querySelectorAll('[data-toggle-group]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (button.disabled) return;
      const on = button.getAttribute('aria-checked') !== 'true';
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-checked', String(on));
      button.closest('.admin-access-grant-group').querySelectorAll('[data-capability][data-type="BOOLEAN"]')
        .forEach((input) => { input.dataset.current = String(on); });
    });
  });
  // Capacity input sits inside the parent summary; editing must not collapse it.
  backdrop.querySelectorAll('.admin-access-inline-limit input').forEach((input) => {
    input.addEventListener('click', (event) => event.stopPropagation());
    input.addEventListener('keydown', (event) => event.stopPropagation());
  });

  backdrop.querySelector('[data-delete-account]')?.addEventListener('click', () => openDeleteTenantModal(tenantId, close));

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

    const testerChanged = !tenant.isOwnerBook && (testerToggle?.getAttribute('aria-checked') === 'true') !== Boolean(tenant.isTester);
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
