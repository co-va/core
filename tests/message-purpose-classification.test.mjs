import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const purpose = read('server/src/communication/message-purpose.ts');
const migration = read('server/prisma/migrations/20260919010000_message_purpose/migration.sql');
const communication = read('server/src/communication/communication.service.ts');
const dispatch = read('server/src/communication/communication-dispatch.service.ts');
const controller = read('server/src/communication/communication.controller.ts');
const broadcast = read('server/src/communication/communication-broadcast.service.ts');
const telegram = read('server/src/communication/telegram-bot.service.ts');
const notification = read('server/src/notification/notification.service.ts');
const notificationEvents = read('server/src/notification/notification-events.ts');
const bookingAccount = read('server/src/online-booking/online-booking.controller.ts');
const bookingFlow = read('server/src/online-booking/booking-flow.controller.ts');
const consentPolicy = read('server/src/tenant-document-archive/consent-policy.service.ts');

assert.match(purpose, /\['SYSTEM', 'SERVICE', 'DIRECT', 'MARKETING'\]/);
assert.match(purpose, /export type MessagePurpose/);

assert.match(migration, /ALTER TABLE "Notification"[\s\S]*ADD COLUMN IF NOT EXISTS "purpose" TEXT/);
assert.match(migration, /ALTER TABLE "CommunicationMessage"[\s\S]*ADD COLUMN IF NOT EXISTS "purpose" TEXT/);
assert.match(migration, /'SYSTEM', 'SERVICE', 'DIRECT', 'MARKETING'/);
assert.doesNotMatch(migration, /SET "purpose" = 'MARKETING'\s+WHERE "purpose" IS NULL;/);

assert.match(communication, /normalizeMessagePurpose\(input\?\.purpose\)/);
assert.match(communication, /Не указан purpose сообщения/);
assert.match(communication, /"kind", "purpose", "channel"/);

assert.match(dispatch, /purpose: MessagePurpose/);
assert.match(controller, /purpose: 'DIRECT'/);
assert.match(broadcast, /purpose: 'MARKETING'/);
assert.match(bookingAccount, /purpose: 'DIRECT'/);
assert.match(bookingFlow, /createEventForPerson\([\s\S]*type: 'booking\.created'/);

// Lifecycle events have one classification source: the event catalog. They are SERVICE, not SYSTEM.
assert.match(notificationEvents, /purpose: MessagePurpose/);
assert.match(notificationEvents, /function serviceEvent\(/);
assert.match(notificationEvents, /purpose: 'SERVICE' as const/);
assert.match(notification, /NOTIFICATION_EVENT_TYPES, notificationEventDefinition/);
assert.match(notification, /const definition = notificationEventDefinition\(type\)/);
assert.match(notification, /if \(!definition\) throw new BadRequestException\('Неизвестный тип сервисного уведомления'\)/);
assert.match(notification, /purpose: definition\.purpose/);
assert.doesNotMatch(notification, /purpose: definition\?\.purpose \|\| 'SERVICE'/);
assert.doesNotMatch(notification, /SYSTEM_EVENT_TYPES/);
assert.doesNotMatch(notification, /const DEFAULT_TEMPLATES/);

// SYSTEM remains reserved for platform-generated internal messages.
assert.match(telegram, /const purpose: MessagePurpose = 'SYSTEM'/);
assert.match(telegram, /purpose: 'DIRECT'/);
assert.match(telegram, /normalizeMessagePurpose\(input\?\.purpose\)/);
assert.match(telegram, /channel: 'TELEGRAM'/);

assert.match(notification, /purpose: MessagePurpose/);
assert.match(notification, /normalizeMessagePurpose\(input\.purpose\)/);
assert.match(notification, /"type", "purpose", "title"/);

// Marketing consent is purpose-specific. It must not gate SYSTEM, SERVICE or DIRECT.
assert.doesNotMatch(consentPolicy, /async canSendMessages\(/);
assert.match(consentPolicy, /async canSendMarketing\(/);
assert.match(consentPolicy, /MARKETING_CONSENT_DOCUMENT_ID = 'messages-consent'/);

assert.doesNotMatch(notification, /canSendMessages\(/);
assert.match(notification, /purpose !== 'MARKETING'/);
assert.match(notification, /canSendMarketing\(tenantId, channel, recipient\)/);

assert.doesNotMatch(telegram, /consentPolicy\.canSendMessages/);
assert.match(telegram, /purpose === 'MARKETING'[\s\S]*consentPolicy\.canSendMarketing/);
assert.match(broadcast, /documents\.canSendMarketing/);

assert.doesNotMatch(bookingAccount, /messages-consent/);
assert.doesNotMatch(bookingAccount, /telegram-consent/);
assert.doesNotMatch(bookingAccount, /ConsentPolicyService/);

console.log('Message purpose classification tests: OK');
