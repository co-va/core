import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hydrateDaysFromServer } from '../core/day/index.js';
import { configureTimeUsageSource } from '../core/time/index.js';
import {
  getRecordEvents,
  RECORD_EVENT_TYPES,
  getRecord,
  hydrateRecordStateFromServer,
  cancelRecord,
  createRecord,
  moveRecord,
  setRecordAttendance,
  setRecordConfirmed,
} from '../core/record/index.js';
import { getJournalTimeUsages } from '../journal/time-usage-source.js';

const personHistorySource = readFileSync(new URL('../core/people/history.js', import.meta.url), 'utf8');
const recordViewSource = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');

globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } };

hydrateDaysFromServer([
  { date: '2026-09-20', workplaceId: 'studio', from: '09:00', to: '18:00' },
  { date: '2026-09-21', workplaceId: 'studio', from: '09:00', to: '18:00' },
]);
hydrateRecordStateFromServer({ records: [], recordEvents: [] });
configureTimeUsageSource(getJournalTimeUsages);

const journalAction = {
  source: 'journal',
  actor: { type: 'profile', profileId: 'profile-1', accountId: 'account-1' },
};

const record = createRecord({
  date: '2026-09-20',
  workplaceId: 'studio',
  from: '10:00',
  to: '11:00',
  person: { id: 'person-1', key: 'person-key-1', name: 'Тест', surname: 'Человек' },
  source: 'journal',
  actionContext: journalAction,
});
assert.ok(record);
const createdEvent = getRecordEvents(record.id)[0];
assert.equal(createdEvent?.type, RECORD_EVENT_TYPES.CREATED);
assert.equal(createdEvent?.category, 'action');
assert.equal(createdEvent?.source, 'journal');
assert.equal(createdEvent?.actor?.profileId, 'profile-1');
assert.equal(createdEvent?.actor?.accountId, 'account-1');
assert.equal(createdEvent?.subject?.personId, 'person-1');
assert.equal(createdEvent?.subject?.name, 'Тест');
assert.deepEqual(createdEvent?.payload?.appointment, { date: '2026-09-20', workplaceId: 'studio', from: '10:00', to: '11:00' });
assert.equal(getRecord(record.id)?.status, 'active');
assert.equal(getRecord(record.id)?.confirmed, false);
assert.equal(getRecord(record.id)?.attendance, '');

const confirmed = setRecordConfirmed(record.id, true, { actionContext: journalAction });
assert.equal(confirmed.confirmed, true);
assert.equal(getRecordEvents(record.id).at(-1)?.type, RECORD_EVENT_TYPES.CONFIRMED);

const unconfirmed = setRecordConfirmed(record.id, false, { actionContext: journalAction });
assert.equal(unconfirmed.confirmed, false);
assert.equal(getRecordEvents(record.id).at(-1)?.type, RECORD_EVENT_TYPES.UNCONFIRMED);

const noShow = setRecordAttendance(record.id, 'no-show', { actionContext: journalAction });
assert.equal(noShow.attendance, 'no-show');
assert.equal(getRecordEvents(record.id).at(-1)?.type, RECORD_EVENT_TYPES.NO_SHOW);

const moved = moveRecord(record.id, {
  date: '2026-09-21',
  workplaceId: 'studio',
  from: '12:00',
  to: '13:00',
}, { actionContext: journalAction });
assert.ok(moved);
assert.equal(moved.attendance, 'no-show');
const rescheduled = getRecordEvents(record.id).find((event) => event.type === RECORD_EVENT_TYPES.RESCHEDULED);
assert.ok(rescheduled);
assert.equal(rescheduled.category, 'action');
assert.equal(rescheduled.actor.profileId, 'profile-1');
assert.deepEqual(rescheduled.payload.before, { date: '2026-09-20', workplaceId: 'studio', from: '10:00', to: '11:00' });
assert.deepEqual(rescheduled.payload.after, { date: '2026-09-21', workplaceId: 'studio', from: '12:00', to: '13:00' });

const cleared = setRecordAttendance(record.id, '', { actionContext: journalAction });
assert.equal(cleared.attendance, '');
assert.equal(getRecordEvents(record.id).at(-1)?.type, RECORD_EVENT_TYPES.ATTENDANCE_CLEARED);

const arrived = setRecordAttendance(record.id, 'arrived', { actionContext: journalAction });
assert.equal(arrived.attendance, 'arrived');
assert.equal(getRecordEvents(record.id).at(-1)?.type, RECORD_EVENT_TYPES.ARRIVED);

const cancelled = cancelRecord(record.id, { actionContext: journalAction });
assert.equal(cancelled.status, 'cancelled');
const cancelledEvent = getRecordEvents(record.id).at(-1);
assert.equal(cancelledEvent?.type, RECORD_EVENT_TYPES.CANCELLED);
assert.equal(cancelledEvent?.actor?.profileId, 'profile-1');
assert.equal(cancelledEvent?.source, 'journal');
assert.equal(getJournalTimeUsages({ date: '2026-09-21', workplaceId: 'studio' }).some((usage) => usage.sourceId === record.id), false);

// Person History is a projection: one Record card owns its linked payment/refund presentation.
assert.match(personHistorySource, /const finance = recordFinance\(facts, recordId\);/);
assert.match(personHistorySource, /const payments = operations\.filter\(\(operation\) => operation\.kind === 'payment'/);
assert.match(personHistorySource, /const refunds = operations\.filter\(\(operation\) => operation\.kind === 'refund'/);
assert.match(personHistorySource, /const records = recordIds\.map\(\(recordId\) => recordItem\(rows, recordId\)\)\.filter\(Boolean\);/);
assert.match(personHistorySource, /fact\.entityType === 'finance-operation' && !text\(fact\.recordId\)/);
assert.match(personHistorySource, /return \[\.\.\.records, \.\.\.standaloneFinance\]/);

// Record View opens the same canonical Person History in both unpaid and paid action flows.
assert.match(recordViewSource, /import \{ openPersonHistoryQ \} from '\.\.\/people\/people\.js';/);
assert.match(recordViewSource, /return openPersonHistoryQ\(document\.body, person\);/);
assert.match(recordViewSource, /button\('История', \{ variant: 'secondary', data: 'data-record-view-history' \}\)/);
assert.match(recordViewSource, /querySelector\('\.record-payment-actions'\);\s*host\?\.insertAdjacentHTML\('beforeend', button\('История'/s);

console.log('record lifecycle tests: OK');
