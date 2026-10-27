import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBookingTimeRows } from '../online-booking/model.js';

const records = fs.readFileSync('core/records/records.js', 'utf8');
const owner = fs.readFileSync('ui/record/creation-flow.js', 'utf8');
const runtime = fs.readFileSync('ui/record/runtime.js', 'utf8');
const recordCss = fs.readFileSync('ui/record/record.css', 'utf8');
const day = fs.readFileSync('journal/день.js', 'utf8');
const journalCreation = fs.readFileSync('journal/creation-flow.js', 'utf8');
const eventCreation = fs.readFileSync('journal/event-create.js', 'utf8');
const recordView = fs.readFileSync('core/records/view.js', 'utf8');
const booking = fs.readFileSync('online-booking/access.js', 'utf8');
const bookingFlowService = fs.readFileSync('server/src/online-booking/booking-flow.service.ts', 'utf8');
const personEntry = fs.readFileSync('core/people/record-creation.js', 'utf8');
const modalPortal = fs.readFileSync('ui/v2/modal-portal.js', 'utf8');
const workspaceNavigation = fs.readFileSync('ui/v2/workspace-navigation.js', 'utf8');
const swipe = fs.readFileSync('ui/v2/swipe.js', 'utf8');

assert.equal(fs.existsSync('journal/record.js'), false);
assert.equal(fs.existsSync('journal/record-view.js'), false);
assert.equal(fs.existsSync('journal/record-creation-x.js'), false);
assert.equal(fs.existsSync('journal/journal-view.js'), false);
assert.equal(fs.existsSync('records/records.js'), false);
assert.equal(fs.existsSync('core/records.js'), false);
assert.match(records, /export function openRecords/);
assert.match(owner, /variant: 'q'/);
assert.match(owner, /surfaceRoot = null/);
assert.match(owner, /bodyRoot = null/);
assert.match(owner, /const inline = Boolean\(surfaceRoot && bodyRoot\)/);
assert.match(owner, /setV2ZHeaderRows\(surfaceRoot/);
assert.match(owner, /savedHeader = document\.createDocumentFragment/);
assert.match(owner, /savedBody = document\.createDocumentFragment/);
assert.match(owner, /setShellHeader/);
assert.match(day, /import\('\.\/creation-flow\.js'\)/);
assert.match(day, /import\('\.\.\/core\/records\/view\.js'\)/);
assert.match(day, /date: dayDate/);
assert.match(day, /surfaceRoot: root\.closest/);
assert.match(day, /bodyRoot: root/);
assert.match(journalCreation, /from '\.\.\/core\/records\/records\.js'/);
assert.match(journalCreation, /label: 'Запись'/);
assert.match(journalCreation, /label: 'Событие'/);
assert.match(journalCreation, /activeMode = 'record'/);
assert.match(journalCreation, /openRecordCreationOwner\(\{ onCancel, surfaceRoot, bodyRoot \}\)/);
assert.match(journalCreation, /recordFlow\?\.resumeRecord\?\.\(\)/);
assert.match(journalCreation, /const operationalReady = loadOperationalState\(\{ full: true \}\);/);
assert.doesNotMatch(journalCreation, /await loadOperationalState\(\{ full: true \}\)/);
assert.match(journalCreation, /stepBack: true/);
assert.match(journalCreation, /setTimeout\(\(\) => onCreated/);
assert.match(eventCreation, /createEvent/);
assert.match(eventCreation, /timeHint/);
assert.match(eventCreation, /openTimeRangeAction/);
assert.match(eventCreation, /checkTimeAvailability/);
assert.doesNotMatch(eventCreation, /timePicker\(/);
assert.doesNotMatch(records, /createEvent/);
assert.doesNotMatch(records, /JOURNAL_MODES/);
assert.doesNotMatch(records, /allowBreak/);
assert.match(records, /creationOwner = null/);
assert.match(records, /state\.timeHint/);
assert.match(records, /state\.from = value/);
assert.match(records, /owner\.resumeRecord/);
assert.match(records, /const stepHistory = \[\]/);
assert.match(records, /stepHistory\.push\(\{ step, renderer, snapshot:/);
assert.match(records, /restoreState\(previous\.snapshot\)/);
assert.match(records, /context === 'person'/);
assert.match(records, /v2ListEntries\(/);
assert.match(records, /v2ListEntry\(/);
assert.match(recordView, /export function openRecordView/);
assert.match(personEntry, /from '\.\.\/records\/records\.js'/);
assert.match(personEntry, /stepBack: true/);
assert.doesNotMatch(booking, /core\/records\/records\.js|openRecords\(/);
assert.match(bookingFlowService, /from '\.\.\/record\/record\.service'/);

// Shared owners keep back/swipe semantics centralized instead of feature-local gesture code.
assert.match(owner, /surfaceRoot\.v2Back = invokeBack/);
assert.match(owner, /layer\.v2Back = invokeBack/);
assert.match(modalPortal, /onBeforeDismiss: \(\) => !requestBack\(\)/);
assert.match(workspaceNavigation, /typeof z\?\.v2Back === 'function'/);
assert.match(swipe, /onBeforeDismiss = null/);

// One shared record mini-card contract is used both during creation and in Record View.
assert.match(runtime, /export function recordConfirmationMiniCard\(\{/);
assert.match(runtime, /contactDiscount = ''/);
assert.match(runtime, /identity = ''/);
assert.match(runtime, /discountMoney = ''/);
assert.doesNotMatch(runtime, /discount \|\| '0%'/);
assert.doesNotMatch(runtime, /groupText = ''/);
assert.match(recordCss, /grid-template-columns:auto minmax\(0,1fr\) auto/);
assert.match(recordCss, /nth-child\(5\)\{grid-column:1\/4;grid-row:3/);
assert.match(recordCss, /nth-child\(9\)\{grid-column:3;grid-row:5/);

// Creation reads the contact discount and uses Finance Settlement for gross/net values.
assert.match(records, /resolveRecordSettlement\(\{/);
assert.match(records, /contact\?\.discountPercent/);
assert.match(records, /settlement\?\.serviceTotal/);
assert.match(records, /settlement\?\.planTotal/);
assert.match(records, /contactDiscount: contactDiscountPercent > 0/);
assert.match(records, /discountMoney: discountMoney > 0\.009/);
assert.match(records, /total: formatMoney\(grossTotal\)/);
assert.doesNotMatch(records, /contactDiscount:.*0%/);

// Existing Record View reads the current contact only for contact discount and keeps gross total in the card.
assert.match(recordView, /getAllPeople\(\)/);
assert.match(recordView, /contact\?\.discountPercent/);
assert.match(recordView, /contactDiscount: contactDiscountPercent > 0/);
assert.match(recordView, /discountMoney: discountMoney > 0\.009/);
assert.match(recordView, /total: formatMoney\(grossTotal\)/);
assert.doesNotMatch(recordView, /recordAmountDue\(source\)/);

const context = {
  workplaces: [{ key: 'w1', name: 'A', timeZone: 'Europe/Moscow', from: '10:00', to: '14:00' }],
  procedures: [{ id: 'p1', name: 'P', duration: 30, workplaces: [{ workplaceId: 'w1' }] }],
  days: [{ workplaceId: 'w1', date: '2026-10-20', from: '10:00', to: '14:00' }],
  occupancy: [{ id: 'r1', workplaceId: 'w1', date: '2026-10-20', from: '11:00', to: '11:30' }],
};
const rows = getBookingTimeRows(context, {
  workplaceKey: 'w1',
  date: '2026-10-20',
  procedureIds: ['p1'],
  step: 15,
  now: new Date('2026-10-19T08:00:00Z'),
});
assert.equal(rows.find((row) => row.from === '11:00')?.available, false);
assert.equal(rows.find((row) => row.from === '11:30')?.available, true);

console.log('Records shared creation flow smoke test passed');
