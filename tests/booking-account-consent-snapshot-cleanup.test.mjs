import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const bookingService = read('server/src/online-booking/online-booking.service.ts');
const bookingConsent = read('server/src/online-booking/booking-consent.controller.ts');
const pdnGuard = read('server/src/online-booking/booking-pdn-consent.guard.ts');
const peopleUi = read('core/people/people.js');
const consentCache = read('settings/documents/consents.js');
const documentRuntime = read('core/runtime/tenant-document-archive.js');
const schema = read('server/prisma/schema.prisma');
const dropMigration = read('server/prisma/migrations/20260919132000_drop_booking_account_consents/migration.sql');

// Account consent JSON is no longer a runtime source or mirror.
assert.doesNotMatch(bookingService, /consents:\s*arrayValue\(account\.consents\)/);
assert.doesNotMatch(bookingService, /consents:\s*true/);
assert.doesNotMatch(pdnGuard, /derivedConsents/);
assert.doesNotMatch(pdnGuard, /account\.updateMany/);
assert.doesNotMatch(pdnGuard, /PrismaService/);

// Account registration is independent from Tenant consent. The dedicated controller writes canonical Tenant consent facts.
assert.doesNotMatch(bookingService, /acceptAccountConsents/);
assert.doesNotMatch(bookingService, /acceptContactPointConsent/);
assert.match(bookingConsent, /acceptAccountConsents\(auth\.tenantId, auth\.accountId/);

// The legacy DB column is physically removed; ConsentEvent is the only persisted consent store.
assert.doesNotMatch(schema, /consents\s+Json/);
assert.doesNotMatch(bookingService, /consents:\s*\[\]\s+as Prisma\.InputJsonValue/);
assert.match(dropMigration, /ALTER TABLE "BookingAccount" DROP COLUMN "consents"/);

// Profile-side Person consent markers must be projected from canonical server ConsentEvent data.
assert.match(documentRuntime, /hydrateConsentsFromServer\(value\.consents\)/);
assert.match(consentCache, /export function getConsents\(\)/);
assert.match(peopleUi, /getConsents/);
assert.match(peopleUi, /fact\?\.subjectType\s*===\s*'ACCOUNT'/);
assert.match(peopleUi, /fact\?\.subjectType\s*!==\s*'CONTACT_POINT'/);
assert.doesNotMatch(peopleUi, /p\.agreements/);
assert.doesNotMatch(peopleUi, /account\.consents/);

console.log('Account consent snapshot cleanup tests: OK');
