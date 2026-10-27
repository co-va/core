import test from 'node:test';
import assert from 'node:assert/strict';
import { journalDayTimeline } from '../ui/time/journal-day.js';

const event = (id, from, to, overlap = false) => ({
  id,
  sourceId: id,
  type: 'event',
  date: '2026-10-27',
  from,
  to,
  title: id,
  color: '#777A7D',
  overlap,
});

test('explicit personal Journal conflicts render in separate clickable lanes', () => {
  const html = journalDayTimeline({
    from: '09:00',
    to: '12:00',
    day: '2026-10-27',
    usages: [event('first', '10:00', '11:00', true), event('second', '10:30', '11:30', true)],
  });
  assert.ok(html.includes('left:0;right:calc(50% + 2px)'));
  assert.ok(html.includes('left:calc(50% + 2px);right:0'));
  assert.equal((html.match(/data-journal-usage=/g) || []).length, 2);
  assert.equal((html.match(/journal-usage__overlap/g) || []).length, 2);
});

test('chained conflicts reuse a lane when intervals no longer overlap', () => {
  const html = journalDayTimeline({
    from: '09:00',
    to: '13:00',
    day: '2026-10-27',
    usages: [
      event('long', '10:00', '12:00', true),
      event('early', '10:15', '10:45', true),
      event('late', '11:00', '11:30', true),
    ],
  });
  assert.equal((html.match(/left:calc\(50% \+ 2px\);right:0/g) || []).length, 2);
});

test('legacy/unflagged timeline keeps full-width layout', () => {
  const html = journalDayTimeline({
    from: '09:00',
    to: '12:00',
    day: '2026-10-27',
    usages: [event('one', '10:00', '11:00'), event('two', '10:30', '11:30')],
  });
  assert.equal((html.match(/left:calc\(/g) || []).length, 0);
  assert.equal((html.match(/right:calc\(/g) || []).length, 0);
});
