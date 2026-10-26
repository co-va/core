import fs from 'node:fs';

const failures = [];
const expect = (value, message) => { if (!value) failures.push(message); };
const read = (path) => fs.readFileSync(path, 'utf8');

const records = read('core/records/records.js');
const view = read('core/records/view.js');
const owner = read('ui/record/creation-flow.js');
const day = read('journal/день.js');
const journalCreation = read('journal/creation-flow.js');
const eventCreation = read('journal/event-create.js');
const personEntry = read('core/people/record-creation.js');
const booking = read('online-booking/access.js');
const bookingHtml = read('booking.html');
const bookingEntry = read('online-booking/booking-entry.js');
const userEntry = read('online-booking/user-entry.js');
const serverMain = read('server/src/main.ts');
const bookingController = read('server/src/online-booking/online-booking.controller.ts');
const bookingFlowService = read('server/src/online-booking/booking-flow.service.ts');

expect(!fs.existsSync('journal/record.js'), 'journal/record.js must not exist.');
expect(!fs.existsSync('journal/record-view.js'), 'journal/record-view.js must not exist.');
expect(!fs.existsSync('journal/journal-view.js'), 'journal/journal-view.js must not exist.');
expect(!fs.existsSync('journal/record-creation-x.js'), 'journal/record-creation-x.js must not exist.');
expect(!fs.existsSync('core/records/actions.js'), 'core/records/actions.js must not exist.');
expect(fs.existsSync('core/records/view.js'), 'Record View must live in core/records/view.js.');
expect(view.includes('export function openRecordView'), 'core/records/view.js must own Record View.');
expect(records.includes('export function openRecords'), 'core/records/records.js must own the Records flow.');
expect(owner.includes("variant: 'q'"), 'Records must use the canonical Q modal owner.');
expect(owner.includes('setShellHeader'), 'Shared creation owner must expose a persistent shell header slot.');
expect(day.includes("import('./creation-flow.js')"), 'Journal Day must open the Journal-owned creation shell for a free slot.');
expect(day.includes("import('../core/records/view.js')"), 'Journal Day must open Record View for an existing plaque.');
expect(journalCreation.includes("from '../core/records/records.js'"), 'Journal creation shell must mount canonical Records as the Record body.');
expect(journalCreation.includes("label: 'Запись'"), 'Journal creation shell must own the Record mode label.');
expect(journalCreation.includes("label: 'Событие'"), 'Journal creation shell must own the Event mode label.');
expect(journalCreation.includes("activeMode = 'record'"), 'Journal creation shell must default to Record mode.');
expect(records.includes('creationOwner = null'), 'Records must support an externally owned creation shell.');
expect(records.includes('owner.resumeRecord'), 'Records must expose resume of the existing Record state.');
expect(records.includes('state.timeHint'), 'Records must keep the Journal time hint inside Record state.');
expect(records.includes('state.from = value'), 'Records must promote the selected time into Record state.');
expect(!records.includes('createJournalBreak') && !records.includes('createEvent'), 'Records must not create Break or Event.');
expect(!records.includes('JOURNAL_MODES'), 'Records must not own the Journal mode switch.');
expect(!records.includes('allowBreak'), 'Records must not route between Record and Break.');
expect(eventCreation.includes('createEvent'), 'Event creation must live in the Event flow.');
expect(eventCreation.includes('timeHint'), 'Event flow must receive the original Timeline time hint.');
expect(personEntry.includes("from '../records/records.js'"), 'Person entry must call canonical Records.');

expect(!booking.includes("core/records/records.js") && !booking.includes('openRecords('), 'Public Booking must not load the App Records flow.');
expect(bookingFlowService.includes("from '../record/record.service'"), 'Public Booking server confirmation must use the canonical RecordService owner.');
expect(bookingFlowService.includes('this.records.create(tenantId'), 'Public Booking must create ordinary Records through RecordService.');

expect(bookingHtml.includes('online-booking/booking-entry.js'), 'Public Booking HTML must load its isolated Booking entry.');
for (const forbidden of ['core.js', 'online-booking/user-entry.js', 'account-runtime.js']) {
  expect(!bookingHtml.includes(forbidden), `Public Booking HTML must not load ${forbidden}.`);
}
for (const forbidden of ['journal/', 'core/finance/', 'core/people/', 'core/profile/runtime', './account-runtime.js', './booking.js']) {
  expect(!bookingEntry.includes(forbidden), `Public Booking entry must not import App runtime dependency ${forbidden}.`);
}
expect(bookingEntry.includes("from './access.js'"), 'Public Booking entry must open the isolated technical Booking flow.');
expect(!userEntry.includes("from './access.js'") && !userEntry.includes('renderAccess('), 'App Journal Booking must not enter the Public technical Booking shell.');
expect(userEntry.includes("from '../core/records/records.js'") && userEntry.includes('openRecords({'), 'App Journal Booking must reuse canonical Records inside the Shared Q owner.');
expect(userEntry.includes('createBookingRequest(id,'), 'App Journal Booking must use the authenticated Account Booking write.');
expect(bookingController.includes('@UseGuards(AccountGuard, BookingPdnConsentGuard)')
  && bookingController.includes("@Post(':tenantId/requests')")
  && bookingController.includes('this.booking.createRequest(tenantId, accountId'),
'Authenticated App Booking write must exist behind Account + PDN guards.');
expect(!booking.includes('createBookingRequest(') && !bookingEntry.includes('createBookingRequest('), 'Public Booking must not use the authenticated App Booking write.');
expect(!userEntry.includes('resolveBookingPublicRoute') && !userEntry.includes('startAccountRuntime'), 'App user entry must not contain a public Booking fallback into App runtime.');
expect(serverMain.includes("response.sendFile(resolve(siteRoot, 'booking.html'))"), 'USER_HOST public Booking paths must resolve to isolated booking.html.');

expect(!fs.existsSync('records/records.js'), 'Root records/records.js must not remain after Records moved into Core.');
expect(!fs.existsSync('core/records.js'), 'Core must not contain Records JS directly; Records must live in core/records/records.js.');

if (failures.length) {
  console.error('Records compatibility check failed:\n- ' + failures.join('\n- '));
  process.exit(1);
}
console.log('Records compatibility check passed.');
