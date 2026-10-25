import { apiRequest } from './auth.js';
import { button, escapeHtml, modal, mountModal } from '../ui/ui.js';

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
  return jsonResponse(await apiRequest('/platform-notices/push/configuration'), 'Не удалось проверить Push');
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
  const configuration = await platformPushConfiguration();
  if (!configuration?.enabled || !configuration?.publicKey) return getPlatformPushState();
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return getPlatformPushState();

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

export function startPlatformNotices({
  onAccessChanged = async () => {},
  intervalMs = 15_000,
} = {}) {
  let disposed = false;
  let busy = false;
  let timer = null;
  const shown = new Set();

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
      });
    } catch {
      // Системное уведомление не должно блокировать рабочий интерфейс.
    } finally {
      busy = false;
    }
  };

  void showNext();
  timer = window.setInterval(() => void showNext(), Math.max(15_000, Number(intervalMs) || 60_000));

  return () => {
    disposed = true;
    if (timer) window.clearInterval(timer);
  };
}
