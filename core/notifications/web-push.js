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

function accountPushStorageScope() {
  const token = String(getAccountToken() || '').trim();
  const encodedPayload = token.split('.')[1] || '';
  if (!encodedPayload) return '';
  try {
    const padding = '='.repeat((4 - (encodedPayload.length % 4)) % 4);
    const payload = JSON.parse(atob(`${encodedPayload.replaceAll('-', '+').replaceAll('_', '/')}${padding}`));
    return String(payload?.sub || '').trim();
  } catch {
    return '';
  }
}

function scopedWebPushStorageKey(baseKey) {
  const scope = accountPushStorageScope();
  return scope ? `${baseKey}:${encodeURIComponent(scope)}` : '';
}

function clearLegacyWebPushOptOut() {
  if (typeof localStorage === 'undefined') return;
  try {
    // Older builds stored one refusal for the whole browser. It cannot be safely
    // attributed to an Account, so it must not suppress another Account on the device.
    localStorage.removeItem(WEB_PUSH_OPT_OUT_KEY);
    localStorage.removeItem(WEB_PUSH_OPT_OUT_SOURCE_KEY);
  } catch {
    // A storage failure must not block the Account application.
  }
}

function setWebPushOptOut(value) {
  if (typeof localStorage === 'undefined') return;
  try {
    clearLegacyWebPushOptOut();
    const optOutKey = scopedWebPushStorageKey(WEB_PUSH_OPT_OUT_KEY);
    const sourceKey = scopedWebPushStorageKey(WEB_PUSH_OPT_OUT_SOURCE_KEY);
    if (!optOutKey || !sourceKey) return;
    if (value) localStorage.setItem(optOutKey, '1');
    else {
      localStorage.removeItem(optOutKey);
      localStorage.removeItem(sourceKey);
    }
  } catch {
    // A storage failure must not block the Account application.
  }
}

function setWebPushOptOutSource(source = '') {
  if (typeof localStorage === 'undefined') return;
  try {
    clearLegacyWebPushOptOut();
    const sourceKey = scopedWebPushStorageKey(WEB_PUSH_OPT_OUT_SOURCE_KEY);
    if (!sourceKey) return;
    const normalized = String(source || '').trim();
    if (normalized) localStorage.setItem(sourceKey, normalized);
    else localStorage.removeItem(sourceKey);
  } catch {
    // A storage failure must not block the Account application.
  }
}

export function webPushOptedOut() {
  if (typeof localStorage === 'undefined') return false;
  try {
    clearLegacyWebPushOptOut();
    const optOutKey = scopedWebPushStorageKey(WEB_PUSH_OPT_OUT_KEY);
    const sourceKey = scopedWebPushStorageKey(WEB_PUSH_OPT_OUT_SOURCE_KEY);
    if (!optOutKey || !sourceKey) return false;
    const optedOut = localStorage.getItem(optOutKey) === '1';
    if (!optedOut) return false;

    const source = String(localStorage.getItem(sourceKey) || '').trim();
    if (source === 'manual' || source === 'denied') return true;

    // Earlier scoped builds may have stored bare `1` without a reliable refusal
    // source. Migrate it instead of suppressing Push forever.
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

function registrationPushSupported() {
  if (typeof window === 'undefined') return false;
  const Registration = window.ServiceWorkerRegistration;
  return typeof Registration === 'function'
    && Boolean(Registration.prototype)
    && 'pushManager' in Registration.prototype;
}

export function webPushSupported() {
  return typeof navigator !== 'undefined'
    && typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'Notification' in window
    && (registrationPushSupported() || 'pushManager' in window || 'PushManager' in window);
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

async function readyRegistration(timeoutMs = 1200) {
  if (!navigator?.serviceWorker?.ready) return null;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => window.setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

async function resolveWebPushRegistration({ register = false } = {}) {
  if (!webPushSupported()) return null;

  if (register) {
    const registered = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    const ready = await readyRegistration();
    if (ready?.pushManager) return ready;
    return registered?.pushManager ? registered : null;
  }

  let direct = null;
  if (typeof navigator.serviceWorker.getRegistration === 'function') {
    direct = await navigator.serviceWorker.getRegistration('/').catch(() => null);
  }
  if (direct?.pushManager) return direct;

  const ready = await readyRegistration();
  return ready?.pushManager ? ready : null;
}

export async function getWebPushState() {
  if (!webPushSupported()) return { supported: false, enabled: false, permission: 'unsupported', subscribed: false };
  if (!getAccountToken()) return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  const configuration = await getGlobalWebPushConfiguration();
  const registration = await resolveWebPushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return {
    supported: true,
    enabled: Boolean(configuration?.enabled && configuration?.publicKey),
    permission: Notification.permission,
    subscribed: Boolean(subscription),
  };
}

export async function syncWebPush(permissionOverride = '') {
  if (!webPushSupported() || !getAccountToken() || webPushOptedOut()) return getWebPushState();

  const configuration = await getGlobalWebPushConfiguration();
  if (!configuration?.enabled || !configuration?.publicKey) {
    return { supported: true, enabled: false, permission: Notification.permission, subscribed: false };
  }

  const registration = await resolveWebPushRegistration({ register: true });
  const permission = String(permissionOverride || Notification.permission || 'default');
  if (!registration?.pushManager) {
    return { supported: true, enabled: true, permission, subscribed: false };
  }

  let subscription = await registration.pushManager.getSubscription();

  if (permission !== 'granted') {
    if (subscription) {
      await deleteGlobalWebPushSubscription(subscription.endpoint).catch(() => null);
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    return {
      supported: true,
      enabled: true,
      permission,
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
    permission,
    subscribed: true,
  };
}

export async function enableWebPush({ strict = true } = {}) {
  setWebPushOptOut(false);
  if (!webPushSupported() || !getAccountToken()) {
    const state = await getWebPushState();
    if (strict && !state?.subscribed) throw new Error(webPushFailureMessage(state) || 'Не удалось включить уведомления.');
    return state;
  }

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setWebPushOptOut(true);
    setWebPushOptOutSource('denied');
    const state = { ...(await getWebPushState()), permission, subscribed: false };
    if (strict) throw new Error(webPushFailureMessage(state) || 'Не удалось включить уведомления.');
    return state;
  }

  const state = await syncWebPush(permission);
  if (strict && !state?.subscribed) throw new Error(webPushFailureMessage(state) || 'Не удалось включить уведомления.');
  return state;
}

export async function disableWebPush() {
  setWebPushOptOut(true);
  setWebPushOptOutSource('manual');
  if (!webPushSupported() || !getAccountToken()) return getWebPushState();
  const registration = await resolveWebPushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await deleteGlobalWebPushSubscription(subscription.endpoint).catch(() => null);
    await subscription.unsubscribe().catch(() => false);
  }
  return getWebPushState();
}
