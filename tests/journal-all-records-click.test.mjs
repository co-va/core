import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const timelineSource = readFileSync(new URL('../ui/time/journal-day.js', import.meta.url), 'utf8');
const timelineCss = readFileSync(new URL('../ui/time/time.css', import.meta.url), 'utf8');
const journalSource = readFileSync(new URL('../journal/journal.js', import.meta.url), 'utf8');
const daySource = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');

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

console.log('journal all-records click tests: OK');
