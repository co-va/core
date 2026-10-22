import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../timetable/timetable.js', import.meta.url), 'utf8');

assert.doesNotMatch(
  source,
  /selection\s*=\s*isAllMode\(\)\s*\?\s*null/,
  'aggregate Graph must not disable Calendar multi-select',
);

assert.match(
  source,
  /selection\s*=\s*initMultiSelect\(calendarRoot,\s*\{\s*onChange:\s*syncApplyButton\s*\}\)/,
  'Graph must keep shared multi-select in aggregate mode',
);

assert.match(
  source,
  /actionBlock\(button\(['"]Применить['"],\s*\{[\s\S]*?data:\s*['"]data-timetable-apply['"]/,
  'Graph Apply must use the Shared bottom action owner inside Z',
);
assert.doesNotMatch(
  source,
  /className:\s*['"]v2-primary-source-only['"]/,
  'Graph Apply must not keep a hidden source for Header C',
);
assert.match(
  source,
  /const\s+applyActions\s*=\s*applyButton\?\.closest\(['"]\.modal-actions['"]\)/,
  'Graph Apply visibility must be owned by its existing bottom action block',
);

assert.match(
  source,
  /if\s*\(allMode\)\s*\{[\s\S]*?selectionMode\s*=\s*['"]add-workplace['"][\s\S]*?applyButton\.disabled\s*=\s*false[\s\S]*?applyActions\)\s*applyActions\.hidden\s*=\s*false/,
  'selected aggregate dates must enable and reveal the bottom Apply action without changing the calendar mode',
);

assert.match(
  source,
  /if\s*\(!dates\.length\)\s*\{[\s\S]*?applyButton\.disabled\s*=\s*true[\s\S]*?applyActions\)\s*applyActions\.hidden\s*=\s*true/,
  'Apply must be absent when no dates are selected',
);

assert.match(
  source,
  /selectionMode\s*=\s*isWorkingDate\(dates\[0\]\)\s*\?\s*['"]make-off['"]\s*:\s*['"]make-working['"][\s\S]*?applyButton\.textContent\s*=\s*makeOff\s*\?\s*['"]Выходной['"]\s*:\s*['"]Рабочий['"][\s\S]*?applyButton\.classList\.toggle\(['"]ui-button--danger['"],\s*makeOff\)/,
  'workplace Graph must show Рабочий by default and Выходной as the danger bottom action according to the selected action',
);

assert.doesNotMatch(
  source,
  /openTimetableDayEditor/,
  'aggregate date click must not jump into the single-day editor',
);

assert.match(
  source,
  /function\s+openAggregateWorkplaceApply\(dates\)/,
  'aggregate Apply must have a workplace-selection step',
);

assert.match(
  source,
  /openAggregateWorkplaceApply\(dates\);\s*return;/,
  'aggregate Apply must pass the full selected-date set to workplace selection',
);

assert.match(
  source,
  /data-timetable-apply-workplace/,
  'aggregate Apply workplace picker must expose real workplace cards',
);
assert.match(
  source,
  /v2HorizontalRail\(cards\.join\(''\)/,
  'aggregate Apply workplace picker must use a horizontal Shared Entity Card rail',
);
assert.doesNotMatch(
  source,
  /openWorkplaceControl\s*\(/,
  'aggregate Apply must not fall back to the legacy workplace List',
);

assert.match(
  source,
  /resolveWorkplaceTime\(workplaces,\s*targetId\)/,
  'selected workplace must resolve its own base working time',
);

assert.match(
  source,
  /openWorkingTimePicker\(dates,\s*targetId\)/,
  'missing workplace time must preserve the full selected-date set',
);

assert.match(
  source,
  /applyWorkingDays\(dates,\s*base,\s*targetId\)/,
  'selected workplace must be applied to all selected dates',
);

assert.match(
  source,
  /function\s+applyWorkingDays\(dates,\s*base,\s*workplaceId\s*=\s*selectedWorkplaceId\)/,
  'mass working-day mutation must accept an explicit workplace target',
);

assert.match(
  source,
  /buildConflictEntry\(date,\s*base,\s*workplaceId\)/,
  'multi-date aggregate flow must reuse the canonical conflict path for the selected workplace',
);

assert.match(
  source,
  /openWorkingDaysConflictModal\(conflictEntries,\s*base,\s*workplaceId\)/,
  'multi-date aggregate conflicts must stay in the canonical conflict workflow',
);

console.log('timetable aggregate multi-select tests: OK');
