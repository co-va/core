import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  NOTE_DEFAULT_COLOR,
  noteIsActiveAt,
  noteReels,
  orderNoteReels,
} from '../ui/note/index.js';
import { timePicker } from '../ui/time/index.js';
import {
  createNote,
  getNote,
  hydrateNotesFromServer,
  removeNote,
  updateNote,
} from '../core/note/index.js';
import {
  cancelRecord,
  deleteRecord,
  hydrateRecordStateFromServer,
} from '../core/record/index.js';
import {
  noteContextWithTarget,
  noteTargetLabel,
  noteVisibleForWorkplace,
  resolveNoteTarget,
} from '../journal/note-target.js';

const read = (filePath) => fs.readFileSync(filePath, 'utf8');

assert.equal(NOTE_DEFAULT_COLOR, '#CFC3FF');
assert.equal(noteIsActiveAt({ from: '', to: '' }, '10:00'), false);
assert.equal(noteIsActiveAt({ from: '10:00', to: '' }, '10:00'), true);
assert.equal(noteIsActiveAt({ from: '10:00', to: '' }, '10:01'), false);
assert.equal(noteIsActiveAt({ from: '', to: '11:00' }, '11:00'), true);
assert.equal(noteIsActiveAt({ from: '', to: '11:00' }, '10:59'), false);
assert.equal(noteIsActiveAt({ from: '10:00', to: '11:00' }, '10:30'), true);
assert.equal(noteIsActiveAt({ from: '10:00', to: '11:00' }, '11:01'), false);

const timedOrder = [
  { id: 'early', from: '10:00', to: '10:00' },
  { id: 'next', from: '10:01', to: '10:01' },
  { id: 'day', from: '', to: '' },
];
assert.equal(orderNoteReels(timedOrder, '10:00')[0].id, 'early');
assert.equal(orderNoteReels(timedOrder, '10:01')[0].id, 'next');
const overlappingOrder = [
  { id: 'long', from: '10:00', to: '11:00' },
  { id: 'newer', from: '10:30', to: '10:45' },
];
assert.equal(orderNoteReels(overlappingOrder, '10:30')[0].id, 'newer', 'newly active Note must lead Y');

const optionalTime = timePicker({ label: 'С', name: 'from', value: '', allowEmpty: true });
assert.match(optionalTime, /name="from" value=""/);
assert.match(optionalTime, />—<\/button>/);

const reels = noteReels([
  { id: 'n1', date: '2026-10-22', title: 'A', text: '', from: '', to: '', color: '#CFC3FF' },
  { id: 'n2', date: '2026-10-22', title: '', text: 'B', from: '10:00', to: '', color: '#CFC3FF' },
], { activeTime: '10:00', relatedIds: ['n2'] });
assert.doesNotMatch(reels, /data-ui-y|data-journal-y/);
assert.match(reels, /data-note-reel="n1"/);
assert.match(reels, /data-note-reel="n2"/);
assert.ok(reels.indexOf('data-note-reel="n2"') < reels.indexOf('data-note-reel="n1"'), 'active Note must move to first Y position');
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
}), true, 'missing target without historical snapshot behaves as unattached');
assert.equal(noteVisibleForWorkplace(attachedEvent, 'w2', {
  allMode: true,
  resolveTarget: () => ({ type: 'event', entity: { workplaceId: 'w1' } }),
}), true);

hydrateRecordStateFromServer({
  records: [{
    id: 'history-record',
    date: '2026-10-22',
    workplaceId: 'w-history',
    from: '14:00',
    to: '15:00',
    person: { id: 'p-history', uei: 'UEI-HISTORY', name: 'Анна', surname: 'История' },
    procedures: [],
    products: [],
  }],
  recordEvents: [],
});
hydrateNotesFromServer([]);
const historyNote = createNote({
  id: 'history-note',
  ownerType: 'profile',
  ownerId: 'profile-1',
  context: noteContextWithTarget({ scope: 'professional' }, 'record', 'history-record'),
  date: '2026-10-22',
  targetType: 'record',
  targetId: 'history-record',
  title: 'Историческая связь',
});
assert.match(noteTargetLabel(historyNote), /^Запись · 14:00 · Анна История$/);
assert.equal(cancelRecord('history-record')?.status, 'cancelled');
assert.equal(getNote(historyNote.id)?.targetType, 'record');
assert.equal(getNote(historyNote.id)?.targetId, 'history-record');
assert.match(noteTargetLabel(getNote(historyNote.id)), /^Запись отменена · 14:00 · Анна История$/);
assert.equal(deleteRecord('history-record'), true);
const afterRecordDelete = getNote(historyNote.id);
assert.equal(afterRecordDelete.targetType, 'record');
assert.equal(afterRecordDelete.targetId, 'history-record');
assert.equal(resolveNoteTarget(afterRecordDelete)?.deleted, true);
assert.match(noteTargetLabel(afterRecordDelete), /^Запись удалена · 14:00 · Анна История$/);
assert.equal(noteVisibleForWorkplace(afterRecordDelete, 'w-history'), true);
assert.equal(noteVisibleForWorkplace(afterRecordDelete, 'w-other'), false, 'deleted Record Note must keep its historical workplace context');

assert.equal(removeNote(historyNote.id), true);
assert.equal(removeNote(dayOnly.id), false, 'hydration reset must not restore old Note rows');

