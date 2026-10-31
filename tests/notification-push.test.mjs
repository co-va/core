import assert from 'node:assert/strict';
import fs from 'node:fs';

const core = fs.readFileSync('core.js', 'utf8');
const booking = fs.readFileSync('online-booking/booking.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const accountRuntime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const browserPush = fs.readFileSync('core/notifications/web-push.js', 'utf8');
const accountPushApi = fs.readFileSync('core/notifications/account-push-api.js', 'utf8');
const routingUi = fs.readFileSync('core/notifications/routing.js', 'utf8');
const serviceUnseenUi = fs.readFileSync('core/notifications/service-unseen.js', 'utf8');
const notificationSettingsUi = fs.readFileSync('settings/notifications/notifications.js', 'utf8');
const onlineBookingSettingsUi = fs.readFileSync('settings/online-booking/online-booking.js', 'utf8');
const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
const notificationService = fs.readFileSync('server/src/notification/notification.service.ts', 'utf8');
const notificationEventService = fs.readFileSync('server/src/notification/notification-event.service.ts', 'utf8');
const professionalServiceNotice = fs.readFileSync('server/src/notification/professional-service-notice.service.ts', 'utf8');
const notificationReminderService = fs.readFileSync('server/src/notification/notification-reminder.service.ts', 'utf8');
const notificationCatalog = fs.readFileSync('server/src/notification/notification-events.ts', 'utf8');
const notificationController = fs.readFileSync('server/src/notification/notification.controller.ts', 'utf8');
const businessStateController = fs.readFileSync('server/src/business-state/business-state.controller.ts', 'utf8');
const financeController = fs.readFileSync('server/src/finance/finance.controller.ts', 'utf8');
const loyaltyController = fs.readFileSync('server/src/loyalty/loyalty.controller.ts', 'utf8');
const auxiliaryStateController = fs.readFileSync('server/src/auxiliary-state/auxiliary-state.controller.ts', 'utf8');
const bookingConsentController = fs.readFileSync('server/src/online-booking/booking-consent.controller.ts', 'utf8');
const onlineBookingController = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const pushService = fs.readFileSync('server/src/notification/web-push.service.ts', 'utf8');
const professionalPushService = fs.readFileSync('server/src/push/professional-push.service.ts', 'utf8');
const professionalPushController = fs.readFileSync('server/src/push/professional-push.controller.ts', 'utf8');
const migration = fs.readFileSync('server/prisma/migrations/20260913070000_web_push_subscription/migration.sql', 'utf8');
const globalPushMigration = fs.readFileSync('server/prisma/migrations/20261029070000_global_account_push_subscription/migration.sql', 'utf8');
const serviceNoticeMigration = fs.readFileSync('server/prisma/migrations/20261031083000_professional_service_notice/migration.sql', 'utf8');
const templateMigration = fs.readFileSync('server/prisma/migrations/20261005223000_notification_message_templates/migration.sql', 'utf8');
const enabledMigration = fs.readFileSync('server/prisma/migrations/20261006123000_notification_event_enabled/migration.sql', 'utf8');
const platformNoticeService = fs.readFileSync('server/src/platform-notice/platform-notice.service.ts', 'utf8');
const platformNoticeController = fs.readFileSync('server/src/platform-notice/platform-notice.controller.ts', 'utf8');
const platformPushMigration = fs.readFileSync('server/prisma/migrations/20260922173000_platform_push_subscription/migration.sql', 'utf8');
const accountPushController = fs.readFileSync('server/src/online-booking/account-push.controller.ts', 'utf8');
const bookingFlowController = fs.readFileSync('server/src/online-booking/booking-flow.controller.ts', 'utf8');
const onlineBookingModule = fs.readFileSync('server/src/online-booking/online-booking.module.ts', 'utf8');
const adminUi = fs.readFileSync('admin/admin.js', 'utf8');
const platformNoticesUi = fs.readFileSync('core/platform-notices.js', 'utf8');

assert.match(core, /function bookingRouteQuery\(params\)/);
assert.doesNotMatch(booking, /telegramId/);
assert.doesNotMatch(accountRuntime, /bindAccountTelegramEntry|resolveAccountTelegramEntry|tg_entry|telegram-entry/, 'Account Push runtime must stay independent from retired Telegram entry');
assert.doesNotMatch(accountRuntime, /mountBookingNotifications/);

assert.match(accountShell, /getAccountNotifications/);
assert.match(accountShell, /markAccountNotificationRead/);
assert.match(accountShell, /notificationMessages/);
assert.match(accountShell, /label: 'Push'/);
assert.match(accountShell, /enableWebPush/);
assert.match(accountShell, /disableWebPush/);
assert.equal(fs.existsSync('online-booking/notifications.js'), false, 'Legacy notification bridge must stay removed');

assert.match(browserPush, /serviceWorker\.register\('\/service-worker\.js'/);
assert.match(browserPush, /PushManager/);
assert.match(browserPush, /enableWebPush/);
assert.match(browserPush, /disableWebPush/);
assert.match(browserPush, /shouldOfferWebPushSetup/);
assert.match(browserPush, /webPushFailureMessage/);
assert.match(browserPush, /WEB_PUSH_OPT_OUT_KEY/);
assert.match(browserPush, /webPushOptedOut/);
assert.doesNotMatch(browserPush, /declineWebPushSetup/);
assert.match(browserPush, /Notification\.permission === 'denied' \|\| webPushOptedOut\(\)/);
assert.match(browserPush, /permission !== 'granted'[\s\S]*setWebPushOptOut\(true\)/);
assert.match(browserPush, /getGlobalWebPushConfiguration/);
assert.match(browserPush, /saveGlobalWebPushSubscription/);
assert.match(browserPush, /deleteGlobalWebPushSubscription/);
assert.doesNotMatch(browserPush, /getWebPushConfiguration/);
assert.doesNotMatch(browserPush, /saveWebPushSubscription/);
assert.doesNotMatch(browserPush, /deleteWebPushSubscription/);
assert.match(accountRuntime, /startGlobalAccountPushRuntime/);
const accountPushRuntimeSource = accountRuntime.slice(
  accountRuntime.indexOf('function pushSetupModal'),
  accountRuntime.indexOf('const disposeGlobalAccountPushRuntime'),
);
assert.doesNotMatch(accountPushRuntimeSource, /tenantId/);
assert.doesNotMatch(accountPushRuntimeSource, /getGlobalAccountRelationships/);
assert.match(accountPushRuntimeSource, /shouldOfferWebPushSetup/);
assert.match(accountPushRuntimeSource, /syncWebPush\(\)/);
assert.match(accountPushRuntimeSource, /enableWebPush\(\{\s*strict:\s*false\s*\}\)/);
assert.doesNotMatch(accountPushRuntimeSource, /declineWebPushSetup\(\)/);
assert.match(accountPushRuntimeSource, /data-account-push-enable/);
assert.match(accountPushRuntimeSource, /Уведомления на телефоне/);
assert.match(accountPushRuntimeSource, /Не сейчас/);
assert.match(accountPushRuntimeSource, /data-account-push-later[\s\S]*synchronized = true;[\s\S]*layer\.remove\(\)/);
assert.match(accountPushRuntimeSource, /variant: 'x'/);
assert.match(accountPushRuntimeSource, /xRole: 'action'/);
assert.match(accountPushRuntimeSource, /Notification\.permission === 'granted'/);
assert.match(serviceWorker, /addEventListener\('push'/);
assert.match(serviceWorker, /addEventListener\('notificationclick'/);

assert.match(accountPushApi, /\/online-booking\/account\/push/);
assert.match(accountPushApi, /getGlobalWebPushConfiguration/);
assert.match(accountPushApi, /saveGlobalWebPushSubscription/);
assert.match(accountPushApi, /deleteGlobalWebPushSubscription/);
assert.doesNotMatch(accountPushApi, /tenantId/);
assert.match(accountPushController, /@Controller\('online-booking\/account\/push'\)/);
assert.match(accountPushController, /@Get\('config'\)/);
assert.match(accountPushController, /@Put\('subscription'\)/);
assert.match(accountPushController, /@Delete\('subscription'\)/);
assert.match(accountPushController, /saveSubscription\(\s*request\.accountAuth!\.accountId,/);
assert.match(accountPushController, /deleteSubscription\(request\.accountAuth!\.accountId,/);
assert.match(onlineBookingModule, /AccountPushController/);
assert.match(globalPushMigration, /DROP COLUMN IF EXISTS "tenantId"/);
assert.match(globalPushMigration, /WebPushSubscription_accountId_idx/);

assert.match(notificationService, /DELIVERY_POLICY_TYPE = '__delivery__'/);
assert.match(notificationService, /private async getDeliveryPolicy/);
assert.match(notificationService, /routed\.push\(\.\.\.await this\.queueChannel\(tenantId, notificationId, 'PUSH'/);
assert.match(notificationService, /const externalChannels = policy\.channels\.filter\(\(channel\) => ACTIVE_EXTERNAL_CHANNELS\.has\(channel\)\)/);
assert.match(notificationService, /if \(policy\.mode === 'fallback'\)/);
assert.match(notificationService, /private async queueFallbackAfter/);
assert.doesNotMatch(notificationService, /pushResult\.sent === 0 && pushResult\.failed > 0/);
assert.match(notificationService, /listAccountEndpoints/);
assert.match(notificationService, /dispatchNotification/);

assert.match(routingUi, /NOTIFICATION_DELIVERY_POLICY_TYPE = '__delivery__'/);
assert.match(routingUi, /getNotificationCatalog/);
assert.match(routingUi, /getNotificationDeliveryRouting/);
assert.match(routingUi, /saveNotificationDeliveryRouting/);
assert.match(routingUi, /setNotificationEnabled/);
assert.match(routingUi, /\['PUSH', 'TELEGRAM', 'EMAIL'\]\.includes\(value\)/);
assert.match(routingUi, /titleTemplate/);
assert.match(routingUi, /bodyTemplate/);

const canonicalServiceEvents = [
  'booking.created',
  'booking.rescheduled',
  'booking.cancelled',
  'booking.deleted',
  'booking.confirmed',
  'booking.no-show',
  'booking.reminder',
  'finance.payment',
  'finance.refund',
  'loyalty.changed',
  'personal-account.changed',
  'investment.participation',
  'consent.accepted',
  'consent.revoked',
];
for (const eventType of canonicalServiceEvents) {
  assert.match(notificationCatalog, new RegExp(eventType.replace('.', '\\.')));
}
for (const legacyType of ['loan.received', 'loan.repaid', 'investment.received', 'investment.returned', 'investment.income', 'document.assigned', 'person.birthday']) {
  assert.doesNotMatch(notificationCatalog, new RegExp(legacyType.replace('.', '\\.')));
}
assert.match(notificationController, /@Get\('catalog'\)/);
assert.match(notificationController, /@Get\('service-notices'\)/);
assert.match(notificationController, /@Post\('service-notices\/:noticeId\/read'\)/);
assert.match(notificationEventService, /EVENT_DISABLED/);
assert.match(notificationEventService, /createEventForTenantOwner/);
assert.match(notificationEventService, /createEventForPersonKey/);
assert.match(notificationEventService, /ProfessionalServiceNoticeService/);
assert.doesNotMatch(notificationEventService, /PlatformNoticeService|platformNotices/);
assert.match(professionalServiceNotice, /ProfessionalServiceNotice/);
assert.match(professionalServiceNotice, /createForTenantOwner/);
assert.match(professionalServiceNotice, /this\.push\.send/);
assert.match(professionalServiceNotice, /"readAt" IS NULL/);
assert.match(businessStateController, /booking\.created/);
assert.match(businessStateController, /booking\.rescheduled/);
assert.match(businessStateController, /booking\.cancelled/);
assert.match(businessStateController, /booking\.deleted/);
assert.match(businessStateController, /booking\.confirmed/);
assert.match(businessStateController, /booking\.no-show/);
assert.match(notificationReminderService, /booking\.reminder/);
assert.match(notificationReminderService, /Notification/);
assert.match(financeController, /finance\.payment/);
assert.match(financeController, /finance\.refund/);
assert.match(loyaltyController, /loyalty\.changed/);
assert.match(loyaltyController, /personal-account\.changed/);
assert.match(auxiliaryStateController, /investment\.participation/);
assert.match(onlineBookingController, /investment\.participation/);
assert.match(bookingConsentController, /consent\.accepted/);
assert.match(bookingConsentController, /consent\.revoked/);
assert.match(enabledMigration, /ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT FALSE/);

assert.match(notificationSettingsUi, /getNotificationCatalog/);
assert.match(notificationSettingsUi, /v2Section/);
assert.match(notificationSettingsUi, /mountV2ZLayer/);
assert.match(notificationSettingsUi, /v2ZLayer/);
assert.match(notificationSettingsUi, /messageBubble/);
assert.match(notificationSettingsUi, /data-notification-enabled/);
assert.match(notificationSettingsUi, /data-v2-primary-action/);
assert.match(notificationSettingsUi, /data-v2-primary-label="Сохранить"/);
assert.match(notificationSettingsUi, /Заголовок сообщения/);
assert.match(notificationSettingsUi, /Текст сообщения/);
assert.match(notificationSettingsUi, /Во все выбранные каналы/);
assert.match(notificationSettingsUi, /По очереди, если предыдущий не доставлен/);
assert.match(notificationSettingsUi, /Push — всегда/);
assert.doesNotMatch(notificationSettingsUi, /v2ListEntry|v2ListEntries/);
assert.doesNotMatch(notificationSettingsUi, /variant:\s*'q'/);
assert.doesNotMatch(notificationSettingsUi, /data-notification-modes/);
assert.doesNotMatch(notificationSettingsUi, /data-notification-channels/);
assert.doesNotMatch(onlineBookingSettingsUi, /Настройки уведомлений/);
assert.doesNotMatch(onlineBookingSettingsUi, /getNotificationRouting/);
assert.doesNotMatch(onlineBookingSettingsUi, /saveNotificationRouting/);

assert.match(pushService, /webpush\.sendNotification/);
assert.match(pushService, /WEB_PUSH_VAPID_PUBLIC_KEY/);
const pushSubscriptionSaveSource = pushService.slice(
  pushService.indexOf('async saveSubscription'),
  pushService.indexOf('async deleteSubscription'),
);
assert.doesNotMatch(pushSubscriptionSaveSource, /tenantId/);
assert.match(pushService, /WHERE "accountId" = \$\{accountId\}/);
assert.match(pushService, /ON s\."endpoint" = d\."recipientKey"/);
assert.doesNotMatch(pushService, /ON s\."tenantId" = d\."tenantId" AND s\."endpoint" = d\."recipientKey"/);
assert.match(pushService, /DELETE FROM "WebPushSubscription"[\s\S]*?WHERE "accountId" = \$\{accountId\} AND "endpoint" = \$\{endpoint\}/);
assert.match(migration, /CREATE TABLE "WebPushSubscription"/);
assert.match(migration, /UNIQUE INDEX "WebPushSubscription_endpoint_key"/);
assert.match(templateMigration, /titleTemplate/);
assert.match(templateMigration, /bodyTemplate/);

assert.match(platformPushMigration, /PlatformPushSubscription/);
assert.match(platformPushMigration, /PlatformAccount/);
assert.match(professionalPushService, /webpush\.sendNotification/);
assert.match(professionalPushService, /WEB_PUSH_VAPID_PUBLIC_KEY/);
assert.match(professionalPushService, /PlatformPushSubscription/);
assert.match(professionalPushService, /async subscriptionState/);
assert.match(professionalPushService, /async saveSubscription/);
assert.match(professionalPushService, /async deleteSubscription/);
assert.match(professionalPushService, /async send/);
assert.doesNotMatch(professionalPushService, /booking\.|BOOKING_CREATED|ProfessionalServiceNotice/);
assert.match(professionalPushController, /@Controller\('professional-push'\)/);
assert.match(professionalPushController, /@Get\('configuration'\)/);
assert.match(professionalPushController, /@Get\('subscription'\)/);
assert.match(professionalPushController, /@Post\('subscription'\)/);
assert.match(professionalPushController, /@Delete\('subscription'\)/);

assert.match(serviceNoticeMigration, /CREATE TABLE IF NOT EXISTS "ProfessionalServiceNotice"/);
assert.match(serviceNoticeMigration, /LIKE 'booking\.%'/);
assert.match(serviceNoticeMigration, /INSERT INTO "ProfessionalServiceNotice"/);
assert.match(serviceNoticeMigration, /DELETE FROM "PlatformNotice"/);

assert.match(platformNoticeService, /createForTenantOwner/);
assert.match(platformNoticeService, /ProfessionalPushService/);
assert.match(platformNoticeService, /this\.push\.send/);
assert.doesNotMatch(platformNoticeService, /webpush\.sendNotification/);
assert.doesNotMatch(platformNoticeService, /booking\.|BOOKING_CREATED|ProfessionalServiceNotice|CommunicationMessage/);
assert.match(platformNoticeController, /@Controller\('platform-notices'\)/);
assert.match(platformNoticeController, /@Get\(\)/);
assert.match(platformNoticeController, /@Post\(':noticeId\/read'\)/);
assert.doesNotMatch(platformNoticeController, /ProfessionalPushService|push\/configuration|push\/subscription/);
assert.match(platformNoticesUi, /getPlatformPushState/);
assert.match(platformNoticesUi, /professional-push\/configuration/);
assert.match(platformNoticesUi, /professional-push\/subscription\?endpoint=/);
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
assert.doesNotMatch(platformNoticesUi, /booking\.created|booking\.deleted|BOOKING_CREATED|service-unseen-refresh|platform-notices\/push/);
assert.doesNotMatch(platformNoticesUi, /window\.setTimeout\(\(\) => void showNext\(\), 60\)/);
assert.doesNotMatch(platformNoticesUi, /pushPromptAttempts/);

assert.match(serviceUnseenUi, /\/notifications\/service-notices/);
assert.match(serviceUnseenUi, /booking\.created/);
assert.match(serviceUnseenUi, /booking\.deleted/);
assert.match(serviceUnseenUi, /data-service-unseen-list-badge/);
assert.match(serviceUnseenUi, /data-service-deleted-modal/);
assert.doesNotMatch(serviceUnseenUi, /getPlatformNotices|markPlatformNoticeSeen/);

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
assert.doesNotMatch(onlineBookingModule, /PlatformNoticeModule/);
assert.match(onlineBookingModule, /NotificationModule/);
assert.match(bookingFlowController, /NotificationEventService/);
assert.doesNotMatch(bookingFlowController, /PlatformNoticeService/);
assert.doesNotMatch(bookingFlowController, /type: 'BOOKING_CREATED'/);
assert.match(bookingFlowController, /createEventForTenantOwner\(tenantId/);
assert.match(bookingFlowController, /type: 'booking\.created'/);
assert.match(bookingFlowController, /source: 'online-booking'/);
assert.match(bookingFlowController, /void Promise\.allSettled\(\[[\s\S]*?createEventForTenantOwner\(tenantId[\s\S]*?createEventForPerson\(tenantId[\s\S]*?\]\);/);
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

console.log('account, SERVICE and platform notification Web Push tests passed');
