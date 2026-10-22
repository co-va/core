import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordFlow = readFileSync(new URL('../core/records/records.js', import.meta.url), 'utf8');
const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const eventCreation = readFileSync(new URL('../journal/event-create.js', import.meta.url), 'utf8');
const eventView = readFileSync(new URL('../journal/event-view.js', import.meta.url), 'utf8');
const journalDay = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
const timeline = readFileSync(new URL('../ui/time/journal-day.js', import.meta.url), 'utf8');
const timeUsage = readFileSync(new URL('../core/time/usage.js', import.meta.url), 'utf8');
const dayEditor = readFileSync(new URL('../timetable/day-editor.js', import.meta.url), 'utf8');

assert.match(recordFlow, /checkTimeAvailability/);
assert.match(recordFlow, /getTimeAvailabilityAt/);
assert.match(recordFlow, /buildNaturalBookingTimeRows/);
assert.match(recordFlow, /recordCreationTimeRows\(rows/);
assert.match(recordFlow, /getWorkplaceWorkingDates/);
assert.doesNotMatch(recordFlow, /listAvailableEndTimes|createEvent|break-service/);
assert.doesNotMatch(recordFlow, /isTimeRangeAvailable|getTimeUsages|getJournalBreaks|getRecords\(|getDayTime|getDay\(/);
assert.doesNotMatch(recordFlow, /from ['"]\.\.\/day\.js['"]/);

// Event creation uses canonical Availability with the two shared Time picker fields directly in Z.
assert.match(eventCreation, /checkTimeAvailability/);
assert.match(eventCreation, /timePicker\(\{ label: 'С'/);
assert.match(eventCreation, /timePicker\(\{ label: 'До'/);
assert.match(eventCreation, /initTimePickers/);
assert.doesNotMatch(eventCreation, /openTimeRangeAction/);
assert.match(eventCreation, /createEvent/);
assert.doesNotMatch(eventCreation, /isTimeRangeAvailable|getTimeUsages|getRecordsForDay|getJournalBreaks|listAvailableEndTimes/);

// Event View edits the same Event through canonical Availability and excludeId.
assert.match(eventView, /checkTimeAvailability/);
assert.match(eventView, /excludeId: eventId/);
assert.match(eventView, /openTimeRangeAction/);
assert.doesNotMatch(eventView, /isTimeRangeAvailable|getTimeUsages|getRecordsForDay|getJournalBreaks/);

// Record View must not own a second Record time/edit flow.
assert.doesNotMatch(recordView, /openRecordEditFlow|openTimePickerAction|checkTimeAvailability|listAvailableStartTimes|listAvailableEndTimes|getBookingSettings/);
assert.doesNotMatch(recordView, /from ['"]\.\.\/day\.js['"]/);

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
