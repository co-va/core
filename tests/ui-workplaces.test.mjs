import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_WORKPLACES_ID, headerControl, workplaceAddButton, workplaceContent } from '../ui/ui.js';

const addMarkup = workplaceAddButton();
assert.match(addMarkup, /\+ Добавить рабочее место/);
assert.match(addMarkup, /\bui-button\b/);
assert.match(addMarkup, /ui-button--secondary/);
assert.doesNotMatch(addMarkup, /ui-button--(?:full|small|compact)/);
assert.match(addMarkup, /data-add-workplace/);

const contentMarkup = workplaceContent({
  workplace: { key: 'beauty', name: 'Бьюти Тория' },
  showStats: true,
  stats: { days: 13, hours: 108, minutes: 0 },
});
assert.match(contentMarkup, /Бьюти Тория/);
assert.match(contentMarkup, /13 дней/);
assert.match(contentMarkup, /108 ч 00 м/);
assert.doesNotMatch(contentMarkup, /<button\b/);
assert.doesNotMatch(contentMarkup, /workplace-header-content/);
assert.equal(ALL_WORKPLACES_ID, '__all__');

const headerMarkup = headerControl(contentMarkup, {
  data: 'data-workplace-header-open',
  aria: 'Рабочее место: Бьюти Тория',
});
assert.match(headerMarkup, /class="header-control"/);
assert.match(headerMarkup, /data-header-control/);
assert.match(headerMarkup, /data-workplace-header-open/);
assert.match(headerMarkup, /Бьюти Тория/);
assert.doesNotMatch(headerMarkup, /timetable-workplace-button/);

const headerSource = readFileSync(new URL('../ui/header/index.js', import.meta.url), 'utf8');
assert.match(headerSource, /export function openHeaderControl\b/);
assert.match(headerSource, /variant:\s*'x'/);

const workplaceSource = readFileSync(new URL('../ui/workplaces/index.js', import.meta.url), 'utf8');
assert.match(workplaceSource, /list\(\{\s*items:\s*listItems\s*\}\)/);
assert.match(workplaceSource, /Общий график/);
assert.doesNotMatch(workplaceSource, /Все записи|aggregateLabel|aggregateAria/);
assert.match(workplaceSource, /WORKPLACE_FALLBACK_COLOR\s*=\s*'#212529'/);
assert.doesNotMatch(workplaceSource, /function\s+openPicker\b/);
assert.doesNotMatch(workplaceSource, /data-workplace-control-save/);
assert.doesNotMatch(workplaceSource, /Корректировка времени/);
assert.doesNotMatch(workplaceSource, /workplaceControlFrom|workplaceControlTo/);
assert.doesNotMatch(workplaceSource, /<h2>Рабочий график<\/h2>/);
assert.match(workplaceSource, /title\s*=\s*''/);
assert.match(workplaceSource, /subtitle\s*=\s*''/);
assert.match(workplaceSource, /openHeaderControl\(content,\s*\{\s*title:\s*visibleTitle\s*\|\|\s*visibleSubtitle\s*\}\)/);

const dayControlSource = readFileSync(new URL('../ui/workplaces/day-control.js', import.meta.url), 'utf8');
assert.match(dayControlSource, /data-day-workplace-time-add/);
assert.match(dayControlSource, /\+ Добавить рабочее пространство/);
assert.match(dayControlSource, /openCatalog\(\{ workplaces: available, title: catalogTitle, onSelect: onAdd \}\)/);

