import assert from 'node:assert/strict';
import fs from 'node:fs';

const day = fs.readFileSync('journal/день.js', 'utf8');
const entry = fs.readFileSync('online-booking/user-entry.js', 'utf8');
const access = fs.readFileSync('online-booking/access.js', 'utf8');
const publicEntry = fs.readFileSync('online-booking/booking-entry.js', 'utf8');
const targetsController = fs.readFileSync('server/src/online-booking/account-booking-targets.controller.ts', 'utf8');

const dayActionStart = day.indexOf('function openAccountDayAction');
const dayActionEnd = day.indexOf('export function renderJournalDay', dayActionStart);
assert.ok(dayActionStart >= 0 && dayActionEnd > dayActionStart, 'Account Journal action owner must exist');
const dayAction = day.slice(dayActionStart, dayActionEnd);
const bookingActionStart = dayAction.indexOf("layer.querySelector('[data-account-day-booking]')");
const noteActionStart = dayAction.indexOf("layer.querySelector('[data-account-day-note]')", bookingActionStart);
assert.ok(bookingActionStart >= 0 && noteActionStart > bookingActionStart, 'Journal booking X action must exist');
const bookingAction = dayAction.slice(bookingActionStart, noteActionStart);
assert.match(bookingAction, /cova:account-journal-open-contacts/, 'Journal booking X action must hand off without creating local booking UI');
assert.doesNotMatch(bookingAction, /\bdate\b|\bfrom\b|timeHint|detail\s*:/, 'Journal booking must not inherit the tapped day or time');

assert.match(entry, /getGlobalAccountBookingTargets/, 'App Journal professional selector must use the narrow Account booking-targets projection');
assert.match(entry, /openRecordCreationOwner\(\)/, 'App Journal professional selector may use the existing Shared Record Q owner before Booking starts');
assert.match(entry, /title: 'Выбор специалиста'/, 'App Journal first selector step must be professional selection');
assert.match(entry, /recordPersonList\(/, 'Professional selection must use the Shared Record person list');

assert.match(targetsController, /this\.prisma\.accountTenantLink\.findMany/, 'Booking targets must start from existing AccountTenantLink relationships');
assert.match(targetsController, /this\.prisma\.profile\.findMany/, 'Booking targets must read the existing Profile source directly');
assert.match(targetsController, /orderBy: \{ createdAt: 'asc' \}/, 'Booking targets must preserve the existing first-created Profile semantics');
for (const field of ['tenantId', 'name', 'surname', 'profession', 'phone']) {
  assert.match(targetsController, new RegExp(`${field}: true`), `Booking targets Profile projection must include ${field}`);
}
assert.doesNotMatch(targetsController, /ProfileService|accountRelationshipProfile/, 'Booking targets must not load the full relationship Profile/Card');
assert.doesNotMatch(targetsController, /photo|photoCropX|photoCropY|about|cardAppearance|workplaces/, 'Booking targets must not request Card-level Profile or workplace data');

const journalStart = entry.indexOf('async function startJournalBooking');
const selectorStart = entry.indexOf('async function openAccountBookingProfessionalSelector', journalStart);
assert.ok(journalStart >= 0 && selectorStart > journalStart, 'Journal booking handoff must exist');
const journalBooking = entry.slice(journalStart, selectorStart);
assert.match(journalBooking, /workplaceKey: ''/, 'Journal booking must start without a preselected workplace');
assert.match(journalBooking, /procedureIds: \[\]/, 'Journal booking must start without preselected procedures');
assert.doesNotMatch(journalBooking, /\bdate\s*:|timeHint|\bfrom\s*:/, 'Journal booking must not preselect date or time');

assert.match(access, /variant: 'technical'/, 'Canonical Booking must use the existing Shared technical modal');
assert.match(access, /className: 'booking-technical-modal'/, 'Canonical Booking must stay inside the technical modal surface');
assert.doesNotMatch(access, /openRecordCreationOwner\(|creationOwner:\s*state\./, 'Canonical Booking must not reuse the App Record Q as its Booking shell');
assert.match(access, /if \(workplaces\.length === 1\)/, 'Single workplace must be skipped by the canonical booking logic');
assert.doesNotMatch(access, /renderLegal|renderAccountEntry|passwordField|account\/login|account\/register/, 'Canonical Booking must not contain App authentication or onboarding gates');

assert.match(publicEntry, /renderAccess\(root, route\)/, 'Public entry must open the same canonical Booking flow');
assert.doesNotMatch(publicEntry, /startAccountRuntime|renderGlobalClient|user-entry\.js|core\.js/, 'Public entry must not load the App runtime');

console.log('account Journal and public Booking ownership: ok');
