import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const consentPolicy = read('server/src/tenant-document-archive/consent-policy.service.ts');
const bookingController = read('server/src/online-booking/online-booking.controller.ts');
const bookingFlowController = read('server/src/online-booking/booking-flow.controller.ts');
const bookingFlowService = read('server/src/online-booking/booking-flow.service.ts');
const pdnGuard = read('server/src/online-booking/booking-pdn-consent.guard.ts');
const notification = read('server/src/notification/notification.service.ts');
const dispatch = read('server/src/communication/communication-dispatch.service.ts');
const broadcast = read('server/src/communication/communication-broadcast.service.ts');
const telegram = read('server/src/communication/telegram-bot.service.ts');

assert.match(consentPolicy, /PDN_CONSENT_DOCUMENT_ID = 'pdn-consent'/);
assert.match(consentPolicy, /async hasActivePdnConsent\(/);
assert.match(consentPolicy, /async hasActivePdnConsentForContact\(/);
assert.match(consentPolicy, /async hasActivePdnConsentForIdentity\(/);
assert.match(pdnGuard, /class BookingPdnConsentGuard/);
assert.match(pdnGuard, /code: 'PDN_CONSENT_REQUIRED'/);
assert.match(pdnGuard, /accountConsentState\(auth\.tenantId, auth\.accountId\)/);
assert.match(pdnGuard, /if \(!state\.pdnActive\)/);
assert.doesNotMatch(pdnGuard, /requiredConsentState/);
assert.doesNotMatch(consentPolicy, /async requiredConsentState\(/);

assert.match(bookingController, /@UseGuards\(AccountGuard\)\s+@Get\(':tenantId\/account\/records'\)/);
assert.match(bookingController, /@UseGuards\(AccountGuard\)\s+@Get\(':tenantId\/account\/notifications'\)/);
assert.match(bookingController, /@UseGuards\(AccountGuard\)\s+@Post\(':tenantId\/account\/notifications\/:notificationId\/read'\)/);
assert.match(bookingController, /@UseGuards\(AccountGuard\)\s+@Get\(':tenantId\/account\/chat'\)/);
assert.match(bookingController, /@UseGuards\(AccountGuard\)\s+@Post\(':tenantId\/account\/chat\/messages'\)/);
assert.doesNotMatch(bookingController, /@UseGuards\(AccountGuard, BookingPdnConsentGuard\)\s+@(?:Get|Post)\(':tenantId\/account\/chat/);
assert.match(bookingController, /@UseGuards\(AccountGuard, BookingPdnConsentGuard\)\s+@Post\(':tenantId\/requests'\)/, 'App Journal Record-write endpoint must remain account-authenticated and PDN-gated');
assert.match(bookingFlowController, /@Post\(':tenantId\/confirm'\)/);
assert.doesNotMatch(bookingFlowController, /AccountGuard|BookingPdnConsentGuard/);
assert.match(bookingFlowService, /ensureLegalState\(tenantId, bookerPerson, booker\.phone, source\.consents\)/);
assert.match(bookingFlowService, /const state = currentConsentState\(person\)/);
assert.doesNotMatch(bookingFlowService, /contactPointConsentState\(/, 'Public Booking legal state must not be recomputed from consent history');
assert.match(bookingFlowService, /acceptContactPointConsent\([\s\S]*'public-booking'/);

// PDN remains part of the document/booking contract, but it must not gate message delivery.
assert.doesNotMatch(notification, /hasActivePdnConsent\(tenantId, identity\.accountId\)/);
assert.doesNotMatch(notification, /hasActivePdnConsent\(tenantId, accountId\)/);
assert.match(notification, /purpose !== 'MARKETING'[\s\S]*canSendMarketing/);

assert.doesNotMatch(broadcast, /hasActivePdnConsentFor(?:Contact|Identity)\(/);
assert.doesNotMatch(broadcast, /reason: 'no-pdn-consent'/);
assert.match(broadcast, /reason: 'no-marketing-consent'/);
assert.match(broadcast, /canSendMarketing\(tenantId, channel, destination\)/);

assert.doesNotMatch(dispatch, /hasActivePdnConsent/);
assert.doesNotMatch(telegram, /ConsentPolicyService|hasActivePdnConsentForContact|canSendMarketing|purpose === 'MARKETING'|blocked: 'PDN_CONSENT_REQUIRED'/);

console.log('PDN grey-zone tests: OK');
