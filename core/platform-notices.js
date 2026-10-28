import { apiRequest } from './auth.js';
import { button, escapeHtml, modal, mountModal } from '../ui/ui.js';

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

function platformPushSupported() {
  return typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
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
  if (!platformPushSupported()) return getPlatformPushState();
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return getPlatformPushState();

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

async function markRead(id) {
  return jsonResponse(await apiRequest(`/platform-notices/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({}),
  }), 'Не удалось отметить уведомление');
}

function noticeModal(item) {
  return `<div class="modal-title">
    <h2>${escapeHtml(item.title || 'Системное уведомление')}</h2>
    <p>${escapeHtml(item.body || '')}</p>
  </div>
  <div class="modal-actions">
    ${button('Понятно', { data: 'data-platform-notice-close' })}
  </div>`;
}

function pushSetupModal() {
  return `<div class="modal-title">
    <h2>Уведомления на телефоне</h2>
    <p>Включите уведомления, чтобы узнавать о новых записях, даже когда приложение закрыто.</p>
  </div>
  <div class="modal-actions">
    ${button('Включить', { data: 'data-platform-push-enable' })}
    ${button('Не сейчас', { data: 'data-platform-push-later' })}
  </div>
  <div class="muted" data-platform-push-status aria-live="polite"></div>`;
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
    if (Notification.permission === 'granted') {
      void enablePlatformPush().catch(() => undefined);
    }
  }

  const offerPush = async () => {
    if (disposed || pushPromptShown) return;
    if (document.querySelector('[data-platform-notice-modal], [data-platform-push-setup-modal]')) {
      window.setTimeout(() => void offerPush(), 1_500);
      return;
    }
    if (!platformPushSupported() || Notification.permission === 'denied') return;

    try {
      if (Notification.permission === 'granted') {
        const state = await enablePlatformPush();
        if (state?.subscribed) return;
      }

      pushPromptShown = true;
      const layer = mountModal(document.body, modal(pushSetupModal(), {
        title: 'Уведомления на телефоне',
        variant: 's',
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
      later?.addEventListener('click', () => layer.remove());
      enable?.addEventListener('click', async () => {
        enable.disabled = true;
        if (status) status.textContent = 'Включаем…';
        try {
          const next = await enablePlatformPush();
          if (next?.subscribed) {
            layer.remove();
            return;
          }
          if (status) status.textContent = next?.permission === 'denied'
            ? 'Уведомления запрещены в настройках устройства.'
            : 'Не удалось включить уведомления на этом устройстве.';
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось включить уведомления.';
        } finally {
          if (enable.isConnected) enable.disabled = false;
        }
      });
    } catch {
      // Настройка Push не должна блокировать рабочий интерфейс.
    }
  };

  const showNext = async () => {
    if (disposed || busy || document.querySelector('[data-platform-notice-modal]')) return;
    busy = true;
    try {
      const rows = await listNotices();
      const unread = (Array.isArray(rows) ? rows : [])
        .filter((item) => !item.readAt && !shown.has(item.id))
        .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
      const item = unread[0];
      if (!item) return;

      shown.add(item.id);
      const layer = mountModal(document.body, modal(noticeModal(item), {
        title: item.title || 'Системное уведомление',
        variant: 's',
        surface: 'app',
      }));
      if (!layer) return;
      layer.dataset.platformNoticeModal = item.id;

      layer.querySelector('[data-platform-notice-close]')?.addEventListener('click', async () => {
        layer.remove();
        try {
          await markRead(item.id);
        } catch {
          shown.delete(item.id);
        }
        if (item.type === 'CAPABILITY_CHANGED' || item.type === 'ACCESS_STATUS_CHANGED') {
          await onAccessChanged(item).catch(() => undefined);
        }
        window.setTimeout(() => void showNext(), 60);
        window.setTimeout(() => void offerPush(), 500);
      });
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
