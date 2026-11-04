import fs from 'node:fs';

function text(path) { return fs.readFileSync(path, 'utf8'); }
function assert(condition, message) { if (!condition) throw new Error(message); }

const core = text('core.js');
const service = text('server/src/online-booking/online-booking.service.ts');
const controller = text('server/src/online-booking/online-booking.controller.ts');
const bookingConsent = text('server/src/online-booking/booking-consent.controller.ts');
const accountDocuments = text('server/src/document-registry/account-document.service.ts');
const business = text('server/src/business-state/business-state.service.ts');
const record = text('server/src/record/record.service.ts');
const time = text('server/src/time/time.service.ts');
const finance = text('server/src/finance/finance.service.ts');
const procedure = text('server/src/procedure/procedure.service.ts');
const personIdentity = text('server/src/online-booking/person-identity.service.ts');
const account = text('core/account/index.js');
const sync = text('online-booking/server-sync.js');

assert(!core.includes('owner-bridge'), 'core.js must not start the legacy owner booking bridge');
assert(core.includes('startServerBookingSync'), 'Book must use server-owned live refresh');

const contextBlock = service.slice(service.indexOf('async getContext('), service.indexOf('async prepareAccount('));
assert(!contextBlock.includes('this.publication('), 'public booking context must not depend on BookingPublication');

const requestBlock = service.slice(service.indexOf('async createRequest('), service.indexOf('async getMyRecords('));
assert(requestBlock.includes('this.records.create('), 'Online Booking must call canonical RecordService.create');
assert(requestBlock.includes("source: 'online-booking'"), 'Online Booking must preserve source on Record creation');
assert(requestBlock.includes('BookingRequestStatus.IMPORTED'), 'BookingRequest must end by linking to the created Record');
assert(requestBlock.includes('importedRecordId: text(record.id)'), 'BookingRequest must preserve the resulting recordId');
assert(!requestBlock.includes('recordSnapshot'), 'BookingRequest must not own a post-create Record snapshot');

assert(service.includes('this.records.publicOccupancy('), 'Online Booking availability must read canonical Record occupancy');
assert(!service.includes('this.time.checkAvailability('), 'Online Booking must not own final availability checks');
assert(!service.includes('function timeToMinutes('), 'Online Booking must not reimplement time parsing');
assert(!service.includes('function rangesOverlap('), 'Online Booking must not reimplement overlap rules');
assert(!service.includes('function procedureCost('), 'Online Booking must not reimplement procedure price ownership');
assert(!service.includes('initialRequestSnapshot'), 'Online Booking must not calculate its own finance snapshot');
assert(!service.includes('recordSnapshot'), 'Online Booking runtime must not use BookingRequest.recordSnapshot');
assert(!service.includes('manualRecordViews'), 'Online Booking must not wrap Records as BookingRequests');

assert(record.includes('this.time.checkAvailability('), 'RecordService must use TimeService');
assert(record.includes('this.procedures.snapshots('), 'RecordService must obtain procedure snapshots from ProcedureService');
assert(record.includes('this.finance.calculateSettlement('), 'RecordService must obtain Settlement from FinanceService');
assert(record.includes('async listForPeople('), 'Account history must read canonical Records');
assert(record.includes('async publicOccupancy('), 'Record must own its occupancy projection');

assert(time.includes('checkAvailability('), 'TimeService must own availability rules');
assert(finance.includes('calculateSettlement('), 'FinanceService must own Settlement calculations');
assert(finance.includes('recordSettlementPaymentState('), 'FinanceService must own Settlement payment state');
assert(procedure.includes('async snapshots('), 'ProcedureService must own booking-time procedure snapshots');

assert(account.includes('getAccountRecords'), 'Account API contract must expose Records');
assert(account.includes('/account/records'), 'Account API must use the Records endpoint');
assert(!account.includes('getAccountRequests'), 'Account API must not expose BookingRequests as history');

assert(!business.includes('createOnlineBookingRecord'), 'BusinessState must not own a second Record constructor');
assert(!business.includes('publicBookingOccupancy'), 'BusinessState must not own Record occupancy');
assert(!business.includes('bookingRecordSnapshot'), 'BusinessState must not adapt Record back into Booking snapshots');

assert(controller.includes("@Get(':tenantId/account/records')"), 'Account history endpoint must be Records');
assert(!controller.includes("@Get(':tenantId/account/requests')"), 'Account history must not be a BookingRequest endpoint');

assert(!service.includes('acceptAccountConsents'), 'Account registration must not write Tenant consent facts.');
assert(service.includes('accountDocuments.accept('), 'Account registration must record platform Account terms separately.');
assert(bookingConsent.includes('acceptAccountConsents'), 'Tenant consent facts must be written only by the dedicated consent controller.');
assert(accountDocuments.includes('FROM "AccountDocumentEvent"') && accountDocuments.includes('INSERT INTO "AccountDocumentEvent"'), 'Global Account terms must use the append-only Account document event owner.');
assert(!service.includes('recordAcceptedConsents'), 'online booking must not write legacy consent JSON');
assert(!business.includes('upsertPersonFromAccount'), 'BusinessState must not own a parallel Account-to-Person mapper.');
assert(personIdentity.includes('class PersonIdentityService') && personIdentity.includes('businessState.upsertPerson'), 'PersonIdentityService must own Account-to-Person resolution and enrichment.');
assert(!sync.includes('/online-booking/owner/publication'), 'browser sync must not publish booking context');
assert(!sync.includes('/online-booking/owner/requests'), 'browser sync must not import booking requests');

console.log('booking server autonomy check: OK');
