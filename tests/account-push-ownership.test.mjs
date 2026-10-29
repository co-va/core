import assert from 'node:assert/strict';
import fs from 'node:fs';

const accountApi = fs.readFileSync('core/account/index.js', 'utf8');
const accountPush = fs.readFileSync('core/notifications/web-push.js', 'utf8');
const accountRuntime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const onlineBookingController = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const accountPushController = fs.readFileSync('server/src/online-booking/account-push.controller.ts', 'utf8');
const webPushService = fs.readFileSync('server/src/notification/web-push.service.ts', 'utf8');
const notificationService = fs.readFileSync('server/src/notification/notification.service.ts', 'utf8');
const migration = fs.readFileSync('server/prisma/migrations/20261029070000_global_account_push_subscription/migration.sql', 'utf8');
const platformNotices = fs.readFileSync('core/platform-notices.js', 'utf8');

// Account Push permission and subscription belong to the Account/device, never to a relationship tenant.
assert.doesNotMatch(accountApi, /export async function (?:get|save|delete)WebPush/);
assert.doesNotMatch(accountApi, /\/account\/push\//);
assert.match(accountPushController, /@Controller\('online-booking\/account\/push'\)/);
assert.doesNotMatch(onlineBookingController, /:tenantId\/account\/push/);
assert.doesNotMatch(onlineBookingController, /WebPushService/);

const subscriptionOwner = webPushService.slice(
  webPushService.indexOf('async saveSubscription'),
  webPushService.indexOf('private targetUrl'),
);
assert.doesNotMatch(subscriptionOwner, /tenantId/);
assert.match(subscriptionOwner, /"accountId"/);
assert.match(migration, /DROP COLUMN IF EXISTS "tenantId"/);
assert.match(notificationService, /listAccountEndpoints\(identity\.accountId\)/);
assert.match(notificationService, /dispatchNotification\(tenantId, notificationId\)/);

// App entry owns the prompt. A professional relationship must not be needed to offer or enable it.
const accountSetupRuntime = accountRuntime.slice(
  accountRuntime.indexOf('function pushSetupModal'),
  accountRuntime.indexOf('let disposeRootTelegramRuntime'),
);
assert.doesNotMatch(accountSetupRuntime, /getGlobalAccountRelationships/);
assert.doesNotMatch(accountSetupRuntime, /tenantId/);
assert.match(accountSetupRuntime, /enableWebPush\(\)/);
assert.match(accountSetupRuntime, /declineWebPushSetup\(\)/);

// A specific chat/contact owns Telegram and consents only; it must not own device Push.
const chatSettings = accountShell.slice(
  accountShell.indexOf('async function openChatSettings'),
  accountShell.indexOf('function relationshipTitle'),
);
assert.doesNotMatch(chatSettings, /Push|getWebPushState|enableWebPush|disableWebPush/);
assert.match(chatSettings, /Telegram/);
assert.match(chatSettings, /Согласия/);

const globalControls = accountShell.slice(
  accountShell.indexOf('async function loadGlobalNotificationState'),
  accountShell.indexOf('function confirmDeleteAccount'),
);
assert.match(globalControls, /getWebPushState\(\)/);
assert.doesNotMatch(globalControls, /getWebPushState\(tenantId\)/);
assert.match(globalControls, /enableWebPush\(\)/);
assert.match(globalControls, /disableWebPush\(\)/);
assert.doesNotMatch(globalControls, /for \(const tenantId[\s\S]*?(?:enableWebPush|disableWebPush)/);

const contactSettings = accountShell.slice(
  accountShell.indexOf('function openGlobalContactSettings'),
  accountShell.indexOf('function contactHeaderMarkup'),
);
assert.match(contactSettings, /label: 'Согласия'/);
assert.doesNotMatch(contactSettings, /Согласия \/ Уведомления|openGlobalAccountControls/);

// "Not subscribed yet" is only the current device state. It must not be treated as an explicit refusal.
// Existing Accounts that were never asked have no opt-out key and remain eligible for the one-time prompt.
assert.match(accountPush, /localStorage\.getItem\(WEB_PUSH_OPT_OUT_KEY\) === '1'/);
assert.match(platformNotices, /localStorage\.getItem\(PLATFORM_PUSH_OPT_OUT_KEY\) === '1'/);
assert.match(globalControls, /checked:\s*pushSubscribed/);

// Explicit refusal/disable is sticky in both application roles; automatic startup must not undo it.
assert.match(accountPush, /WEB_PUSH_OPT_OUT_KEY/);
assert.match(accountPush, /Notification\.permission === 'denied' \|\| webPushOptedOut\(\)/);
assert.match(accountPush, /setWebPushOptOut\(true\)/);
assert.match(platformNotices, /PLATFORM_PUSH_OPT_OUT_KEY/);
assert.match(platformNotices, /Notification\.permission === 'denied' \|\| platformPushOptedOut\(\)/);
assert.match(platformNotices, /Notification\.permission === 'granted' && !platformPushOptedOut\(\)/);
assert.match(platformNotices, /declinePlatformPushSetup\(\)/);
assert.match(platformNotices, /Не включать/);

console.log('Account Push ownership boundaries passed');
