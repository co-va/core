import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  NOTE_DEFAULT_COLOR,
  noteIsActiveAt,
  noteReels,
} from '../ui/note/index.js';
import { timePicker } from '../ui/time/index.js';
import {
  createNote,
  getNote,
  hydrateNotesFromServer,
  removeNote,
  updateNote,
} from '../core/note/index.js';
import { noteVisibleForWorkplace } from '../journal/note-target.js';

const read = (path) => fs.readFileSync(path, 'utf8');

assert.equal(NOTE_DEFAULT_COLOR, '#CFC3FF');
assert.equal(noteIsActiveAt({ from: '', to: '' }, '10:00'), false);
assert.equal(noteIsActiveAt({ from: '10:00', to: '' }, '10:00'), true);
assert.equal(noteIsActiveAt({ from: '10:00', to: '' }, '10:01'), false);
assert.equal(noteIsActiveAt({ from: '', to: '11:00' }, '11:00'), true);
assert.equal(noteIsActiveAt({ from: '', to: '11:00' }, '10:59'), false);
assert.equal(noteIsActiveAt({ from: '10:00', to: '11:00' }, '10:30'), true);
assert.equal(noteIsActiveAt({ from: '10:00', to: '11:00' }, '11:01'), false);

const optionalTime = timePicker({ label: 'С', name: 'from', value: '', allowEmpty: true });
assert.match(optionalTime, /name="from" value=""/);
assert.match(optionalTime, />—<\/button>/);

const reels = noteReels([
  { id: 'n1', date: '2026-10-22', title: 'A', text: '', from: '', to: '', color: '#CFC3FF' },
  { id: 'n2', date: '2026-10-22', title: '', text: 'B', from: '10:00', to: '', color: '#CFC3FF' },
], { activeTime: '10:00', relatedIds: ['n2'] });
assert.match(reels, /data-ui-y="note-reels"/);
assert.match(reels, /data-journal-y/);
assert.match(reels, /data-note-reel="n1"/);
assert.match(reels, /data-note-reel="n2"/);
assert.match(reels, /is-time-active/);
assert.match(reels, /is-related/);
assert.doesNotMatch(reels, /v2-sticker/);

hydrateNotesFromServer([]);
const owner = { ownerType: 'profile', ownerId: 'profile-1', date: '2026-10-22', color: '#CFC3FF' };
const dayOnly = createNote({ ...owner, title: 'Day' });
const fromOnly = createNote({ ...owner, id: 'from-only', text: 'From', from: '10:00' });
const toOnly = createNote({ ...owner, id: 'to-only', text: 'To', to: '11:00' });
const range = createNote({ ...owner, id: 'range', text: 'Range', from: '12:00', to: '13:00' });
assert.equal(dayOnly.from, '');
assert.equal(dayOnly.to, '');
assert.equal(fromOnly.from, '10:00');
assert.equal(fromOnly.to, '');
assert.equal(toOnly.from, '');
assert.equal(toOnly.to, '11:00');
assert.equal(range.from, '12:00');
assert.equal(range.to, '13:00');

const originalId = range.id;
const edited = updateNote(range.id, { text: 'Changed' });
assert.equal(edited.id, originalId);
assert.equal(getNote(originalId).text, 'Changed');

const unattached = { targetType: '', targetId: '' };
assert.equal(noteVisibleForWorkplace(unattached, 'w1', {
  resolveTarget: () => null,
}), true);
assert.equal(noteVisibleForWorkplace(unattached, 'w2', {
  resolveTarget: () => null,
}), true);

const attachedRecord = { targetType: 'record', targetId: 'r1' };
assert.equal(noteVisibleForWorkplace(attachedRecord, 'w1', {
  resolveTarget: () => ({ type: 'record', entity: { workplaceId: 'w1' } }),
}), true);
assert.equal(noteVisibleForWorkplace(attachedRecord, 'w2', {
  resolveTarget: () => ({ type: 'record', entity: { workplaceId: 'w1' } }),
}), false);

