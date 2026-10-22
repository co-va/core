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
assert.match(daySource, /journalDayTimeline\(\{ columns, day: dayDate \}\)/, 'Aggregate Journal Day must give Shared Timeline the visible date without a neutral baseline');
assert.match(daySource, /journalDayTimeline\(\{ from: time\.from, to: time\.to, usages, day: dayDate \}\)/, 'Professional Journal Day must pass its Work Schedule without a neutral baseline');
assert.match(daySource, /if \(!workingDay\) \{[\s\S]*?timelineRoot\.innerHTML = '<div class="time-day-state" aria-disabled="true">Выходной день<\/div>';[\s\S]*?return;[\s\S]*?\}/, 'Professional day off must keep the existing Timeline Выходной день state while Y remains mounted');
assert.match(daySource, /if \(usage\?\.type === 'record'\)[\s\S]*openExistingRecord\(usage, rerender\)/, 'Record usage must still open the existing Record View');
assert.match(daySource, /if \(usage\?\.type === 'event'\)[\s\S]*openEventView\(usage, \{ onClose: rerender \}\)/, 'Event usage must open the Event View');
assert.match(daySource, /onUsageClick: \(\{ usageId \}\) => \{[\s\S]*?const usage = usageById\.get\(String\(usageId \|\| ''\)\);[\s\S]*?void openUsage\(usage, rerender\);[\s\S]*?\}/, 'Professional usage click must keep using the existing openUsage path while allowing Y time highlighting');
assert.match(timeUsageSource, /getRecordsForDay\(previousDay, workplace\)\.filter\(crossesMidnight\)/, 'Journal occupancy must expose the previous-day overnight tail without creating another business object');

const professional = journalDayTimeline({ from: '10:30', to: '18:00', day: '2026-10-22' });
assert.match(professional, /data-time-from="10:30"/, 'Professional Timeline must start exactly at Work Schedule start');
assert.match(professional, /data-time-to="18:00"/, 'Professional Timeline must end exactly at Work Schedule end');
assert.doesNotMatch(professional, /data-time-slot-from="10:00"/, 'Professional Timeline must not add empty time before Work Schedule');
assert.match(professional, /data-time-slot-from="10:30"/, 'Professional Work Schedule start must remain interactive');

const professionalWide = journalDayTimeline({ from: '09:00', to: '22:30', day: '2026-10-22' });
assert.match(professionalWide, /data-time-from="09:00"/, 'Professional Timeline must preserve a 09:00 Work Schedule start');
assert.match(professionalWide, /data-time-to="22:30"/, 'Professional Timeline must preserve a 22:30 Work Schedule end');

const neutralBaseline = journalDayTimeline({
  from: '10:30',
  to: '18:00',
  day: '2026-10-22',
  neutralBaseline: { from: '09:00', to: '23:00' },
});
assert.match(neutralBaseline, /data-time-from="09:00"/, 'Shared Timeline must support an explicitly requested neutral baseline start');
assert.match(neutralBaseline, /data-time-to="23:00"/, 'Shared Timeline must support an explicitly requested neutral baseline end');
assert.doesNotMatch(neutralBaseline, /data-time-slot-from="09:00"/, 'Neutral baseline time outside professional Work Schedule must remain readonly');
assert.match(neutralBaseline, /data-time-slot-from="10:30"/, 'A free professional slot must remain interactive inside real Work Schedule');
assert.doesNotMatch(neutralBaseline, /data-time-slot-from="18:00"/, 'Professional slots must stop being interactive at Work Schedule end');

const professionalUsages = journalDayTimeline({
  from: '10:30',
  to: '18:00',
  day: '2026-10-22',
  usages: [
    { id: 'record-1', sourceId: 'record-1', date: '2026-10-22', type: 'record', from: '11:00', to: '12:00', person: { name: 'Тест' }, procedures: [] },
    { id: 'event-1', sourceId: 'event-1', date: '2026-10-22', type: 'event', from: '13:00', to: '13:30', title: 'Событие' },
  ],
});
assert.match(professionalUsages, /data-journal-usage="record-1"/, 'Existing Record must still render inside professional Work Schedule');
assert.match(professionalUsages, /data-journal-usage="event-1"/, 'Existing Event must render inside professional Work Schedule');

const early = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'early', date: '2026-10-22', from: '06:00', to: '06:30' }],
});
assert.match(early, /data-time-from="06:00"/, 'An allowed early object must expand the visible day to its start');
assert.match(early, /data-time-to="18:00"/, 'Without a neutral baseline, an early object must not add empty hours after Work Schedule');

const late = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'late', date: '2026-10-22', from: '22:30', to: '23:40' }],
});
assert.match(late, /data-time-from="10:00"/, 'Without a neutral baseline, a late object must not add empty hours before Work Schedule');
assert.match(late, /data-time-to="23:40"/, 'A late object must remain fully visible through its end');

const overnight = { id: 'overnight', date: '2026-10-22', from: '22:00', to: '02:00' };
const firstDay = journalDayTimeline({ from: '10:00', to: '18:00', day: '2026-10-22', usages: [overnight] });
assert.match(firstDay, /data-time-from="10:00"/, 'Overnight support must not add empty time before professional Work Schedule');
assert.match(firstDay, /data-time-to="24:00"/, 'The first day of an overnight object must render through midnight');
assert.match(firstDay, /data-time-usage="overnight"/, 'The overnight object must remain one usage on its first-day visual segment');

const nextDay = journalDayTimeline({ from: '10:00', to: '18:00', day: '2026-10-23', usages: [overnight] });
assert.match(nextDay, /data-time-from="00:00"/, 'The next day must expand to midnight for the overnight tail');
assert.match(nextDay, /data-time-to="18:00"/, 'Without a neutral baseline, the next day must end at professional Work Schedule');
assert.match(nextDay, /data-time-usage="overnight"/, 'The next-day tail must be a visual segment of the same usage');

const neutralRenderer = journalDayTimeline({
  from: '10:00',
  to: '18:00',
  day: '2026-10-22',
  usages: [{ id: 'neutral', date: '2026-10-22', type: 'usage', from: '12:00', to: '12:30' }],
  renderUsage: (usage) => `<div class="neutral-usage">${usage.id}</div>`,
});
assert.match(neutralRenderer, /class="neutral-usage">neutral<\/div>/, 'Shared Timeline must allow the calling contour to provide neutral usage presentation');

console.log('journal all-records click tests: OK');
