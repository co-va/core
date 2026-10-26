import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const policy = read('server/src/tenant-document-archive/consent-policy.service.ts');
const registry = read('server/src/document-registry/document-registry.service.ts');
const guard = read('server/src/online-booking/booking-pdn-consent.guard.ts');
const booking = read('server/src/online-booking/online-booking.service.ts');
const bookingFlow = read('server/src/online-booking/booking-flow.service.ts');
const notification = read('server/src/notification/notification.service.ts');
const telegram = read('server/src/communication/telegram-bot.service.ts');
const email = read('server/src/communication/email-channel.service.ts');
const broadcast = read('server/src/communication/communication-broadcast.service.ts');
const dispatch = read('server/src/communication/communication-dispatch.service.ts');
const communicationController = read('server/src/communication/communication.controller.ts');

assert.match(registry, /user-document-pdn-consent'[\s\S]*?documentId: 'pdn-consent'[\s\S]*?personConsent: true[\s\S]*?required: true/, 'PDN consent must remain mandatory where the document flow requires it');
assert.match(registry, /user-document-messages-consent'[\s\S]*?documentId: 'messages-consent'[\s\S]*?personConsent: true[\s\S]*?required: false/, 'Marketing consent must remain optional');

assert.match(policy, /const PDN_CONSENT_DOCUMENT_ID = 'pdn-consent'/);
assert.match(policy, /const MARKETING_CONSENT_DOCUMENT_ID = 'messages-consent'/);
assert.match(policy, /async hasActivePdnConsent\(/);
assert.match(policy, /FROM "TenantConsentEvent"[\s\S]*"subjectType" = 'ACCOUNT'/);
assert.match(policy, /async canSendMarketing\([\s\S]*MARKETING_CONSENT_DOCUMENT_ID/);
assert.match(policy, /latest\?\.status === 'accepted' && latest\.documentVersion === documentVersion\) return publicEvent\(latest\)/, 're-accepting the same current contact-point consent must be idempotent');
assert.match(policy, /latest\.status === 'accepted'[\s\S]*latest\.documentVersion === Math\.max\(1, Number\(document\.version \|\| 1\)\)/, 'active contact-point consent must match the current document version');

assert.match(policy, /async accountConsentState\(/);
assert.doesNotMatch(policy, /async requiredConsentState\(/);
assert.match(guard, /accountConsentState\(auth\.tenantId, auth\.accountId\)/);
assert.match(guard, /if \(!state\.pdnActive\)/);
assert.doesNotMatch(guard, /state\.allowed/);

assert.match(booking, /async createRequest[\s\S]*hasActivePdnConsent\(tenantId, accountId\)/);
assert.doesNotMatch(booking, /async createRequest[\s\S]*requiredConsentState\(tenantId, accountId\)/);
assert.match(bookingFlow, /if \(current\?\.allowed\) continue;/, 'Public Booking confirm must not create another fact for an already-current consent');
assert.match(bookingFlow, /const required = Boolean\(document\?\.required\) && documentId !== 'messages-consent'/, 'advertising consent must stay optional in Public Booking');
assert.match(bookingFlow, /if \(required && !fact\?\.accepted\)[\s\S]*ConflictException/, 'final Public Booking confirm must keep the mandatory legal guard');

// Delivery contract: DIRECT / SERVICE / SYSTEM are operational messages and must not be gated by PDN consent.
// Only MARKETING delivery checks the separate advertising/messages consent.
assert.doesNotMatch(notification, /hasActivePdnConsent\(tenantId, identity\.accountId\)/);
assert.match(notification, /purpose !== 'MARKETING'\) return true/);
assert.match(notification, /canSendMarketing\(tenantId, channel, recipient\)/);

assert.doesNotMatch(telegram, /hasActivePdnConsentForContact\(tenantId, 'TELEGRAM', identity\.externalUserId\)/);
assert.match(telegram, /purpose === 'MARKETING'[\s\S]*canSendMarketing/);

assert.doesNotMatch(email, /hasActivePdnConsentForContact\(tenantId, 'EMAIL', identity\.externalUserId\)/);
assert.match(email, /purpose === 'MARKETING'[\s\S]*canSendMarketing/);

assert.doesNotMatch(broadcast, /hasActivePdnConsentFor(?:Contact|Identity)\(/);
assert.match(broadcast, /canSendMarketing\(tenantId, channel, destination\)/);

assert.match(communicationController, /sendChatMessage[\s\S]*purpose: 'DIRECT'/, 'Personal D must remain DIRECT, not MARKETING');
assert.doesNotMatch(dispatch, /hasActivePdnConsent/, 'Personal D must not be gated by PDN consent');
assert.doesNotMatch(dispatch, /canSendMarketing/, 'Personal D dispatch must not require advertising consent');

console.log('Consent access contract tests: OK');
