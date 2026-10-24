import assert from 'node:assert/strict';
import { createDay, getDays, getScheduleConflicts, hasScheduleConflict, hydrateDaysFromServer, removeDay, saveDays } from '../core/day/index.js';
import { checkTimeAvailability, configureTimeUsageSource, configureSoftTimeUsageReleaseSource, getWorkingTimeUsageConflicts } from '../core/time/index.js';
import { createRecord, moveRecord, cancelRecord, deleteRecord, getRecords, hydrateRecordStateFromServer } from '../core/record/index.js';
import { createEvent, getEventsForDay, hydrateEventsFromServer, updateEvent } from '../core/event/index.js';
import { getJournalTimeUsages, releaseJournalSoftTimeUsages } from '../journal/time-usage-source.js';

globalThis.window = { dispatchEvent() {} };

configureTimeUsageSource(getJournalTimeUsages);
configureSoftTimeUsageReleaseSource(releaseJournalSoftTimeUsages);

const days = [createDay({ date: '2026-09-15', workplaceId: 'romashka', from: '12:00', to: '16:00' })];
hydrateDaysFromServer(days);
hydrateRecordStateFromServer({ records: [], recordEvents: [] });
hydrateEventsFromServer([]);

assert.equal(hasScheduleConflict(days, { workplaceId: 'charodeyka', date: '2026-09-15', from: '16:00', to: '20:00' }), false);
assert.equal(hasScheduleConflict(days, { workplaceId: 'charodeyka', date: '2026-09-15', from: '15:00', to: '18:00' }), true);
const conflicts = getScheduleConflicts(days, { workplaceId: 'charodeyka', date: '2026-09-15', from: '15:00', to: '18:00' });
assert.equal(conflicts.length, 1);
assert.equal(conflicts[0].workplaceId, 'romashka');
assert.equal(conflicts[0].from, '12:00');
assert.equal(conflicts[0].to, '16:00');

const record = createRecord({ date: '2026-09-15', workplaceId: 'romashka', from: '12:00', to: '13:00', person: { name: 'Тест' } });
assert.ok(record);
assert.equal(createRecord({ date: '2026-09-15', workplaceId: 'romashka', from: '12:30', to: '13:30' }), null);
assert.equal(createRecord({ date: '2026-09-15', workplaceId: 'romashka', from: '15:55', to: '16:05' }), null);
assert.equal(checkTimeAvailability({ workplaceId: 'romashka', date: '2026-09-15', from: '12:30', to: '13:30' }).reason, 'occupied');

const moved = moveRecord(record.id, { date: '2026-09-15', workplaceId: 'romashka', from: '13:00', to: '14:00' });
assert.equal(moved.from, '13:00');
assert.equal(moved.to, '14:00');

const eventItem = createEvent({ ownerType: 'tenant', context: { scope: 'professional' }, title: 'Событие', workplaceId: 'romashka', date: '2026-09-15', from: '14:30', to: '15:00' });
assert.ok(eventItem);
const movedEvent = updateEvent(eventItem.id, { from: '14:45', to: '15:15' });
assert.equal(movedEvent?.from, '14:45');
assert.equal(movedEvent?.to, '15:15');
const restoredEvent = updateEvent(eventItem.id, { from: '14:30', to: '15:00' });
assert.equal(restoredEvent?.from, '14:30');
assert.equal(restoredEvent?.to, '15:00');

const shrinkConflicts = getWorkingTimeUsageConflicts({ date: '2026-09-15', workplaceId: 'romashka', from: '12:00', to: '14:00' });
assert.equal(shrinkConflicts.some((item) => item.type === 'event' && item.rigidity === 'soft' && item.from === '14:30' && item.to === '15:00'), true);
assert.equal(shrinkConflicts.some((item) => item.type === 'record'), false);

const removalConflictsWithRecord = getWorkingTimeUsageConflicts({ operation: 'remove', date: '2026-09-15', workplaceId: 'romashka' });
assert.equal(removalConflictsWithRecord.length, 1);
assert.equal(removalConflictsWithRecord[0].type, 'record');
assert.equal(removalConflictsWithRecord[0].rigidity, 'hard');

const guardedDays = getDays();
assert.equal(removeDay(guardedDays, 'romashka', '2026-09-15'), false);
assert.equal(guardedDays.length, 1);

const bypassedDays = getDays();
bypassedDays.splice(0, 1);
const blockedSave = saveDays(bypassedDays);
assert.equal(blockedSave.ok, false);
assert.equal(blockedSave.reason, 'usage-conflict');
assert.equal(bypassedDays.length, 1);
assert.equal(getDays().length, 1);

assert.ok(cancelRecord(record.id));
assert.equal(createRecord({ date: '2026-09-15', workplaceId: 'romashka', from: '13:00', to: '14:00' })?.id !== undefined, true);
const active = getRecords().filter((item) => item.status !== 'cancelled');
assert.equal(active.length, 1);
assert.equal(deleteRecord(active[0].id), true);
assert.equal(getRecords().filter((item) => item.status !== 'cancelled').length, 0);

const removalConflictsWithEventOnly = getWorkingTimeUsageConflicts({ operation: 'remove', date: '2026-09-15', workplaceId: 'romashka' });
assert.equal(removalConflictsWithEventOnly.length, 0);
assert.equal(getEventsForDay('2026-09-15', 'romashka').length, 1);

const removableDays = getDays();
assert.equal(removeDay(removableDays, 'romashka', '2026-09-15'), true);
assert.equal(saveDays(removableDays).ok, true);
assert.equal(getDays().length, 0);
assert.equal(getEventsForDay('2026-09-15', 'romashka').length, 1);

console.log('day-record tests: OK');
