import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const schema = readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261107173000_account_email_notification_preference/migration.sql', 'utf8');
const controller = readFileSync('server/src/account/account-runtime.controller.ts', 'utf8');
const notifications = readFileSync('server/src/notification/notification.service.ts', 'utf8');

assert.match(schema, /model AccountNotificationPreference \{/);
assert.match(schema, /accountId\s+String\s+@id/);
assert.match(schema, /emailEnabled\s+Boolean\s+@default\(true\)/);
assert.match(schema, /onDelete: Cascade/, 'account preferences must not outlive account');
assert.match(migration, /FOREIGN KEY \("accountId"\) REFERENCES "Account"/);
assert.match(controller, /@UseGuards\(AccountGuard\)\s*@Get\('notification-settings'\)/);
assert.match(controller, /@UseGuards\(AccountGuard\)\s*@Put\('notification-settings'\)/);
assert.match(notifications, /typeof email !== 'boolean'/, 'server accepts only boolean preferences');
assert.doesNotMatch(notifications, /if \(email && !current\.emailVerified\)/,
  'email preference is editable before verification');
assert.match(notifications, /if \(channel === 'EMAIL'\) \{\s*const settings = await this\.getAccountNotificationSettings\(identity\.accountId\);\s*if \(!settings\.emailVerified \|\| !settings\.emailEnabled\) return false;/,
  'outbound delivery must honor verification and preference');
assert.match(notifications, /async canSendEmailDelivery\([\s\S]*?this\.canSendDelivery\(tenantId, notificationId, 'EMAIL'\)/,
  'already queued email must be rechecked at send time');
assert.match(notifications, /if \(purpose === 'SERVICE'\) \{\s*routed\.push\(\.\.\.await this\.queueChannel\(tenantId, notificationId, 'EMAIL', purpose, identity\)\);\s*\}/,
  'service email must be duplicated independently of tenant routing');
assert.match(notifications, /purpose === 'SERVICE' && channel === 'EMAIL'/,
  'service email is excluded from external fallback routing to prevent duplicate queues');
console.log('Account email notification preference: API, schema, migration, delivery policy: PASS');
