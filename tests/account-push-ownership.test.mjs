import assert from 'node:assert/strict';
import fs from 'node:fs';

const accountApi = fs.readFileSync('core/account/index.js', 'utf8');
const accountPush = fs.readFileSync('core/notifications/web-push.js', 'utf8');
const accountPushApi = fs.readFileSync('core/notifications/account-push-api.js', 'utf8');
const accountRuntime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const userHtml = fs.readFileSync('user.html', 'utf8');
const coreEntry = fs.readFileSync('core.js', 'utf8');
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
assert.match(accountPushController, /@Get\('subscription'\)/);
assert.match(accountPushController, /subscriptionState\(request\.accountAuth!\.accountId, endpoint\)/);
assert.doesNotMatch(onlineBookingController, /:tenantId\/account\/push/);
assert.doesNotMatch(onlineBookingController, /WebPushService/);
assert.match(accountPushApi, /getGlobalWebPushSubscriptionState/);
assert.match(accountPushApi, /\/subscription\?endpoint=/);

const subscriptionOwner = webPushService.slice(
  webPushService.indexOf('async subscriptionState'),
  webPushService.indexOf('private targetUrl'),
);
assert.doesNotMatch(subscriptionOwner, /tenantId/);
assert.match(subscriptionOwner, /"accountId"/);
assert.match(subscriptionOwner, /"endpoint"/);
assert.match(migration, /DROP COLUMN IF EXISTS "tenantId"/);
assert.match(notificationService, /listAccountEndpoints\(identity\.accountId\)/);
assert.match(notificationService, /dispatchNotification\(tenantId, notificationId\)/);

// Both end-user entry paths must load the runtime that owns the Push prompt.
assert.match(userHtml, /<script type="module" src="online-booking\/account-runtime\.js"><\/script>/);
assert.match(coreEntry, /import '\.\/online-booking\/account-runtime\.js';/);

// The prompt may be skipped only when the current Account already owns the browser subscription.
const accountSetupRuntime = accountRuntime.slice(
  accountRuntime.indexOf('function pushSetupModal'),
  accountRuntime.indexOf('let disposeRootTelegramRuntime'),
);
assert.doesNotMatch(accountSetupRuntime, /getGlobalAccountRelationships/);
assert.doesNotMatch(accountSetupRuntime, /tenantId/);
assert.match(accountSetupRuntime, /enableWebPush\(\{\s*strict:\s*false\s*\}\)/);
assert.match(accountSetupRuntime, /Не сейчас/);
assert.doesNotMatch(accountSetupRuntime, /declineWebPushSetup|setWebPushOptOut/);
assert.match(accountSetupRuntime, /Notification\.permission === 'granted'[\s\S]*getWebPushState\(\)/);
assert.match(accountSetupRuntime, /if \(current\?\.subscribed\)[\s\S]*syncWebPush\(\)/);

