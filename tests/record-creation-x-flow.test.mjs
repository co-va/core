import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getBookingTimeRows } from '../online-booking/model.js';

const records = fs.readFileSync('core/records/records.js', 'utf8');
const owner = fs.readFileSync('ui/record/creation-flow.js', 'utf8');
const day = fs.readFileSync('journal/день.js', 'utf8');
const journalView = fs.readFileSync('journal/journal-view.js', 'utf8');
const booking = fs.readFileSync('online-booking/access.js', 'utf8');
const personEntry = fs.readFileSync('core/people/record-creation.js', 'utf8');

assert.equal(fs.existsSync('journal/record.js'), false);
assert.equal(fs.existsSync('journal/record-view.js'), false);
assert.equal(fs.existsSync('journal/record-creation-x.js'), false);
assert.equal(fs.existsSync('records/records.js'), false);
assert.equal(fs.existsSync('core/records.js'), false);
assert.match(records, /export function openRecords/);
assert.match(owner, /variant: 'q'/);
assert.match(day, /import\('\.\.\/core\/records\/records\.js'\)/);
assert.match(day, /import\('\.\/journal-view\.js'\)/);
assert.match(journalView, /export function openJournalView/);
assert.match(personEntry, /from '\.\.\/records\/records\.js'/);
assert.match(booking, /from '\.\.\/core\/records\/records\.js'/);

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

console.log('Records shared Q flow smoke test passed');