const attachedEvent = { targetType: 'event', targetId: 'e1' };
assert.equal(noteVisibleForWorkplace(attachedEvent, 'w1', {
  resolveTarget: () => ({ type: 'event', entity: { workplaceId: 'w1' } }),
}), true);
assert.equal(noteVisibleForWorkplace(attachedEvent, 'w2', {
  resolveTarget: () => ({ type: 'event', entity: { workplaceId: 'w1' } }),
}), false);
assert.equal(noteVisibleForWorkplace(attachedEvent, 'w2', {
  resolveTarget: () => null,
}), true, 'missing target must behave as unattached');
assert.equal(noteVisibleForWorkplace(attachedEvent, 'w2', {
  allMode: true,
  resolveTarget: () => ({ type: 'event', entity: { workplaceId: 'w1' } }),
}), true);

assert.equal(removeNote(dayOnly.id), true);
assert.equal(getNote(dayOnly.id), null);

const alphabet = read('UI_ALPHABET.md');
const schema = read('server/prisma/schema.prisma');
const migration = read('server/prisma/migrations/20261022210000_note_y_reels/migration.sql');
const noteService = read('core/note/service.js');
const persistence = read('core/business-persistence.js');
const runtime = read('core/runtime/business-state.js');
const day = read('journal/день.js');
const creation = read('journal/creation-flow.js');
const noteCreate = read('journal/note-create.js');
const noteView = read('journal/note-view.js');
const timeSource = read('journal/time-usage-source.js');
const month = read('journal/месяц.js');
const list = read('journal/список.js');
const recordView = read('core/records/view.js');
const eventView = read('journal/event-view.js');

assert.match(alphabet, /\| Y \|[^|]*Note Reels/);
assert.match(alphabet, /Y не является Z/);
assert.match(alphabet, /Y не является Timeline/);

assert.match(schema, /model Note \{/);
for (const field of [
  'id', 'ownerType', 'ownerId', 'tenantId', 'context', 'date', 'from', 'to',
  'targetType', 'targetId', 'title', 'text', 'color', 'createdAt', 'updatedAt',
]) assert.match(schema, new RegExp(`\\b${field}\\b`));
assert.match(schema, /color\s+String\s+@default\("#CFC3FF"\)/);
assert.doesNotMatch(schema, /model Note \{[\s\S]*?\bworkplaceId\b[\s\S]*?\n\}/);

assert.match(migration, /CREATE TABLE "Note"/);
assert.match(migration, /DEFAULT '#CFC3FF'/);
assert.doesNotMatch(migration, /FOREIGN KEY \("targetId"\)/);

assert.doesNotMatch(noteService, /checkTimeAvailability|time-usage/);
assert.match(persistence, /queueNoteUpsert/);
assert.match(persistence, /queueNoteDelete/);
assert.match(runtime, /apiRequest\('\/notes'\)/);
assert.match(runtime, /hydrateNotesFromServer/);

assert.match(creation, /label: 'Заметка'/);
assert.match(creation, /createJournalNoteFlow/);
assert.match(noteCreate, /datePicker/);
assert.match(noteCreate, /timePicker\(\{ label: 'С'/);
assert.match(noteCreate, /timePicker\(\{ label: 'До'/);
assert.match(noteCreate, /label: 'Прикрепить к'/);
assert.match(noteCreate, /label: 'Наименование'/);
assert.match(noteCreate, /label: 'Текст'/);
assert.match(noteCreate, /colorPicker/);
assert.match(noteCreate, /ownerType: 'profile'/);

assert.match(day, /data-journal-y-host/);
assert.match(day, /noteReels/);
assert.ok(day.indexOf('renderY();') < day.indexOf('if (allMode)'), 'Y must render before work-schedule early returns');
assert.match(day, /journalDayTimeline/);
assert.doesNotMatch(timeSource, /\bnote\b|type: 'note'/i);
assert.doesNotMatch(month, /core\/note|noteReels|data-journal-y/);
assert.doesNotMatch(list, /core\/note|noteReels|data-journal-y/);

assert.match(recordView, /Заметки/);
assert.match(recordView, /hasNotesForTarget\('record'/);
assert.match(eventView, /Заметки/);
assert.match(eventView, /hasNotesForTarget\('event'/);

assert.match(noteView, /variant: 'q'/);
assert.match(noteView, /button\('Изменить'/);
assert.match(noteView, /button\('Сохранить'/);
assert.match(noteView, /button\('Удалить'/);
const readPart = noteView.slice(noteView.indexOf('const renderRead'), noteView.indexOf('const renderEdit'));
assert.doesNotMatch(readPart, /Удалить/);

console.log('Note / Y regression test passed.');