const webPushStateSource = accountPush.slice(
  accountPush.indexOf('export async function getWebPushState'),
  accountPush.indexOf('export async function syncWebPush'),
);
assert.match(webPushStateSource, /getGlobalWebPushSubscriptionState\(subscription\.endpoint\)/);
assert.match(webPushStateSource, /subscribed = Boolean\(serverState\?\.subscribed\)/);

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
// "Не сейчас" defers only this app entry and leaves the next entry eligible for the prompt.
assert.match(accountPush, /WEB_PUSH_OPT_OUT_SOURCE_KEY/);
assert.match(accountPush, /source === 'manual' \|\| source === 'denied'/);
assert.match(accountPush, /Notification\.permission === 'denied'[\s\S]*setWebPushOptOutSource\('denied'\)/);
assert.match(accountPush, /setWebPushOptOut\(false\);[\s\S]*return false;/);
assert.match(platformNotices, /localStorage\.getItem\(PLATFORM_PUSH_OPT_OUT_KEY\) === '1'/);
assert.match(globalControls, /checked:\s*pushSubscribed/);
assert.match(accountSetupRuntime, /synchronized = true;[\s\S]*?layer\.remove\(\)/);
assert.match(platformNotices, /button\('Не сейчас'/);

// Device state must survive a new app entry. iOS may expose the active registration through
// ServiceWorkerContainer.ready even when getRegistration('/') does not return it immediately.
assert.match(accountPush, /async function resolveWebPushRegistration/);
assert.match(accountPush, /navigator\.serviceWorker\.getRegistration\('\/'\)/);
assert.match(accountPush, /navigator\.serviceWorker\.ready/);
assert.match(accountPush, /export async function enableWebPush\(\{ strict = true \} = \{\}\)/);
assert.match(accountPush, /strict && !state\?\.subscribed/);
assert.match(accountPush, /syncWebPush\(permission\)/);

// Explicit OS denial or manual disable is sticky for that Account only.
// It must never suppress a different Account on the same installed app.
assert.match(accountPush, /permission !== 'granted'[\s\S]*setWebPushOptOut\(true\)[\s\S]*setWebPushOptOutSource\('denied'\)/);
assert.match(accountPush, /export async function disableWebPush\(\)[\s\S]*setWebPushOptOut\(true\)[\s\S]*setWebPushOptOutSource\('manual'\)/);
assert.match(accountPush, /function accountPushStorageScope\(\)/);
assert.match(accountPush, /payload\?\.sub/);
assert.match(accountPush, /scopedWebPushStorageKey/);
assert.match(accountPush, /clearUnscopedWebPushOptOut/);
assert.match(platformNotices, /Notification\.permission !== 'granted'[\s\S]*setPlatformPushOptOut\(true\)/);
assert.match(platformNotices, /export async function disablePlatformPush\(\)[\s\S]*setPlatformPushOptOut\(true\)/);
assert.match(platformNotices, /Notification\.permission === 'granted' && !platformPushOptedOut\(\)/);
assert.doesNotMatch(accountPush, /declineWebPushSetup/);
assert.doesNotMatch(platformNotices, /declinePlatformPushSetup/);

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(String(key)) ? storage.get(String(key)) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
  removeItem(key) { storage.delete(String(key)); },
};
const tokenFor = (accountId) => {
  const payload = Buffer.from(JSON.stringify({ sub: accountId, kind: 'account' }), 'utf8').toString('base64url');
  return `e30.${payload}.signature`;
};
const pushRuntime = await import('../core/notifications/web-push.js');

// Simulate the old broken browser-global refusal already present on the iPhone.
localStorage.setItem('va-tools.account.push.opt-out', '1');
localStorage.setItem('va-tools.account.push.opt-out-source', 'manual');
localStorage.setItem('book.account.token', tokenFor('account-a'));
assert.equal(pushRuntime.webPushOptedOut(), false, 'unscoped historical OFF must not suppress the current Account');
assert.equal(localStorage.getItem('va-tools.account.push.opt-out'), null, 'unscoped opt-out must be removed');
assert.equal(localStorage.getItem('va-tools.account.push.opt-out-source'), null, 'unscoped opt-out source must be removed');

await pushRuntime.disableWebPush();
assert.equal(pushRuntime.webPushOptedOut(), true, 'manual OFF must stay sticky for the same Account');
assert.equal(localStorage.getItem('va-tools.account.push.opt-out'), null, 'device-global opt-out must not be recreated');

localStorage.setItem('book.account.token', tokenFor('account-b'));
assert.equal(pushRuntime.webPushOptedOut(), false, 'Account A manual OFF must not suppress Account B');

localStorage.setItem('book.account.token', tokenFor('account-a'));
assert.equal(pushRuntime.webPushOptedOut(), true, 'Account A opt-out must survive switching away and back');

delete globalThis.localStorage;

console.log('Account Push ownership boundaries passed');
