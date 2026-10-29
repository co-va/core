import { apiRequest } from './auth.js';
import { button, escapeHtml, modal, mountModal } from '../ui/ui.js';

const PLATFORM_PUSH_OPT_OUT_KEY = 'va-tools.platform.push.opt-out';
let platformPushConfigurationCache = null;

async function jsonResponse(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallback);
  return payload;
}

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - (String(value || '').length % 4)) % 4);
  const base64 = `${String(value || '').replaceAll('-', '+').replaceAll('_', '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function setPlatformPushOptOut(value) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(PLATFORM_PUSH_OPT_OUT_KEY, '1');
    else localStorage.removeItem(PLATFORM_PUSH_OPT_OUT_KEY);
  } catch {
    // Push preference storage must not block the application.
  }
}

function platformPushOptedOut() {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(PLATFORM_PUSH_OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

function platformPushSupported() {
  return typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function installedAppMode() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const displayStandalone = typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
  return displayStandalone || navigator.standalone === true;
}

function shouldOfferPushSetup() {
  if (!platformPushSupported()) return false;
  if (Notification.permission === 'denied' || platformPushOptedOut()) return false;
  if (installedAppMode()) return true;
  const mobileApple = /iPhone|iPad|iPod/i.test(String(navigator.userAgent || ''));
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return mobileApple && coarsePointer;
}

function platformPushUnavailableMessage() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return 'Push недоступен в этом запуске приложения.';
  }
  if (!('Notification' in window)) return 'Устройство не предоставляет доступ к системным уведомлениям для этого запуска приложения.';
  if (!('serviceWorker' in navigator)) return 'Устройство не предоставляет Service Worker, необходимый для Push.';
  if (!('PushManager' in window)) return 'Устройство не предоставляет Push API для этого запуска приложения.';
  return '';
}

async function platformPushConfiguration() {
  if (platformPushConfigurationCache) return platformPushConfigurationCache;
  platformPushConfigurationCache = await jsonResponse(
    await apiRequest('/platform-notices/push/configuration'),
    'Не удалось проверить Push',
  );
  return platformPushConfigurationCache;
}

export async function getPlatformPushState() {
  if (!platformPushSupported()) return { supported:false, enabled:false, permission:'unsupported', subscribed:false };
  const configuration = await platformPushConfiguration();
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  let serverSubscribed = false;
  if (subscription?.endpoint) {
    const state = await jsonResponse(await apiRequest(`/platform-notices/push/subscription?endpoint=${encodeURIComponent(subscription.endpoint)}`), 'Не удалось проверить Push');
    serverSubscribed = Boolean(state?.subscribed);
  }
  return {
    supported:true,
    enabled:Boolean(configuration?.enabled && configuration?.publicKey),
    permission:Notification.permission,
    subscribed:Boolean(subscription && serverSubscribed),
    publicKey:String(configuration?.publicKey || ''),
  };
}

export async function enablePlatformPush() {
  setPlatformPushOptOut(false);
  if (!platformPushSupported()) return getPlatformPushState();
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') {
    setPlatformPushOptOut(true);
    return getPlatformPushState();
  }

  const configuration = await platformPushConfiguration();
  if (!configuration?.enabled || !configuration?.publicKey) return getPlatformPushState();

  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope:'/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:decodeBase64Url(configuration.publicKey),
    });
  }
  await jsonResponse(await apiRequest('/platform-notices/push/subscription', {
    method:'POST',
    body:JSON.stringify(subscription.toJSON()),
  }), 'Не удалось включить Push');
  return getPlatformPushState();
}

export async function disablePlatformPush() {
  setPlatformPushOptOut(true);
  if (!platformPushSupported()) return getPlatformPushState();
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await jsonResponse(await apiRequest('/platform-notices/push/subscription', {
      method:'DELETE',
      body:JSON.stringify({ endpoint:subscription.endpoint }),
    }), 'Не удалось отключить Push');
    await subscription.unsubscribe().catch(() => false);
  }
  return getPlatformPushState();
}

async function listNotices() {
  return jsonResponse(await apiRequest('/platform-notices'), 'Не удалось получить системные уведомления');
}

export async function getPlatformNotices() {
  return listNotices();
}

export async function getUnreadPlatformNoticeCount() {
  const rows = await listNotices();
  return (Array.isArray(rows) ? rows : []).filter((item) => !item?.readAt).length;
}

async function markRead(id) {
  const result = await jsonResponse(await apiRequest(`/platform-notices/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  }), 'Не удалось отметить уведомление');
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('va-tools:service-unseen-refresh'));
  return result;
}

export async function markPlatformNoticeSeen(id) {
  return markRead(id);
}

function recordServiceNotice(item) {
  return String(item?.type || '').trim().toUpperCase() === 'BOOKING_CREATED';
}

function noticeModal(item) {
  return `<div class="modal-title">
    <h2>${escapeHtml(item.title || 'Системное уведомление')}</h2>
    <p>${escapeHtml(item.body || '')}</p>
  </div>`;
}

