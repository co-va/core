import {
  deleteWebPushSubscription,
  getAccountToken,
  getWebPushConfiguration,
  saveWebPushSubscription,
} from '../account/index.js';

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - (String(value || '').length % 4)) % 4);
  const base64 = `${String(value || '').replaceAll('-', '+').replaceAll('_', '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export function webPushSupported() {
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

export function shouldOfferWebPushSetup() {
  if (installedAppMode()) return webPushSupported();
  if (!webPushSupported()) return false;
  const mobileApple = /iPhone|iPad|iPod/i.test(String(navigator.userAgent || ''));
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  return mobileApple && coarsePointer;
}

export function webPushFailureMessage(state = {}) {
  if (!state?.supported) return 'Системные уведомления недоступны на этом устройстве.';
  if (state?.permission === 'denied') return 'Уведомления запрещены в настройках устройства.';
  if (!state?.enabled) return 'Push не настроен на сервере приложения.';
  if (!state?.subscribed) return 'Разрешение получено, но Push-подписка не создана.';
  return '';
}

export async function getWebPushState(tenantId) {
  if (!webPushSupported()) return { supported: false, enabled: false, permission: 'unsupported', subscribed: false };
  if (!getAccountToken(tenantId)) return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  const configuration = await getWebPushConfiguration(tenantId);
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return {
    supported: true,
    enabled: Boolean(configuration?.enabled && configuration?.publicKey),
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

export async function syncWebPush(tenantId) {
  if (!webPushSupported() || !getAccountToken(tenantId)) return getWebPushState(tenantId);

  const configuration = await getWebPushConfiguration(tenantId);
  if (!configuration?.enabled || !configuration?.publicKey) {
    return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  }

  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (Notification.permission !== 'granted') {
    if (subscription) {
      await deleteWebPushSubscription(tenantId, subscription.endpoint).catch(() => null);
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    return {
      supported: true,
      enabled: true,
      permission: Notification.permission,
      subscribed: false,
    };
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(configuration.publicKey),
    });
  }

  // The server stores the browser endpoint for the global Account. The tenant
  // route is only the current relationship context used to authenticate this call.
  await saveWebPushSubscription(tenantId, subscription.toJSON());
  return {
    supported: true,
    enabled: true,
    permission: Notification.permission,
    subscribed: true,
  };
}

export async function enableWebPush(tenantId) {
  if (!webPushSupported() || !getAccountToken(tenantId)) return getWebPushState(tenantId);
  if (Notification.permission === 'default') await Notification.requestPermission();
  return syncWebPush(tenantId);
}

export async function disableWebPush(tenantId) {
  if (!webPushSupported() || !getAccountToken(tenantId)) return getWebPushState(tenantId);
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await deleteWebPushSubscription(tenantId, subscription.endpoint).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  }
  return getWebPushState(tenantId);
}
