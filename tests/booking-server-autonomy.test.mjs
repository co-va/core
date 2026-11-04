import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const bookingConsent = fs.readFileSync('server/src/online-booking/booking-consent.controller.ts', 'utf8');
const record = fs.readFileSync('server/src/record/record.service.ts', 'utf8');
const time = fs.readFileSync('server/src/time/time.service.ts', 'utf8');
const finance = fs.readFileSync('server/src/finance/finance.service.ts', 'utf8');
const business = fs.readFileSync('server/src/business-state/business-state.service.ts', 'utf8');
const consentPolicy = fs.readFileSync('server/src/tenant-document-archive/consent-policy.service.ts', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const serverSync = fs.readFileSync('online-booking/server-sync.js', 'utf8');

const request = service.slice(service.indexOf('async createRequest('), service.indexOf('async getMyRecords('));
assert.match(request, /this\.records\.create\(/);
assert.match(request, /source:\s*'online-booking'/);
assert.match(request, /status:\s*BookingRequestStatus\.IMPORTED/);
assert.match(request, /importedRecordId:\s*text\(record\.id\)/);
assert.doesNotMatch(request, /recordSnapshot/);
assert.match(request, /this\.time\.isPastZonedStart\(date, from, workplace\?\.timeZone\)/);
assert.match(request, /Это время уже прошло/);

assert.match(service, /this\.records\.publicOccupancy\(/);
assert.doesNotMatch(service, /this\.time\.checkAvailability\(/);
assert.doesNotMatch(service, /function\s+timeToMinutes\(/);
assert.doesNotMatch(service, /function\s+rangesOverlap\(/);
assert.doesNotMatch(service, /function\s+procedureCost\(/);
assert.doesNotMatch(service, /initialRequestSnapshot|recordSnapshot|manualRecordViews/);

assert.match(record, /this\.procedures\.snapshots\(/);
assert.match(record, /this\.finance\.calculateSettlement\(/);
assert.match(record, /this\.time\.checkAvailability\(/);
assert.match(record, /async\s+listForPeople\(/);

assert.match(time, /checkAvailability\(/);
assert.match(time, /isPastZonedStart\(/);
assert.match(time, /Intl\.DateTimeFormat/);
assert.match(finance, /calculateSettlement\(/);
assert.match(finance, /recordSettlementPaymentState\(/);
assert.match(finance, /state:\s*due <= 0\.009 \? 'paid' : paid > 0\.009 \? 'partial' : 'unpaid'/);

assert.doesNotMatch(business, /createOnlineBookingRecord|publicBookingOccupancy|bookingRecordSnapshot/);
assert.match(controller, /@Get\(':tenantId\/account\/records'\)/);
assert.doesNotMatch(controller, /@Get\(':tenantId\/account\/requests'\)/);

assert.doesNotMatch(service, /acceptAccountConsents/);
assert.match(bookingConsent, /acceptAccountConsents\(auth\.tenantId, auth\.accountId/);
assert.match(consentPolicy, /INSERT INTO "TenantConsentEvent"/);

assert.match(core, /function ensureServerBookingSync\(\) \{[\s\S]*if \(serverBookingSyncStarted\) return;[\s\S]*startServerBookingSync\(\);/);
assert.doesNotMatch(core, /serverBookingSyncStarted \|\| !canUseBookCapability\('online_booking\.access'\)/);
assert.match(serverSync, /hydrateRecordStateFromServer\(\{ records: business\.records \|\| \[\], recordEvents: business\.recordEvents \|\| \[\] \}\)/);
assert.match(serverSync, /book:records-changed/);

console.log('booking server autonomy tests passed');