function pushSetupModal(initialStatus = '') {
  return `<div class="modal-title">
    <h2>Уведомления на телефоне</h2>
    <p>Включите уведомления, чтобы узнавать о новых записях, даже когда приложение закрыто.</p>
  </div>
  <div class="modal-actions">
    ${button('Включить', { data: 'data-platform-push-enable' })}
    ${button('Не сейчас', { data: 'data-platform-push-later' })}
  </div>
  <div class="muted" data-platform-push-status aria-live="polite">${escapeHtml(initialStatus)}</div>`;
}

function pushFailureMessage(state) {
  if (!state?.supported) return platformPushUnavailableMessage();
  if (state?.permission === 'denied') return 'Уведомления запрещены в настройках устройства.';
  if (!state?.enabled) return 'Push не настроен на сервере приложения.';
  if (!state?.subscribed) return 'Разрешение получено, но Push-подписка не создана.';
  return '';
}

export function startPlatformNotices({
  onAccessChanged = async () => {},
  intervalMs = 15_000,
} = {}) {
  let disposed = false;
  let busy = false;
  let timer = null;
  let pushPromptShown = false;
  const shown = new Set();

  if (platformPushSupported()) {
    void navigator.serviceWorker.register('/service-worker.js', { scope:'/' }).catch(() => undefined);
    if (Notification.permission === 'granted' && !platformPushOptedOut()) {
      void enablePlatformPush().catch(() => undefined);
    }
  }

  const offerPush = async () => {
    if (disposed || pushPromptShown || !shouldOfferPushSetup()) return;
    if (document.querySelector('[data-platform-notice-modal], [data-platform-push-setup-modal]')) {
      window.setTimeout(() => void offerPush(), 1_500);
      return;
    }

    let initialStatus = '';
    try {
      if (platformPushSupported() && Notification.permission === 'granted') {
        const state = await enablePlatformPush();
        if (state?.subscribed) return;
        initialStatus = pushFailureMessage(state);
      }
    } catch (error) {
      initialStatus = error instanceof Error ? error.message : 'Не удалось проверить Push.';
    }

    pushPromptShown = true;
    const layer = mountModal(document.body, modal(pushSetupModal(initialStatus), {
      title: 'Уведомления на телефоне',
      variant: 'x',
      xRole: 'action',
      surface: 'app',
    }));
    if (!layer) {
      pushPromptShown = false;
      window.setTimeout(() => void offerPush(), 1_500);
      return;
    }
    layer.dataset.platformPushSetupModal = 'true';
    const enable = layer.querySelector('[data-platform-push-enable]');
    const later = layer.querySelector('[data-platform-push-later]');
    const status = layer.querySelector('[data-platform-push-status]');
    later?.addEventListener('click', () => {
      layer.remove();
    });
    enable?.addEventListener('click', async () => {
      enable.disabled = true;
      if (status) status.textContent = 'Включаем…';
      try {
        const next = await enablePlatformPush();
        if (next?.subscribed) {
          layer.remove();
          return;
        }
        if (next?.permission === 'denied') {
          layer.remove();
          return;
        }
        if (status) status.textContent = pushFailureMessage(next) || 'Не удалось включить уведомления.';
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось включить уведомления.';
      } finally {
        if (enable.isConnected) enable.disabled = false;
      }
    });
  };

  const showNext = async () => {
    if (disposed || busy || document.querySelector('[data-platform-notice-modal]')) return;
    busy = true;
    try {
      const rows = await listNotices();
      const unread = (Array.isArray(rows) ? rows : [])
        .filter((item) => !item.readAt && !shown.has(item.id) && !recordServiceNotice(item))
        .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
      const item = unread[0];
      if (!item) return;

      const stale = unread.slice(1);
      stale.forEach((oldItem) => shown.add(oldItem.id));
      if (stale.length) {
        void Promise.allSettled(stale.map((oldItem) => markRead(oldItem.id)));
      }

      shown.add(item.id);
      const layer = mountModal(document.body, modal(noticeModal(item), {
        title: item.title || 'Системное уведомление',
        variant: 's',
        surface: 'app',
      }));
      if (!layer) return;
      layer.dataset.platformNoticeModal = item.id;

      let settled = false;
      const settleNotice = async () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        try {
          await markRead(item.id);
        } catch {
          shown.delete(item.id);
        }
        if (item.type === 'CAPABILITY_CHANGED' || item.type === 'ACCESS_STATUS_CHANGED') {
          await onAccessChanged(item).catch(() => undefined);
        }
        window.setTimeout(() => void offerPush(), 500);
      };

      const observer = new MutationObserver(() => {
        if (!layer.isConnected) void settleNotice();
      });
      observer.observe(document.body, { childList:true, subtree:true });
      if (!layer.isConnected) void settleNotice();
    } catch {
      // Системное уведомление не должно блокировать рабочий интерфейс.
    } finally {
      busy = false;
    }
  };

  void showNext();
  window.setTimeout(() => void offerPush(), 800);
  timer = window.setInterval(() => void showNext(), Math.max(15_000, Number(intervalMs) || 60_000));

  return () => {
    disposed = true;
    if (timer) window.clearInterval(timer);
  };
}
