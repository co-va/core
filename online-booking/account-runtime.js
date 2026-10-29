import {
  bindAccountTelegramEntry,
  clearAccount,
  getAccountToken,
  resolveAccountTelegramEntry,
} from '../core/account/index.js';
import {
  enableWebPush,
  getWebPushState,
  shouldOfferWebPushSetup,
  syncWebPush,
  webPushFailureMessage,
} from '../core/notifications/web-push.js';
import { button, escapeHtml, modal, mountModal } from '../ui/ui.js';

function removeTelegramEntryFromUrl({ removeBooking = false } = {}) {
  const url = new URL(location.href);
  if (!url.searchParams.has('tg_entry') && (!removeBooking || !url.searchParams.has('booking'))) return;
  url.searchParams.delete('tg_entry');
  if (removeBooking) url.searchParams.delete('booking');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function continueTelegramEntryToBooking(tenantId) {
  const tenant = String(tenantId || '').trim();
  if (!tenant) return;
  const url = new URL(location.href);
  url.searchParams.delete('tg_entry');
  url.searchParams.set('booking', tenant);
  url.searchParams.set('entry', 'account-booking');
  location.replace(`${url.pathname}${url.search}${url.hash}`);
}

function rootTelegramEntryRoute() {
  if (typeof window === 'undefined') return null;
  const path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  if (path !== '/') return null;
  const params = new URLSearchParams(location.search);
  const tenantId = String(params.get('booking') || '').trim();
  const telegramEntry = String(params.get('tg_entry') || '').trim();
  return tenantId && telegramEntry ? { tenantId, telegramEntry } : null;
}

export async function startAccountRuntime({
  tenantId = '',
  telegramEntry = '',
  onTelegramEntryCompleted = null,
} = {}) {
  const tenant = String(tenantId || '').trim();
  const entry = String(telegramEntry || '').trim();
  if (!tenant) return () => {};

  let telegramAttempted = !entry;
  let telegramReadyForBind = false;
  let telegramResolving = false;
  let disposed = false;

  const completeTelegramEntry = () => {
    telegramAttempted = true;
    removeTelegramEntryFromUrl();
    if (typeof onTelegramEntryCompleted === 'function') onTelegramEntryCompleted();
  };

  async function resolveTelegramEntry() {
    if (disposed || telegramAttempted || telegramReadyForBind || telegramResolving || !entry) return;
    telegramResolving = true;
    try {
      const resolved = await resolveAccountTelegramEntry(tenant, entry);
      if (resolved?.exists && resolved?.accessToken) {
        completeTelegramEntry();
        return;
      }

      clearAccount(tenant);
      telegramReadyForBind = true;
    } catch {
      // Do not bind an unresolved Telegram ticket to an arbitrary existing browser session.
    } finally {
      telegramResolving = false;
    }
  }

  async function bindTelegramWhenAuthenticated() {
    if (disposed || telegramAttempted || !telegramReadyForBind || !getAccountToken(tenant)) return;
    try {
      await bindAccountTelegramEntry(tenant, entry);
      completeTelegramEntry();
    } catch {
      // Keep retry available while the one-time entry token is still valid.
    }
  }

  await resolveTelegramEntry();
  const interval = window.setInterval(() => {
    void resolveTelegramEntry();
    void bindTelegramWhenAuthenticated();
  }, 1500);
  void bindTelegramWhenAuthenticated();

  return () => {
    disposed = true;
    window.clearInterval(interval);
  };
}

function accountAppReady() {
  return Boolean(document.querySelector('[data-v2-app] [data-account-deck-item]'));
}

function pushSetupModal(initialStatus = '') {
  return `<div class="modal-title">
    <h2>Уведомления на телефоне</h2>
    <p>Включите уведомления, чтобы узнавать о важных событиях, даже когда приложение закрыто.</p>
  </div>
  <div class="modal-actions">
    ${button('Включить', { data: 'data-account-push-enable' })}
    ${button('Не сейчас', { data: 'data-account-push-later' })}
  </div>
  <div class="muted" data-account-push-status aria-live="polite">${escapeHtml(initialStatus)}</div>`;
}

export function startGlobalAccountPushRuntime({ intervalMs = 1500 } = {}) {
  let disposed = false;
  let busy = false;
  let promptShown = false;
  let synchronized = false;
  let timer = null;

  const offer = async () => {
    if (disposed || busy || synchronized || !getAccountToken() || !accountAppReady()) return;
    if (!shouldOfferWebPushSetup()) return;
    busy = true;
    try {
      if (Notification.permission === 'granted') {
        const current = await getWebPushState();
        if (current?.subscribed) {
          const state = await syncWebPush();
          synchronized = Boolean(state?.subscribed);
          return;
        }
      }
      if (promptShown || document.querySelector('[data-account-push-setup-modal]')) return;

      promptShown = true;
      const layer = mountModal(document.body, modal(pushSetupModal(), {
        title: 'Уведомления на телефоне',
        variant: 'x',
        xRole: 'action',
        surface: 'app',
      }));
      if (!layer) {
        promptShown = false;
        return;
      }
      layer.dataset.accountPushSetupModal = 'true';
      const enable = layer.querySelector('[data-account-push-enable]');
      const later = layer.querySelector('[data-account-push-later]');
      const status = layer.querySelector('[data-account-push-status]');
      later?.addEventListener('click', () => {
        synchronized = true;
        layer.remove();
      });
      enable?.addEventListener('click', async () => {
        enable.disabled = true;
        if (status) status.textContent = 'Включаем…';
        try {
          const next = await enableWebPush({ strict: false });
          if (next?.subscribed) {
            synchronized = true;
            layer.remove();
            return;
          }
          if (next?.permission === 'denied') {
            synchronized = true;
            layer.remove();
            return;
          }
          if (status) status.textContent = webPushFailureMessage(next) || 'Не удалось включить уведомления.';
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось включить уведомления.';
        } finally {
          if (enable.isConnected) enable.disabled = false;
        }
      });
    } catch {
      // Push setup must not block the Account application.
    } finally {
      busy = false;
    }
  };

  void offer();
  timer = window.setInterval(() => void offer(), Math.max(1000, Number(intervalMs) || 1500));
  return () => {
    disposed = true;
    if (timer) window.clearInterval(timer);
  };
}

let disposeRootTelegramRuntime = () => {};
const rootTelegramRoute = rootTelegramEntryRoute();
if (rootTelegramRoute) {
  clearAccount(rootTelegramRoute.tenantId);
  void startAccountRuntime({
    ...rootTelegramRoute,
    onTelegramEntryCompleted: () => {
      disposeRootTelegramRuntime();
      continueTelegramEntryToBooking(rootTelegramRoute.tenantId);
    },
  }).then((dispose) => {
    disposeRootTelegramRuntime = typeof dispose === 'function' ? dispose : () => {};
  });
  window.addEventListener('pagehide', () => disposeRootTelegramRuntime(), { once: true });
}

let disposeGlobalAccountPushRuntime = () => {};
if (!rootTelegramRoute) {
  disposeGlobalAccountPushRuntime = startGlobalAccountPushRuntime();
  window.addEventListener('pagehide', () => disposeGlobalAccountPushRuntime(), { once: true });
}