const graphSource = readFileSync(new URL('../timetable/timetable.js', import.meta.url), 'utf8');
assert.doesNotMatch(graphSource, /openWorkplaceControl\s*\(/);
assert.doesNotMatch(graphSource, /title:\s*'Рабочий график'/);
assert.match(graphSource, /title:\s*title\s*\|\|\s*\(allMode\s*\?\s*'Общий график'\s*:\s*\(workplace\?\.name\s*\|\|\s*'Рабочее пространство'\)\)/);
assert.match(graphSource, /kind:\s*'logo'/);
assert.match(graphSource, /function\s+openTimetableSettingsZ2\(\)/);
assert.match(graphSource, /title:\s*'Настройки графика'/);
assert.match(graphSource, /v2HorizontalRail\(cards\.join\(''\)/);
assert.match(graphSource, /workplaceGraphCard/);
assert.match(graphSource, /aggregateGraphCard/);
assert.match(graphSource, /mountV2ZLayer\(root,\s*v2ZLayer/);
assert.match(graphSource, /disabled:\s*true/);
assert.match(graphSource, /hideD:\s*true/);
assert.match(graphSource, /actionBlock\(button\('Применить'/);
assert.match(graphSource, /data:\s*'data-timetable-apply'/);
assert.match(graphSource, /const\s+applyActions\s*=\s*applyButton\?\.closest\('\.modal-actions'\)/);
assert.match(graphSource, /applyActions\)\s*applyActions\.hidden\s*=\s*false/);
assert.match(graphSource, /applyButton\.textContent\s*=\s*makeOff\s*\?\s*'Выходной'\s*:\s*'Рабочий'/);
assert.match(graphSource, /applyButton\.classList\.toggle\('ui-button--danger',\s*makeOff\)/);
assert.doesNotMatch(graphSource, /v2-primary-source-only|data-v2-primary-visible|v2PrimaryLabel|v2PrimaryVariant/);
assert.doesNotMatch(graphSource, /openTimetableDayEditor/);
assert.doesNotMatch(graphSource, /function\s+openAggregateDayEditor/);
assert.match(graphSource, /selection\s*=\s*initMultiSelect\(calendarRoot,\s*\{\s*onChange:\s*syncApplyButton\s*\}\)/);
assert.match(graphSource, /function\s+openAggregateWorkplaceApply\(dates\)/);
assert.match(graphSource, /data-timetable-apply-workplace/);
assert.match(graphSource, /openAggregateWorkplaceApply\(dates\);\s*return;/);
assert.match(graphSource, /workplace\?\.photo/);
assert.doesNotMatch(graphSource, /workplace\?\.city|workplace\?\.address|workplace\?\.from|workplace\?\.to/);
assert.match(graphSource, /topRightMeta/);
assert.match(graphSource, /summary\.days/);
assert.match(graphSource, /summary\.duration/);
assert.doesNotMatch(graphSource, /journal\//);
assert.doesNotMatch(graphSource, /canCorrectTime|onSaveTime/);

const dayEditorSource = readFileSync(new URL('../timetable/day-editor.js', import.meta.url), 'utf8');
assert.match(dayEditorSource, /export function openTimetableDayEditor/);
assert.match(dayEditorSource, /export function openTimetableDayTimeEditor/);
assert.match(dayEditorSource, /variant:\s*'q'/);
assert.match(dayEditorSource, /time-range-fields/);
assert.match(dayEditorSource, /getWorkingTimeUsageConflicts/);
assert.match(dayEditorSource, /Пересечение с/);
assert.match(dayEditorSource, /data-aggregate-day-add/);
assert.match(dayEditorSource, /openDayWorkplaceControl/);
assert.match(dayEditorSource, /Добавить рабочее пространство/);
assert.match(dayEditorSource, /createDay\(\{ date:\s*day, workplaceId:\s*value\.workplaceId/);
assert.match(dayEditorSource, /saveDays\(workingDays\)/);
assert.doesNotMatch(dayEditorSource, /journal\//);

const journalSource = readFileSync(new URL('../journal/journal.js', import.meta.url), 'utf8');
assert.match(journalSource, /openJournalWorkplaceControl/);
assert.match(journalSource, /onWorkplaceFieldClick:\s*openDayTime/);
assert.match(journalSource, /openTimetableDayTimeEditor/);
assert.match(journalSource, /from '..\/timetable\/day-editor\.js'/);
assert.doesNotMatch(journalSource, /getDayWorkplaceDraft|saveDayWorkplaceTime|openDayWorkplaceTime/);
assert.doesNotMatch(journalSource, /openWorkplaceControl/);
assert.doesNotMatch(journalSource, /canCorrectTime|onSaveTime|updateDayTime|hasScheduleConflict|createDay|saveDays/);

const journalDaySource = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
assert.match(journalDaySource, /onWorkplaceFieldClick\s*=\s*\(\)\s*=>\s*\{\}/);
assert.match(journalDaySource, /onWorkFieldClick:/);

const journalTimelineSource = readFileSync(new URL('../ui/time/journal-day.js', import.meta.url), 'utf8');
assert.match(journalTimelineSource, /usageMarkup\(usage,\s*\{ interactive:\s*false \}\)/);
assert.match(journalTimelineSource, /data-journal-work-field/);
assert.match(journalTimelineSource, /onWorkFieldClick\s*=\s*\(\)\s*=>\s*\{\}/);
assert.match(journalTimelineSource, /aria-disabled="true"/);

const journalControlSource = readFileSync(new URL('../journal/workplace-control.js', import.meta.url), 'utf8');
assert.match(journalControlSource, /export function openJournalWorkplaceControl/);
assert.match(journalControlSource, /label:\s*'График дня'/);
assert.match(journalControlSource, /data-journal-workplace-select/);
assert.match(journalControlSource, /select\(\{/);
assert.match(journalControlSource, /variant:\s*'x'/);
assert.match(journalControlSource, /indicatorColor/);
assert.match(journalControlSource, /recordCountText/);
assert.doesNotMatch(journalControlSource, /openHeaderControl|list\(\{\s*items\s*\}\)|Общий график|data-workplace-control-select/);

const timeGridSource = readFileSync(new URL('../core/time/grid.js', import.meta.url), 'utf8');
assert.match(timeGridSource, /export function createTimeGrid/);
assert.match(timeGridSource, /getTimeGridMinuteState/);
assert.match(timeGridSource, /getTimeGridRangeState/);
assert.doesNotMatch(timeGridSource, /journal\/|timetable\/|ui\//);

const availabilitySource = readFileSync(new URL('../core/time/availability.js', import.meta.url), 'utf8');
assert.match(availabilitySource, /getAvailabilityGrid/);
assert.match(availabilitySource, /checkTimeAvailability/);
assert.match(availabilitySource, /listAvailableStartTimes/);
assert.match(availabilitySource, /listAvailableEndTimes/);
assert.match(availabilitySource, /getTimeUsagesForScope/);
assert.doesNotMatch(availabilitySource, /journal\/|timetable\/|ui\//);

const journalTimeUsageSource = readFileSync(new URL('../journal/time-usage-source.js', import.meta.url), 'utf8');
assert.match(journalTimeUsageSource, /export function getJournalTimeUsages/);
assert.match(journalTimeUsageSource, /type:\s*'record'/);
assert.match(journalTimeUsageSource, /rigidity:\s*'hard'/);
assert.match(journalTimeUsageSource, /type:\s*'event'/);
assert.match(journalTimeUsageSource, /rigidity:\s*'soft'/);
assert.match(journalTimeUsageSource, /export function releaseJournalSoftTimeUsages/);
assert.match(journalTimeUsageSource, /removeEventsForDay/);
assert.match(journalTimeUsageSource, /getRecordsForDay/);
assert.match(journalTimeUsageSource, /getEventsForDay/);
assert.doesNotMatch(journalTimeUsageSource, /containsRange|rangesOverlap|isValidRange/);

const timeUsageSource = readFileSync(new URL('../core/time/usage.js', import.meta.url), 'utf8');
assert.match(timeUsageSource, /configureTimeUsageSource/);
assert.match(timeUsageSource, /getTimeUsagesForScope/);
assert.match(timeUsageSource, /getWorkingTimeUsageConflicts/);
assert.match(timeUsageSource, /configureSoftTimeUsageReleaseSource/);
assert.match(timeUsageSource, /releaseWorkingTimeSoftUsages/);
assert.doesNotMatch(timeUsageSource, /configureWorkingTimeConflictSource/);

const coreSource = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
assert.match(coreSource, /configureTimeUsageSource\(getJournalTimeUsages\)/);
assert.match(coreSource, /configureSoftTimeUsageReleaseSource\(releaseJournalSoftTimeUsages\)/);
assert.doesNotMatch(coreSource, /configureWorkingTimeConflictSource/);

const recordDataSource = readFileSync(new URL('../core/record/data.js', import.meta.url), 'utf8');
const recordServiceSource = readFileSync(new URL('../core/record/service.js', import.meta.url), 'utf8');
assert.match(recordServiceSource, /checkTimeAvailability/);
assert.doesNotMatch(recordServiceSource, /getDays|getDayTime|getWorkplaces|getJournalBreaks|rangesOverlap|containsRange/);
assert.doesNotMatch(recordDataSource, /checkTimeAvailability|getDays|getDayTime|getWorkplaces|getJournalBreaks|rangesOverlap|containsRange/);

const daySource = readFileSync(new URL('../core/day/service.js', import.meta.url), 'utf8');
assert.match(daySource, /releaseWorkingTimeSoftUsages/);
assert.match(daySource, /operation:\s*'remove'/);
assert.doesNotMatch(daySource, /journal\//);

const timeSource = readFileSync(new URL('../ui/time/index.js', import.meta.url), 'utf8');
assert.match(timeSource, /dispatchEvent\(new Event\('change',\{bubbles:true\}\)\)/);

const workplaceDataSource = readFileSync(new URL('../core/profile/workplaces/data.js', import.meta.url), 'utf8');
assert.match(workplaceDataSource, /color:\s*String\(workplace\.color/);
assert.match(workplaceDataSource, /indicatorColor:\s*workplace\.color\s*\|\|\s*WORKPLACE_FALLBACK_COLOR/);

const workplaceEditorSource = readFileSync(new URL('../core/profile/workplaces/workplaces.js', import.meta.url), 'utf8');
assert.match(workplaceEditorSource, /colorPicker\(\{name:'workplaceColor'/);
assert.match(workplaceEditorSource, /Название, город и цвет обязательны/);

const calendarSource = readFileSync(new URL('../ui/calendar/calendar.js', import.meta.url), 'utf8');
assert.match(calendarSource, /resolveDateIndicators/);
assert.match(calendarSource, /calendar__date-indicator/);

console.log('ui-workplaces tests: OK');
