import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const policy = read('server/src/tenant-document-archive/consent-policy.service.ts');
const archive = read('server/src/tenant-document-archive/tenant-document-archive.service.ts');
const registry = read('server/src/document-registry/document-registry.service.ts');
const guard = read('server/src/online-booking/booking-pdn-consent.guard.ts');
const booking = read('server/src/online-booking/online-booking.service.ts');
const bookingFlow = read('server/src/online-booking/booking-flow.service.ts');
const bookingFlowController = read('server/src/online-booking/booking-flow.controller.ts');
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
assert.match(policy, /async updateCurrentContactConsent\(/, 'ConsentPolicy must own current contact consent updates');
assert.match(policy, /consentState:[\s\S]*\[field\]: active/, 'ConsentPolicy must materialize the current flag on Person');
assert.match(policy, /acceptContactPointConsent[\s\S]*updateCurrentContactConsent\([\s\S]*true/, 'accept must append history and activate current state');
assert.match(policy, /revokeContactPointConsent[\s\S]*updateCurrentContactConsent\([\s\S]*false/, 'revoke must append history and deactivate current state');
assert.match(archive, /consentInvalidations\(/);
assert.match(archive, /invalidateCurrentConsentState\(/);
assert.match(archive, /consentState:[\s\S]*\[field\]: false/, 'document version change must invalidate current state at update time');

assert.match(policy, /async accountConsentState\(/);
assert.doesNotMatch(policy, /async requiredConsentState\(/);
assert.match(guard, /accountConsentState\(auth\.tenantId, auth\.accountId\)/);
assert.match(guard, /if \(!state\.pdnActive\)/);
assert.doesNotMatch(guard, /state\.allowed/);

assert.match(booking, /async createRequest[\s\S]*hasActivePdnConsent\(tenantId, accountId\)/);
assert.doesNotMatch(booking, /async createRequest[\s\S]*requiredConsentState\(tenantId, accountId\)/);

const publicStateMethod = bookingFlow.match(/async bookingState\([\s\S]*?\n  private async resolvePerson/)?.[0] || '';
assert.match(publicStateMethod, /currentConsentState\(resolved\)/, 'Public Booking must read ready Person consent state');
assert.match(publicStateMethod, /pdnActive: legalState\.pdnActive/);
assert.match(publicStateMethod, /active: legalState\.marketingActive/);
assert.doesNotMatch(publicStateMethod, /getContext|documents|documentVersion|contactPointConsentState|latestEvent/, 'Public Booking state must not derive current consent from documents/history');
assert.doesNotMatch(bookingFlow, /documentVersion/, 'Public Booking must not carry document versions to determine current state');
assert.doesNotMatch(bookingFlowController, /bookingState\(tenantId, booker\)|documentVersion|Версия согласия изменилась/, 'controller must not add a second consent/version guard');
assert.match(bookingFlow, /if \(!state\.pdnActive\)[\s\S]*!fact\?\.accepted[\s\S]*ConflictException/, 'final Public Booking confirm must require PDN only when current state is inactive');
assert.match(bookingFlow, /!state\.marketingActive && facts\.get\(MARKETING_CONSENT_DOCUMENT_ID\)\?\.accepted/, 'advertising consent must remain optional and separate');

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