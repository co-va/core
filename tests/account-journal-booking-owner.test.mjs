import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBookingSlots } from '../online-booking/model.js';

const day = fs.readFileSync('journal/день.js', 'utf8');
const entry = fs.readFileSync('online-booking/user-entry.js', 'utf8');
const access = fs.readFileSync('online-booking/access.js', 'utf8');
const publicEntry = fs.readFileSync('online-booking/booking-entry.js', 'utf8');
const records = fs.readFileSync('core/records/records.js', 'utf8');
const creationFlow = fs.readFileSync('ui/record/creation-flow.js', 'utf8');
const recordService = fs.readFileSync('server/src/record/record.service.ts', 'utf8');
const targetsClient = fs.readFileSync('core/account/booking-targets.js', 'utf8');
const targetsController = fs.readFileSync('server/src/online-booking/account-booking-targets.controller.ts', 'utf8');
const bookingController = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
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
assert.match(targetsClient, /cachedTargets/, 'Professional targets must be cached while the account session is unchanged');
assert.match(entry, /getGlobalAccountBookingTargets/, 'App Journal professional selector must use the narrow Account booking-targets projection');
assert.match(entry, /openRecordCreationOwner\(\)/, 'App Journal must start inside the existing Shared Record Q owner');
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
assert.match(journalBooking, /getBookingContext\(id\)/, 'Journal Booking must use the lean canonical Booking context');
assert.match(journalBooking, /accountResultPromise = getAccount\(id\)/, 'Journal Booking must start Account loading in parallel without blocking the workplace context');
assert.doesNotMatch(journalBooking, /Promise\.all\(\[\s*getBookingContext\(id\),\s*getAccount\(id\)/, 'Workplace selection must not wait for the tenant Account request');
assert.match(journalBooking, /openRecords\(\{/, 'Journal Booking must continue through the existing canonical Records flow');
assert.match(journalBooking, /context: 'online'/, 'Journal Booking must use the online Records provider semantics');
assert.match(journalBooking, /person: resolvedAccount/, 'Journal Booking must carry the known App account into confirmation instead of asking for name or phone');
assert.match(journalBooking, /professionalActions: false/, 'Journal Booking must not expose professional Record actions');
assert.match(journalBooking, /creationOwner,/, 'Journal Booking must reuse the already-open Shared Q owner');
assert.match(journalBooking, /if \(workplaces\.length === 1\)/, 'One workplace must skip the workplace selector in App Journal Booking');
assert.match(journalBooking, /creationOwner\.render\(\{[\s\S]*step: 'workplace'/, 'Multiple workplaces must stay inside the same Shared Q owner');
assert.match(journalBooking, /createBookingRequest\(id,/, 'Journal confirmation must use the authenticated Account Booking write');
assert.doesNotMatch(journalBooking, /renderAccess\(/, 'Journal Booking must never enter the Public technical Booking shell');
assert.doesNotMatch(journalBooking, /creationOwner\?\.close|variant:\s*'technical'|mountModal\(/, 'Journal Booking must not close Q or mount a technical modal');
assert.match(journalBooking, /let participantProcedureController = null/, 'Journal participant procedures must have one controller owner for the whole Q flow');
assert.match(journalBooking, /destroyParticipantProcedureController\(\);[\s\S]*participantProcedureController = initMultiSelect/, 'Journal participant procedure step must destroy the previous multiselect controller before binding the next participant');
assert.match(journalBooking, /const clearParticipantProcedures = \(\) => \{[\s\S]*participant\.procedures = \[\]/, 'Leaving the participant service stage must be able to invalidate all participant services');
const participantProceduresStart = journalBooking.indexOf('const renderParticipantProcedures');
const participantDataStart = journalBooking.indexOf('const renderParticipantData', participantProceduresStart);
assert.ok(participantProceduresStart >= 0 && participantDataStart > participantProceduresStart, 'Journal participant service renderer must exist');
const participantProcedures = journalBooking.slice(participantProceduresStart, participantDataStart);
const participantChangeStart = participantProcedures.indexOf('onChange: (values) =>');
const participantNextStart = participantProcedures.indexOf("view?.layer?.querySelector('[data-account-booking-procedures-next]')", participantChangeStart);
assert.ok(participantChangeStart >= 0 && participantNextStart > participantChangeStart, 'Journal participant service draft and commit handlers must exist');
const participantChange = participantProcedures.slice(participantChangeStart, participantNextStart);
const participantNext = participantProcedures.slice(participantNextStart);
assert.doesNotMatch(participantChange, /participant\.procedures\s*=/, 'Changing a service checkbox must stay a screen draft until Далее');
assert.match(participantNext, /participant\.procedures = \[\.\.\.selected\.values\(\)\]/, 'Далее must commit only the current participant service draft');
assert.match(participantProcedures, /if \(index > 0\) return renderParticipantProcedures\(index - 1\);[\s\S]*clearParticipantProcedures\(\);[\s\S]*return renderParticipantData\(\);/, 'Back inside services must revisit the previous participant, while leaving services entirely invalidates service state');
assert.match(journalBooking, /clearParticipantProcedures\(\);\s*void renderParticipantProcedures\(0\)/, 'Re-entering participant services from participant data must start with clean services and calculations');
assert.doesNotMatch(entry, /from '\.\/access\.js'/, 'App user entry must not import the Public technical Booking entry');
assert.doesNotMatch(entry, /phoneField|passwordField|account\/login|account\/register/, 'Journal Booking must not render identity, password, login or registration steps');
assert.match(entry, /v2ListEntry\(/, 'App workplace selection must use the Shared list owner');
assert.match(records, /const owner = creationOwner \|\| openRecordCreationOwner/, 'Canonical Records must keep support for an externally owned Shared Q');
assert.match(records, /stepBack = false/, 'Canonical Records must expose opt-in step-back navigation without changing other Record flows');
assert.match(records, /onBackFromStart/, 'Account Journal Booking must be able to return from procedures to its outer professional/workplace steps');
assert.match(creationFlow, /setBackHandler\(handler = null\)/, 'Shared Q must distinguish its back control from hard close');
assert.match(creationFlow, /data-modal-close.*handleBackControl/s, 'Shared Q header control must use the registered step-back handler');
assert.match(recordService, /bookedByMatch/, 'End-user Journal must include the same Record when the account booked it for another person');
assert.match(recordService, /record\.group.*participants/s, 'End-user Journal visibility must include non-primary group participants');

const requestRouteStart = bookingController.indexOf("@UseGuards(AccountGuard, BookingPdnConsentGuard)");
const requestRouteEnd = bookingController.indexOf('\n  }\n}', requestRouteStart);
assert.ok(requestRouteStart >= 0 && requestRouteEnd > requestRouteStart, 'Authenticated App Booking write route must exist');
const requestRoute = bookingController.slice(requestRouteStart, requestRouteEnd);
assert.match(requestRoute, /@Post\(':tenantId\/requests'\)/, 'App Journal Booking write must stay on the authenticated Account route');
assert.match(requestRoute, /this\.booking\.createRequest\(tenantId, accountId/, 'App Journal Booking route must reuse the existing Account Booking service owner');
assert.match(requestRoute, /BookingPdnConsentGuard/, 'App Journal Booking write must preserve the existing PDN gate without asking for identity again');

const contextStart = bookingService.indexOf('async getContext');
const prepareAccountStart = bookingService.indexOf('async prepareAccount', contextStart);
assert.ok(contextStart >= 0 && prepareAccountStart > contextStart, 'Canonical Booking context owner must exist');
const bookingContext = bookingService.slice(contextStart, prepareAccountStart);
assert.doesNotMatch(bookingContext, /this\.bookingSource\(|publicBookingBundle|data\.profile|profile:\s*objectValue/, 'Booking context must not load or return Profile/Card payload');
assert.match(bookingContext, /this\.prisma\.workplace\.findMany/, 'Booking context must load workplaces directly instead of going through Profile/Card');
for (const field of ['key', 'name', 'city', 'address', 'timeZone', 'from', 'to', 'visibleInPublicBooking']) {
  assert.match(bookingContext, new RegExp(`${field}: true`), `Booking workplace source projection must include ${field}`);
}
assert.doesNotMatch(bookingContext, /photo|photoCropX|photoCropY|cardAppearance|cardProfile|\babout\b/, 'Booking context must not expose workplace Card payload');
for (const preserved of ['procedures', 'days', 'documents', 'occupancy']) {
  assert.match(bookingContext, new RegExp(`\\b${preserved}\\b`), `Booking context must preserve ${preserved}`);
}

assert.match(access, /variant: 'technical'/, 'Public Booking must keep its isolated Shared technical modal');
assert.match(access, /className: 'booking-technical-modal'/, 'Public Booking must stay inside the technical modal surface');
assert.doesNotMatch(access, /openRecordCreationOwner\(|creationOwner:\s*state\./, 'Public Booking must not depend on the App Record Q shell');
assert.match(access, /if \(workplaces\.length === 1\)/, 'Single workplace must be skipped by Public Booking logic');
assert.doesNotMatch(access, /renderLegal|renderAccountEntry|passwordField|account\/login|account\/register/, 'Public Booking must not contain App authentication or onboarding gates');

const workplaceRenderStart = access.indexOf('function renderWorkplace');
const modeRenderStart = access.indexOf('function renderMode', workplaceRenderStart);
assert.ok(workplaceRenderStart >= 0 && modeRenderStart > workplaceRenderStart, 'Public workplace renderer must exist');
const workplaceRender = access.slice(workplaceRenderStart, modeRenderStart);
assert.match(workplaceRender, /v2ListEntry\(/, 'Public workplace selection must keep Shared v2ListEntry');
for (const field of ['name', 'city', 'address', 'key']) {
  assert.match(workplaceRender, new RegExp(`workplace\\?\\.${field}`), `Public workplace selection must keep using ${field}`);
}
assert.doesNotMatch(workplaceRender, /profile|photo|cardAppearance|cardProfile/, 'Public workplace selection must not depend on Profile/Card data');

const initialStepStart = access.indexOf('function initialStep');
const renderAccessStart = access.indexOf('export async function renderAccess', initialStepStart);
assert.ok(initialStepStart >= 0 && renderAccessStart > initialStepStart, 'Public Booking initial step must exist');
const initialStepSource = access.slice(initialStepStart, renderAccessStart);
const initialStep = Function('text', `${initialStepSource}\nreturn initialStep;`)((value) => String(value ?? '').trim());

const singleWorkplaceState = {
  context: { workplaces: [{ key: 'only' }] },
  lockedWorkplaceKey: '',
  workplaceKey: '',
};
assert.deepEqual(initialStep(singleWorkplaceState), { kind: 'mode', index: 0 }, 'One workplace must skip the Public selector');
assert.equal(singleWorkplaceState.workplaceKey, 'only', 'One Public workplace must be selected automatically');

const multipleWorkplaceState = {
  context: { workplaces: [{ key: 'one' }, { key: 'two' }] },
  lockedWorkplaceKey: '',
  workplaceKey: '',
};
assert.deepEqual(initialStep(multipleWorkplaceState), { kind: 'workplace', index: 0 }, 'Multiple Public workplaces must open the selector');
assert.equal(multipleWorkplaceState.workplaceKey, '', 'Multiple Public workplaces must not preselect a workplace');

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

assert.match(publicEntry, /renderAccess\(root, route\)/, 'Public entry must open the isolated technical Booking flow');
assert.doesNotMatch(publicEntry, /startAccountRuntime|renderGlobalClient|user-entry\.js|core\.js/, 'Public entry must not load the App runtime');

console.log('account Journal Q and public technical Booking ownership: ok');