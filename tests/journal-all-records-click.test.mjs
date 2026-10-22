import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { journalDayTimeline } from '../ui/time/journal-day.js';

const timelineSource = readFileSync(new URL('../ui/time/journal-day.js', import.meta.url), 'utf8');
const timelineCss = readFileSync(new URL('../ui/time/time.css', import.meta.url), 'utf8');
const journalSource = readFileSync(new URL('../journal/journal.js', import.meta.url), 'utf8');
const daySource = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
const timeUsageSource = readFileSync(new URL('../journal/time-usage-source.js', import.meta.url), 'utf8');

assert.match(timelineSource, /data-journal-work-field=/);
assert.match(timelineSource, /field\.addEventListener\('click',\s*open\)/);
assert.match(timelineSource, /onWorkFieldClick\(\{\s*workplaceId\s*\}\)/);
assert.match(timelineCss, /\.journal-work-field\{[^}]*pointer-events:auto[^}]*cursor:pointer/);
assert.match(timelineCss, /\.journal-work-field__usage\{[^}]*pointer-events:none/);
assert.match(journalSource, /const scheduleRefresh = \(\) => \{/, 'Journal must coalesce canonical domain refreshes');
assert.match(journalSource, /'book:records-changed'/, 'Every active Journal view, including Month, must rerender after server record changes');
assert.match(journalSource, /'book:dds-changed'/, 'Every active Journal view, including Day, must rerender after payment cancellation or refund');
assert.match(journalSource, /refreshEvents\.forEach\(\(eventName\) => window\.addEventListener\(eventName, scheduleRefresh\)\)/);
assert.doesNotMatch(journalSource, /activeView === 'day' \|\| activeView === 'list'\) renderView/, 'Month must not be excluded from record-change refresh');
assert.doesNotMatch(journalSource, /activeView === 'list' \|\| activeView === 'month'\) renderView/, 'Day must not be excluded from finance refresh');
assert.match(daySource, /openRecordView\(record, \{ onClose: rerender \}\)/, 'Day must rerender after Record View closes so cancelled records disappear from the timeline');
assert.match(daySource, /journalDayTimeline\(\{ columns, day: dayDate \}\)/, 'Aggregate Journal Day must give Shared Timeline the visible date');
assert.match(daySource, /journalDayTimeline\(\{ from: time\.from, to: time\.to, usages, day: dayDate \}\)/, 'Journal Day must keep Work Schedule separate from the Shared Timeline date');
assert.match(timeUsageSource, /getRecordsForDay\(previousDay, workplace\)\.filter\(crossesMidnight\)/, 'Journal occupancy must expose the previous-day overnight tail without creating another business object');

const ordinary = journalDayTimeline({ from: '10:00', to: '18:00', day: '2026-10-22' });
assert.match(ordinary, /data-time-from="09:00"/, 'Shared Timeline must start from the neutral 09:00 baseline');
assert.match(ordinary, /data-time-to="23:00"/, 'Shared Timeline must end at the neutral 23:00 baseline');
assert.doesNotMatch(ordinary, /data-time-slot-from="09:00"/, 'Neutral baseline hours outside professional Work Schedule must not become booking slots');
assert.match(ordinary, /data-time-slot-from="10:00"/, 'Professional Work Schedule must keep its real interactive start');

const early = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'early', date: '2026-10-22', from: '06:00', to: '06:30' }],
});
assert.match(early, /data-time-from="06:00"/, 'An early object must expand the visible day to its start');

const late = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'late', date: '2026-10-22', from: '22:30', to: '23:40' }],
});
assert.match(late, /data-time-to="23:40"/, 'A late object must remain fully visible through its end');

const overnight = { id: 'overnight', date: '2026-10-22', from: '22:00', to: '02:00' };
const firstDay = journalDayTimeline({ from: '10:00', to: '18:00', day: '2026-10-22', usages: [overnight] });
assert.match(firstDay, /data-time-to="24:00"/, 'The first day of an overnight object must render through midnight');
assert.match(firstDay, /data-time-usage="overnight"/, 'The overnight object must remain one usage on its first-day visual segment');

const nextDay = journalDayTimeline({ from: '10:00', to: '18:00', day: '2026-10-23', usages: [overnight] });
assert.match(nextDay, /data-time-from="00:00"/, 'The next day must expand to midnight for the overnight tail');
assert.match(nextDay, /data-time-to="23:00"/, 'After the overnight tail, the next day must continue through the normal baseline');
assert.match(nextDay, /data-time-usage="overnight"/, 'The next-day tail must be a visual segment of the same usage');

const neutral = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'neutral', date: '2026-10-22', type: 'usage', from: '12:00', to: '12:30' }],
  renderUsage: (usage) => `<div class="neutral-usage">${usage.id}</div>`,
});
assert.match(neutral, /class="neutral-usage">neutral<\/div>/, 'Shared Timeline must allow the calling contour to provide neutral usage presentation');

console.log('journal all-records click tests: OK');