const alphabet = read('UI_ALPHABET.md');
const schema = read('server/prisma/schema.prisma');
const migration = read('server/prisma/migrations/20261022210000_note_y_reels/migration.sql');
const noteService = read('core/note/service.js');
const serverNoteService = read('server/src/note/note.service.ts');
const persistence = read('core/business-persistence.js');
const runtime = read('core/runtime/business-state.js');
const businessController = read('server/src/business-state/business-state.controller.ts');
const day = read('journal/день.js');
const creation = read('journal/creation-flow.js');
const noteCreate = read('journal/note-create.js');
const noteView = read('journal/note-view.js');
const noteTarget = read('journal/note-target.js');
const timeSource = read('journal/time-usage-source.js');
const month = read('journal/месяц.js');
const list = read('journal/список.js');
const recordView = read('core/records/view.js');
const eventView = read('journal/event-view.js');
const accountNoteOwner = read('core/note/account-owner.js');
const accountNoteController = read('server/src/online-booking/account-note.controller.ts');
const onlineBookingModule = read('server/src/online-booking/online-booking.module.ts');

assert.match(alphabet, /Y = универсальная Shared H-zone/);
assert.match(alphabet, /Note ≠ Y/);
assert.match(alphabet, /Y не находится внутри Z/);

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
assert.match(runtime, /apiRequest\('\/business-state\/journal'\)/);
assert.doesNotMatch(runtime, /apiRequest\('\/notes'\)/);
assert.match(runtime, /hydrateNotesFromServer/);
assert.match(businessController, /this\.notes\.listProfile\(auth\.tenantId, auth\.platformAccountId\)/);

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
assert.match(noteCreate, /noteContextWithTarget/);
assert.match(noteCreate, /noteActions/);
assert.match(noteCreate, /targetSource/);

assert.doesNotMatch(day, /data-journal-y-host|data-journal-y/);
assert.match(day, /setV2Y/);
assert.match(day, /noteReels/);
assert.match(day, /scheduleLiveTimeRefresh/);
assert.match(day, /nextMinuteDelay/);
assert.ok(day.indexOf('renderY();') < day.indexOf('if (allMode)'), 'Y must render before work-schedule early returns');
assert.match(day, /journalDayTimeline/);
assert.match(day, /accountNoteActions/);
assert.match(day, /getAccountNotesForDay/);
assert.match(day, /createJournalNoteFlow/);
assert.doesNotMatch(timeSource, /\bnote\b|type: 'note'/i);
assert.doesNotMatch(month, /core\/note|noteReels|data-journal-y/);
assert.doesNotMatch(list, /core\/note|noteReels|data-journal-y/);

assert.match(recordView, /Заметки/);
assert.match(recordView, /hasNotesForTarget\('record'/);
assert.match(eventView, /Заметки/);
assert.match(eventView, /hasNotesForTarget\('event'/);

assert.match(noteTarget, /Запись отменена/);
assert.match(noteTarget, /Запись удалена/);
assert.match(noteTarget, /targetSnapshot/);
assert.match(noteView, /variant: 'q'/);
assert.match(noteView, /button\('Изменить'/);
assert.match(noteView, /button\('Сохранить'/);
assert.match(noteView, /button\('Удалить'/);
assert.match(noteView, /noteContextWithTarget/);
assert.match(serverNoteService, /preservesExistingTarget/);
assert.match(serverNoteService, /listOwned/);
assert.match(serverNoteService, /upsertOwned/);
assert.match(accountNoteOwner, /online-booking\/account\/notes/);
assert.match(accountNoteOwner, /accountNoteActions/);
assert.match(accountNoteController, /Controller\('online-booking\/account\/notes'\)/);
assert.match(onlineBookingModule, /NoteModule/);
assert.match(onlineBookingModule, /AccountNoteController/);
const readPart = noteView.slice(noteView.indexOf('const renderRead'), noteView.indexOf('const renderEdit'));
assert.doesNotMatch(readPart, /Удалить/);

function browserBinary() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return '';
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

async function runBrowserRegression() {
  const binary = browserBinary();
  if (!binary) {
    if (process.env.CI) assert.fail('Chromium-compatible browser is required for Note / Y CI regression');
    console.log('Note / Y browser regression skipped: Chromium-compatible browser not found.');
    return;
  }

  const root = process.cwd();
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(root, relative);
      if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`) && resolved !== path.resolve(root, 'index.html')) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      const body = fs.readFileSync(resolved);
      response.writeHead(200, { 'Content-Type': contentType(resolved), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch {
      response.writeHead(404).end('Not found');
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    assert.ok(port, 'Note / Y browser regression server did not start');
    const url = `http://127.0.0.1:${port}/tests/note-y-runtime-browser.html`;
    const child = spawn(binary, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=390,844',
      '--force-device-scale-factor=1',
      '--touch-events=enabled',
      '--virtual-time-budget=10000',
      '--dump-dom',
      url,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { errors += chunk; });
    const exitCode = await new Promise((resolve) => child.once('close', resolve));
    assert.equal(exitCode, 0, `Note / Y browser process failed:\n${errors.slice(-4000)}`);
    assert.match(output, /data-note-y-runtime="pass"/, `Note / Y browser regression failed:\n${output.slice(-5000)}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await runBrowserRegression();

console.log('Note / Y regression test passed.');