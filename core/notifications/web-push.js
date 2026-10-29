import { getAccountToken } from '../account/index.js';
import {
  deleteGlobalWebPushSubscription,
  getGlobalWebPushConfiguration,
  saveGlobalWebPushSubscription,
} from './account-push-api.js';

const WEB_PUSH_OPT_OUT_KEY = 'va-tools.account.push.opt-out';
const WEB_PUSH_OPT_OUT_SOURCE_KEY = 'va-tools.account.push.opt-out-source';

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - (String(value || '').length % 4)) % 4);
  const base64 = `${String(value || '').replaceAll('-', '+').replaceAll('_', '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function setWebPushOptOut(value) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (value) localStorage.setItem(WEB_PUSH_OPT_OUT_KEY, '1');
    else {
      localStorage.removeItem(WEB_PUSH_OPT_OUT_KEY);
      localStorage.removeItem(WEB_PUSH_OPT_OUT_SOURCE_KEY);
    }
  } catch {
    // A storage failure must not block the Account application.
  }
}

function setWebPushOptOutSource(source = '') {
  if (typeof localStorage === 'undefined') return;
  try {
    const normalized = String(source || '').trim();
    if (normalized) localStorage.setItem(WEB_PUSH_OPT_OUT_SOURCE_KEY, normalized);
    else localStorage.removeItem(WEB_PUSH_OPT_OUT_SOURCE_KEY);
  } catch {
    // A storage failure must not block the Account application.
  }
}

export function webPushOptedOut() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const optedOut = localStorage.getItem(WEB_PUSH_OPT_OUT_KEY) === '1';
    if (!optedOut) return false;

    const source = String(localStorage.getItem(WEB_PUSH_OPT_OUT_SOURCE_KEY) || '').trim();
    if (source === 'manual' || source === 'denied') return true;

    // Earlier builds stored bare `1` even for deferred setup. That value has no
    // reliable refusal meaning, so migrate it instead of suppressing Push forever.
    if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      setWebPushOptOutSource('denied');
      return true;
    }

    setWebPushOptOut(false);
    return false;
  } catch {
    return false;
  }
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
  if (!webPushSupported()) return false;
  if (Notification.permission === 'denied' || webPushOptedOut()) return false;
  if (installedAppMode()) return true;
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

export async function getWebPushState() {
  if (!webPushSupported()) return { supported: false, enabled: false, permission: 'unsupported', subscribed: false };
  if (!getAccountToken()) return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  const configuration = await getGlobalWebPushConfiguration();
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return {
    supported: true,
    enabled: Boolean(configuration?.enabled && configuration?.publicKey),
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

export async function syncWebPush() {
  if (!webPushSupported() || !getAccountToken() || webPushOptedOut()) return getWebPushState();

  const configuration = await getGlobalWebPushConfiguration();
  if (!configuration?.enabled || !configuration?.publicKey) {
    return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  }

  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();

  if (Notification.permission !== 'granted') {
    if (subscription) {
      await deleteGlobalWebPushSubscription(subscription.endpoint).catch(() => null);
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

  await saveGlobalWebPushSubscription(subscription.toJSON());
  return {
    supported: true,
    enabled: true,
    permission: Notification.permission,
    subscribed: true,
  };
}

export async function enableWebPush() {
  setWebPushOptOut(false);
  if (!webPushSupported() || !getAccountToken()) return getWebPushState();
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') {
    setWebPushOptOut(true);
    setWebPushOptOutSource('denied');
    return getWebPushState();
  }
  return syncWebPush();
}

export async function disableWebPush() {
  setWebPushOptOut(true);
  setWebPushOptOutSource('manual');
  if (!webPushSupported() || !getAccountToken()) return getWebPushState();
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await deleteGlobalWebPushSubscription(subscription.endpoint).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  }
  return getWebPushState();
}
