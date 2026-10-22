import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordFlow = readFileSync(new URL('../core/records/records.js', import.meta.url), 'utf8');
const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const breakCreation = readFileSync(new URL('../journal/break-create.js', import.meta.url), 'utf8');
const breakView = readFileSync(new URL('../journal/break-view.js', import.meta.url), 'utf8');
const journalDay = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
const timeline = readFileSync(new URL('../ui/time/journal-day.js', import.meta.url), 'utf8');
const timeUsage = readFileSync(new URL('../core/time/usage.js', import.meta.url), 'utf8');
const dayEditor = readFileSync(new URL('../timetable/day-editor.js', import.meta.url), 'utf8');

assert.match(recordFlow, /checkTimeAvailability/);
assert.match(recordFlow, /getTimeAvailabilityAt/);
assert.match(recordFlow, /buildNaturalBookingTimeRows/);
assert.match(recordFlow, /recordCreationTimeRows\(rows/);
assert.match(recordFlow, /getWorkplaceWorkingDates/);
assert.doesNotMatch(recordFlow, /listAvailableEndTimes|createJournalBreak|break-service/);
assert.doesNotMatch(recordFlow, /isTimeRangeAvailable|getTimeUsages|getJournalBreaks|getRecords\(|getDayTime|getDay\(/);
assert.doesNotMatch(recordFlow, /from ['"]\.\.\/day\.js['"]/);

// Journal-owned Break creation uses canonical Availability without leaking Break into Record.
assert.match(breakCreation, /checkTimeAvailability/);
assert.match(breakCreation, /getTimeAvailabilityAt/);
assert.match(breakCreation, /listAvailableEndTimes/);
assert.match(breakCreation, /createJournalBreak/);
assert.doesNotMatch(breakCreation, /isTimeRangeAvailable|getTimeUsages|getRecordsForDay|getJournalBreaks/);

// Record View must not own a second Record time/edit flow.
assert.doesNotMatch(recordView, /openRecordEditFlow|openTimePickerAction|checkTimeAvailability|listAvailableStartTimes|listAvailableEndTimes|getBookingSettings/);
assert.doesNotMatch(recordView, /from ['"]\.\.\/day\.js['"]/);

assert.match(breakView, /listAvailableStartTimes/);
assert.match(breakView, /listAvailableEndTimes/);
assert.doesNotMatch(breakView, /isTimeRangeAvailable|getTimeUsages|getRecordsForDay|getJournalBreaks/);

assert.match(journalDay, /getTimeUsagesForScope/);
assert.match(journalDay, /getTimeAvailabilityAt/);
assert.doesNotMatch(journalDay, /getRecordsForDay|getJournalBreaks|getTimeUsages\(|rangesOverlap/);

assert.match(timeline, /onUsageClick/);
assert.doesNotMatch(timeline, /initJournalDayTimeline\([^)]*usages/);
assert.doesNotMatch(timeline, /const usage = .*\.find/);

assert.doesNotMatch(timeUsage, /export function isTimeRangeAvailable|export function getTimeUsages\b|export function getUsageAtTime\b/);
assert.match(dayEditor, /getDayDraftScheduleConflicts/);
assert.doesNotMatch(dayEditor, /rangesOverlap/);

console.log('time UI ownership tests: OK');
