import assert from 'node:assert/strict';
import fs from 'node:fs';

const notificationPush = fs.readFileSync('server/src/notification/notification.service.ts', 'utf8');
const webPush = fs.readFileSync('server/src/notification/web-push.service.ts', 'utf8');
const notificationPreference = fs.readFileSync('server/src/notification/notification-preference.service.ts', 'utf8');
const bookingFlowController = fs.readFileSync('server/src/online-booking/booking-flow.controller.ts', 'utf8');
const onlineBookingModule = fs.readFileSync('server/src/online-booking/online-booking.module.ts', 'utf8');
const accountPushController = fs.readFileSync('server/src/online-booking/account-push.controller.ts', 'utf8');
const onlineBookingController = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const platformNoticeService = fs.readFileSync('server/src/platform-notice/platform-notice.service.ts', 'utf8');
const adminPlatformNoticeController = fs.readFileSync('server/src/platform-notice/admin-platform-notice.controller.ts', 'utf8');
const platformNoticePushController = fs.readFileSync('server/src/platform-notice/platform-notice-push.controller.ts', 'utf8');
const platformNoticePushService = fs.readFileSync('server/src/platform-notice/platform-notice-push.service.ts', 'utf8');
const platformNoticesUi = fs.readFileSync('core/platform-notices.js', 'utf8');
const browserPush = fs.readFileSync('core/notifications/web-push.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const adminUi = fs.readFileSync('admin/admin.js', 'utf8');

assert.match(notificationPush, /async createForTenantOwner\(/);
assert.match(notificationPush, /platformAccountId/);
assert.match(notificationPush, /channel: 'PUSH'/);
assert.match(notificationPush, /listAccountEndpoints\(identity\.accountId\)/);
assert.match(notificationPush, /dispatchNotification\(tenantId, notificationId\)/);
assert.match(notificationPush, /createEventForPerson\(/);
assert.match(notificationPush, /entityType/);
assert.match(notificationPush, /BOOKING_CREATED/);
assert.match(notificationPush, /NotificationPreferenceService/);
assert.match(notificationPreference, /channelAllowed/);
assert.match(notificationPreference, /SERVICE/);
assert.match(notificationPreference, /SYSTEM/);
assert.match(webPush, /WebPushSubscription/);
assert.match(webPush, /webpush\.sendNotification/);
assert.match(webPush, /setVapidDetails/);
assert.match(webPush, /WEB_PUSH_VAPID_PUBLIC_KEY/);
assert.match(webPush, /WEB_PUSH_VAPID_PRIVATE_KEY/);
assert.match(webPush, /WEB_PUSH_VAPID_SUBJECT/);
assert.match(webPush, /"accountId"/);
assert.doesNotMatch(webPush.slice(webPush.indexOf('async saveSubscription'), webPush.indexOf('private targetUrl')), /tenantId/);
assert.match(accountPushController, /@Controller\('online-booking\/account\/push'\)/);
assert.match(accountPushController, /@Put\('subscription'\)/);
assert.match(accountPushController, /@Delete\('subscription'\)/);
assert.match(accountPushController, /@Get\('config'\)/);
assert.doesNotMatch(onlineBookingController, /:tenantId\/account\/push/);
assert.match(serviceWorker, /addEventListener\('push'/);
assert.match(serviceWorker, /showNotification/);
assert.match(serviceWorker, /badgeCount/);
assert.match(serviceWorker, /setAppBadge/);
assert.match(serviceWorker, /notificationclick/);

assert.match(platformNoticeService, /createNotice\(/);
assert.match(platformNoticeService, /listCurrentNotice\(/);
assert.match(platformNoticeService, /markRead\(/);
assert.match(adminPlatformNoticeController, /@Post\('platform-notices'\)/);
assert.match(platformNoticePushController, /@Controller\('platform-notices\/push'\)/);
assert.match(platformNoticePushController, /@Get\('config'\)/);
assert.match(platformNoticePushController, /@Put\('subscription'\)/);
assert.match(platformNoticePushController, /@Delete\('subscription'\)/);
assert.match(platformNoticePushService, /PlatformPushSubscription/);
assert.match(platformNoticePushService, /webpush\.sendNotification/);
assert.match(platformNoticesUi, /platform-notices\/push\/subscription\?endpoint=/);
assert.match(platformNoticesUi, /enablePlatformPush/);
assert.match(platformNoticesUi, /disablePlatformPush/);
assert.match(platformNoticesUi, /intervalMs = 15_000/);
assert.match(platformNoticesUi, /data-platform-push-enable/);
assert.match(platformNoticesUi, /Уведомления на телефоне/);
assert.match(platformNoticesUi, /Не сейчас/);
assert.doesNotMatch(platformNoticesUi, /declinePlatformPushSetup/);
assert.match(platformNoticesUi, /Notification\.permission !== 'granted'[\s\S]*setPlatformPushOptOut\(true\)/);
assert.match(platformNoticesUi, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
assert.match(platformNoticesUi, /Notification\.permission === 'granted'/);
assert.match(platformNoticesUi, /void enablePlatformPush\(\)\.catch\(\(\) => undefined\)/);
assert.match(platformNoticesUi, /variant: 's'/);
assert.doesNotMatch(platformNoticesUi, /data-platform-notice-ack/);
assert.match(platformNoticesUi, /\.sort\(\(a, b\) => Date\.parse\(b\.createdAt \|\| 0\) - Date\.parse\(a\.createdAt \|\| 0\)\)/);
assert.match(platformNoticesUi, /const stale = unread\.slice\(1\)/);
assert.match(platformNoticesUi, /Promise\.allSettled\(stale\.map\(\(oldItem\) => markRead\(oldItem\.id\)\)\)/);
assert.doesNotMatch(platformNoticesUi, /window\.setTimeout\(\(\) => void showNext\(\), 60\)/);
assert.doesNotMatch(platformNoticesUi, /pushPromptAttempts/);
const enablePushSource = platformNoticesUi.slice(
  platformNoticesUi.indexOf('export async function enablePlatformPush'),
  platformNoticesUi.indexOf('export async function disablePlatformPush'),
);
assert.ok(enablePushSource.indexOf('Notification.requestPermission()') < enablePushSource.indexOf('platformPushConfiguration()'), 'Push permission must be requested from the direct user gesture before async configuration work');
const enableAccountPushSource = browserPush.slice(
  browserPush.indexOf('export async function enableWebPush'),
  browserPush.indexOf('export async function disableWebPush'),
);
assert.ok(enableAccountPushSource.indexOf('Notification.requestPermission()') >= 0, 'Account Push permission must be requested from the direct user gesture');
assert.match(onlineBookingModule, /PlatformNoticeModule/);
assert.match(onlineBookingModule, /NotificationModule/);
assert.match(bookingFlowController, /PlatformNoticeService/);
assert.match(bookingFlowController, /NotificationService/);
assert.match(bookingFlowController, /createForTenantOwner\(tenantId/);
assert.match(bookingFlowController, /type: 'BOOKING_CREATED'/);
assert.match(bookingFlowController, /source: 'online-booking'/);
assert.match(bookingFlowController, /void Promise\.allSettled\(\[[\s\S]*?createForTenantOwner\(tenantId[\s\S]*?createEventForPerson\(tenantId[\s\S]*?\]\);/);
assert.match(adminUi, /navigator\.serviceWorker\.register\('\/service-worker\.js'/);
assert.match(adminUi, /Notification\.requestPermission/);
assert.match(adminUi, /data-enable-admin-push/);
assert.match(adminUi, /Включить PUSH/);
assert.doesNotMatch(adminUi, /data-live-request-count/);

const runtimeAccountPayload = Buffer.from(JSON.stringify({ sub: 'runtime-account', kind: 'account' }), 'utf8').toString('base64url');
const storage = new Map([['book.account.token', `e30.${runtimeAccountPayload}.signature`]]);
const localStorageMock = {
  getItem(key) { return storage.get(String(key)) ?? null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};
let activeSubscription = null;
const runtimeSubscription = {
  endpoint: 'https://push.example.test/account-endpoint',
  toJSON() {
    return { endpoint: this.endpoint, keys: { p256dh: 'runtime-p256dh', auth: 'runtime-auth' } };
  },
  async unsubscribe() {
    activeSubscription = null;
    return true;
  },
};
const runtimeRegistration = {
  pushManager: {
    async getSubscription() { return activeSubscription; },
    async subscribe() {
      activeSubscription = runtimeSubscription;
      return activeSubscription;
    },
  },
};
const notificationRuntime = {
  permission: 'default',
  async requestPermission() {
    this.permission = 'granted';
    return this.permission;
  },
};
const navigatorRuntime = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
  standalone: true,
  serviceWorker: {
    async getRegistration() { return null; },
    async register() { return runtimeRegistration; },
    ready: Promise.resolve(runtimeRegistration),
  },
};
const windowRuntime = {
  PushManager: function PushManager() {},
  Notification: notificationRuntime,
  matchMedia() { return { matches: true }; },
  setTimeout,
};
const pushRequests = [];
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: localStorageMock });
Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'user.va-tools.ru' } });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorRuntime });
Object.defineProperty(globalThis, 'window', { configurable: true, value: windowRuntime });
Object.defineProperty(globalThis, 'Notification', { configurable: true, value: notificationRuntime });
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async (url, options = {}) => {
    pushRequests.push({ url: String(url), method: String(options.method || 'GET') });
    const body = String(url).endsWith('/config')
      ? { enabled: true, publicKey: 'AQ' }
      : { subscribed: String(options.method || 'GET').toUpperCase() !== 'DELETE' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  },
});

const runtimePush = await import('../core/notifications/web-push.js');
assert.equal(runtimePush.shouldOfferWebPushSetup(), true, 'fresh Account must be offered Push without professional relationships');
const enabledRuntimePush = await runtimePush.enableWebPush();
assert.equal(enabledRuntimePush.subscribed, true, 'global Account Push enable must create a browser subscription');
assert.equal(notificationRuntime.permission, 'granted', 'global Account Push enable must request browser permission');
assert.ok(pushRequests.some((item) => item.url === 'https://api.va-tools.ru/online-booking/account/push/config'), 'global Account Push must load global configuration');
assert.ok(pushRequests.some((item) => item.url === 'https://api.va-tools.ru/online-booking/account/push/subscription' && item.method === 'PUT'), 'global Account Push must save through the tenant-free Account route');
assert.ok(pushRequests.every((item) => !/\/online-booking\/[^/]+\/account\/push\//.test(item.url)), 'Account Push runtime must not route through a professional tenant');
const persistedRuntimePush = await runtimePush.getWebPushState();
assert.equal(persistedRuntimePush.subscribed, true, 'Push subscription must remain ON when a later app entry resolves registration through serviceWorker.ready');
await runtimePush.disableWebPush();
assert.equal(runtimePush.webPushOptedOut(), true, 'explicit Push disable must persist opt-out');
assert.equal(runtimePush.shouldOfferWebPushSetup(), false, 'explicit Push disable must suppress future setup prompts');
assert.ok(pushRequests.some((item) => item.url === 'https://api.va-tools.ru/online-booking/account/push/subscription' && item.method === 'DELETE'), 'global Account Push disable must remove the global subscription');

notificationRuntime.permission = 'denied';
const deniedRuntimePush = await runtimePush.enableWebPush({ strict: false });
assert.equal(deniedRuntimePush.subscribed, false, 'system denial must leave Push disabled');
assert.equal(runtimePush.webPushOptedOut(), true, 'system denial must persist opt-out');
assert.equal(runtimePush.shouldOfferWebPushSetup(), false, 'system denial must suppress future setup prompts');

console.log('account and platform notification Web Push tests passed');
