import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBookingSlots } from '../online-booking/model.js';

const day = fs.readFileSync('journal/день.js', 'utf8');
const entry = fs.readFileSync('online-booking/user-entry.js', 'utf8');
const access = fs.readFileSync('online-booking/access.js', 'utf8');
const publicEntry = fs.readFileSync('online-booking/booking-entry.js', 'utf8');
const targetsClient = fs.readFileSync('core/account/booking-targets.js', 'utf8');
const targetsController = fs.readFileSync('server/src/online-booking/account-booking-targets.controller.ts', 'utf8');
const bookingService = fs.readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');

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

assert.match(targetsClient, /\/online-booking\/account\/booking-targets/, 'Professional selector must keep the existing Account booking-targets endpoint');
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
assert.match(journalBooking, /renderAccess\(content/, 'Professional selection must continue into the existing canonical Booking');
assert.match(journalBooking, /workplaceKey: ''/, 'Journal booking must start without a preselected workplace');
assert.match(journalBooking, /procedureIds: \[\]/, 'Journal booking must start without preselected procedures');
assert.doesNotMatch(journalBooking, /\bdate\s*:|timeHint|\bfrom\s*:/, 'Journal booking must not preselect date or time');

const contextStart = bookingService.indexOf('async getContext');
const prepareAccountStart = bookingService.indexOf('async prepareAccount', contextStart);
assert.ok(contextStart >= 0 && prepareAccountStart > contextStart, 'Canonical Booking context owner must exist');
const bookingContext = bookingService.slice(contextStart, prepareAccountStart);
assert.doesNotMatch(bookingContext, /this\.bookingSource\(|publicBookingBundle|data\.profile|profile:\s*objectValue/, 'Booking context must not load or return Profile/Card payload');
assert.match(bookingContext, /this\.prisma\.workplace\.findMany/, 'Booking context must load workplaces directly instead of going through Profile/Card');
for (const field of ['key', 'name', 'city', 'address', 'timeZone', 'from', 'to', 'visibleInPublicBooking']) {
  assert.match(bookingContext, new RegExp(`${field}: true`), `Booking workplace source projection must include ${field}`);
}
for (const field of ['key', 'name', 'city', 'address', 'timeZone', 'from', 'to']) {
  assert.match(bookingContext, new RegExp(`${field}: text\\(workplace\\?\\.${field}\\)`), `Booking workplace context must expose ${field}`);
}
assert.doesNotMatch(bookingContext, /photo|photoCropX|photoCropY|cardAppearance|cardProfile|\babout\b/, 'Booking context must not expose workplace Card payload');
for (const preserved of ['procedures', 'days', 'documents', 'occupancy']) {
  assert.match(bookingContext, new RegExp(`\\b${preserved}\\b`), `Booking context must preserve ${preserved}`);
}

assert.match(access, /variant: 'technical'/, 'Canonical Booking must use the existing Shared technical modal');
assert.match(access, /className: 'booking-technical-modal'/, 'Canonical Booking must stay inside the technical modal surface');
assert.doesNotMatch(access, /openRecordCreationOwner\(|creationOwner:\s*state\./, 'Canonical Booking must not reuse the App Record Q as its Booking shell');
assert.match(access, /if \(workplaces\.length === 1\)/, 'Single workplace must be skipped by the canonical booking logic');
assert.doesNotMatch(access, /renderLegal|renderAccountEntry|passwordField|account\/login|account\/register/, 'Canonical Booking must not contain App authentication or onboarding gates');

const workplaceRenderStart = access.indexOf('function renderWorkplace');
const modeRenderStart = access.indexOf('function renderMode', workplaceRenderStart);
assert.ok(workplaceRenderStart >= 0 && modeRenderStart > workplaceRenderStart, 'Canonical workplace renderer must exist');
const workplaceRender = access.slice(workplaceRenderStart, modeRenderStart);
assert.match(workplaceRender, /v2ListEntry\(/, 'Workplace selection must keep Shared v2ListEntry');
for (const field of ['name', 'city', 'address', 'key']) {
  assert.match(workplaceRender, new RegExp(`workplace\\?\\.${field}`), `Workplace selection must keep using ${field}`);
}
assert.doesNotMatch(workplaceRender, /profile|photo|cardAppearance|cardProfile/, 'Workplace selection must not depend on Profile/Card data');

const initialStepStart = access.indexOf('function initialStep');
const renderAccessStart = access.indexOf('export async function renderAccess', initialStepStart);
assert.ok(initialStepStart >= 0 && renderAccessStart > initialStepStart, 'Canonical Booking initial step must exist');
const initialStepSource = access.slice(initialStepStart, renderAccessStart);
const initialStep = Function('text', `${initialStepSource}\nreturn initialStep;`)((value) => String(value ?? '').trim());

const singleWorkplaceState = {
  context: { workplaces: [{ key: 'only' }] },
  lockedWorkplaceKey: '',
  workplaceKey: '',
};
assert.deepEqual(initialStep(singleWorkplaceState), { kind: 'mode', index: 0 }, 'One workplace must skip the selector');
assert.equal(singleWorkplaceState.workplaceKey, 'only', 'One workplace must be selected automatically');

const multipleWorkplaceState = {
  context: { workplaces: [{ key: 'one' }, { key: 'two' }] },
  lockedWorkplaceKey: '',
  workplaceKey: '',
};
assert.deepEqual(initialStep(multipleWorkplaceState), { kind: 'workplace', index: 0 }, 'Multiple workplaces must open the selector');
assert.equal(multipleWorkplaceState.workplaceKey, '', 'Multiple workplaces must not preselect a workplace');

const leanBookingContext = {
  workplaces: [{
    key: 'one',
    name: 'Пространство',
    city: 'Москва',
    address: 'Адрес',
    timeZone: 'Europe/Moscow',
    from: '10:00',
    to: '18:00',
  }],
  procedures: [{
    id: 'service',
    duration: 60,
    workplaces: [{ workplaceId: 'one', bookingPrice: { minimum: 1000, variable: false, free: false } }],
  }],
  days: [{ workplaceId: 'one', date: '2026-11-10', from: '10:00', to: '18:00' }],
  occupancy: [],
  documents: [],
};
const downstreamSlots = getBookingSlots(leanBookingContext, {
  workplaceKey: 'one',
  date: '2026-11-10',
  procedureIds: ['service'],
  step: 30,
  now: new Date('2026-11-09T00:00:00Z'),
});
assert.ok(downstreamSlots.length > 0, 'Downstream Booking must continue from the lean workplace context');
assert.equal(downstreamSlots[0]?.from, '10:00', 'Lean workplace context must preserve Booking time calculation');

assert.match(publicEntry, /renderAccess\(root, route\)/, 'Public entry must open the same canonical Booking flow');
assert.doesNotMatch(publicEntry, /startAccountRuntime|renderGlobalClient|user-entry\.js|core\.js/, 'Public entry must not load the App runtime');

console.log('account Journal and public Booking ownership: ok');
