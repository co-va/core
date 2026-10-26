import assert from 'node:assert/strict';
import fs from 'node:fs';

const day = fs.readFileSync('journal/день.js', 'utf8');
const entry = fs.readFileSync('online-booking/user-entry.js', 'utf8');
const access = fs.readFileSync('online-booking/access.js', 'utf8');

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

assert.match(entry, /getGlobalAccountBookingTargets/, 'First booking step must use the narrow Account booking-targets projection');
assert.match(entry, /openRecordCreationOwner\(\)/, 'Professional selection must use the Shared Record Q owner');
assert.match(entry, /title: 'Выбор специалиста'/, 'First Q step must be professional selection');
assert.match(entry, /recordPersonList\(/, 'Professional selection must use the Shared Record person list');

const journalStart = entry.indexOf('async function startJournalBooking');
const selectorStart = entry.indexOf('async function openAccountBookingProfessionalSelector', journalStart);
assert.ok(journalStart >= 0 && selectorStart > journalStart, 'Journal booking handoff must exist');
const journalBooking = entry.slice(journalStart, selectorStart);
assert.match(journalBooking, /workplaceKey: ''/, 'Journal booking must start without a preselected workplace');
assert.match(journalBooking, /procedureIds: \[\]/, 'Journal booking must start without preselected procedures');
assert.doesNotMatch(journalBooking, /\bdate\s*:|timeHint|\bfrom\s*:/, 'Journal booking must not preselect date or time');
assert.match(journalBooking, /creationOwner,\s*onExitToAccount:/, 'Professional selection Q must be handed into the canonical booking flow');
assert.doesNotMatch(journalBooking, /finally[\s\S]*creationOwner\?\.close|selectorOwner\?\.close/, 'Journal booking must not close one Q and open a second Q');

assert.match(access, /creationOwner = null/, 'Account booking must accept an existing Shared Record Q owner');
assert.match(access, /creationOwner: state\.creationOwner\?\.isOpen\?\.\(\) \? state\.creationOwner : null/, 'Canonical openRecords must reuse the professional-selection Q');
assert.match(access, /workplaces\.length === 1 \? String\(workplaces\[0\]\?\.key \|\| ''\) : ''/, 'Single workplace must be skipped by the existing booking logic');
assert.match(access, /if \(!platform\?\.accepted \|\| !tenant\?\.pdnActive\) \{[\s\S]*?releaseCreationOwner\(state\);[\s\S]*?renderLegal/, 'Legal requirements must leave the Q before rendering the legal surface');
assert.match(access, /else \{[\s\S]*?releaseCreationOwner\(state\);[\s\S]*?renderAccountEntry/, 'Missing identity must leave the Q before rendering authentication');

console.log('account Journal booking owner: ok');
