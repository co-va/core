import { initCalendar, ALL_WORKPLACES_ID } from '../ui/ui.js';
import { bindCalendarHeaderHost } from '../ui/calendar/index.js';
import { getRecordPaymentState } from '../core/finance/index.js';
import { minutesBetween } from '../core/time/index.js';
import { getWorkplaces, getWorkingDays, getWorkingDayIndicators, getWorkingDay, getWorkingDayTotalMinutes, resolveWorkingDayTime } from '../core/workplace-time.js';
import { getRecords, recordVisualState } from '../core/record/index.js';

const RECORD_COLOR = '#EFFFBB';
const PAID_COLOR = '#DDE8D7';
const NO_SHOW_COLOR = '#F1DADA';

function recordMinutes(record) {
  return Math.max(0, minutesBetween(String(record?.from || ''), String(record?.to || '')) || 0);
}

function dayCapacityMinutes(workingDays, workplaces, workplaceId, dateKey, allMode) {
  if (allMode) return Math.max(0, getWorkingDayTotalMinutes(workingDays, workplaces, dateKey));
  const workingDay = getWorkingDay(workingDays, workplaceId, dateKey);
  const time = resolveWorkingDayTime(workplaces, workingDay);
  return time ? Math.max(0, minutesBetween(time.from, time.to)) : 0;
}

function recordsByDate(workplaceId, allMode) {
  const index = new Map();
  getRecords().forEach((record) => {
    if (record?.status === 'cancelled') return;
    if (!allMode && String(record?.workplaceId || '') !== String(workplaceId || '')) return;
    const key = String(record?.date || '').slice(0, 10);
    if (!key) return;
    const bucket = index.get(key) || [];
    bucket.push(record);
    index.set(key, bucket);
  });
  return index;
}

function dayRecordData({ dateKey, workplaceId, allMode, workingDays, workplaces, recordIndex }) {
  const records = recordIndex.get(dateKey) || [];
  const capacity = dayCapacityMinutes(workingDays, workplaces, workplaceId, dateKey, allMode);
  const minutes = { paid: 0, active: 0, noShow: 0 };

  records.forEach((record) => {
    const duration = recordMinutes(record);
    const paid = Boolean(getRecordPaymentState(record).fullyPaid);
    const state = recordVisualState(record, { paid });
    if (state === 'paid') minutes.paid += duration;
    else if (state === 'no-show') minutes.noShow += duration;
    else minutes.active += duration;
  });

  return { count: records.length, capacity, minutes };
}

function usageGradient({ capacity, minutes }) {
  if (!(capacity > 0)) return '';
  const values = [
    { color: PAID_COLOR, minutes: minutes.paid },
    { color: RECORD_COLOR, minutes: minutes.active },
    { color: NO_SHOW_COLOR, minutes: minutes.noShow },
  ];
  let cursor = 0;
  const stops = [];

  values.forEach((item) => {
    if (!(item.minutes > 0) || cursor >= 100) return;
    const width = Math.min(100 - cursor, (item.minutes / capacity) * 100);
    const end = cursor + width;
    stops.push(`${item.color} ${cursor.toFixed(2)}%`, `${item.color} ${end.toFixed(2)}%`);
    cursor = end;
  });

  if (!stops.length) return '';
  stops.push(`transparent ${cursor.toFixed(2)}%`, 'transparent 100%');
  return `linear-gradient(90deg,${stops.join(',')})`;
}

function dateContent(data) {
  const gradient = usageGradient(data);
  const fill = gradient ? `<span class="calendar__date-fill" style="--calendar-date-fill:${gradient}" aria-hidden="true"></span>` : '';
  const count = data.count ? `<span class="calendar__date-count">${data.count} зап.</span>` : '';
  return `${fill}${count}`;
}

function workingDatesForJournal(workingDays, workplaceId, allMode) {
  return [...new Set((Array.isArray(workingDays) ? workingDays : [])
    .filter((day) => allMode || String(day?.workplaceId || '') === String(workplaceId || ''))
    .map((day) => String(day?.date || ''))
    .filter(Boolean))];
}

export function renderJournalMonth(root, {
  month = new Date(),
  workplaceId = '',
  onDateSelect = () => {},
  onMonthChange = () => {},
  navigationRoot = null,
} = {}) {
  root.innerHTML = '<div data-journal-month-calendar></div>';
  const workingDays = getWorkingDays();
  const workplaces = getWorkplaces();
  const allMode = workplaceId === ALL_WORKPLACES_ID;
  const recordIndex = recordsByDate(workplaceId, allMode);
  const calendarRoot = root.querySelector('[data-journal-month-calendar]');

  initCalendar(calendarRoot, {
    month,
    workingDates: workingDatesForJournal(workingDays, workplaceId, allMode),
    renderDateContent: ({ dateKey, isCurrentMonth }) => {
      if (!isCurrentMonth) return '';
      return dateContent(dayRecordData({ dateKey, workplaceId, allMode, workingDays, workplaces, recordIndex }));
    },
    resolveDateIndicators: ({ dateKey, isCurrentMonth }) => isCurrentMonth
      ? getWorkingDayIndicators(workingDays, workplaces, dateKey, { excludeWorkplaceId: allMode ? '' : workplaceId })
      : [],
    onDateSelect: (dateKey) => {
      const [year, monthNumber, day] = String(dateKey).split('-').map(Number);
      if (!year || !monthNumber || !day) return;
      onDateSelect(new Date(year, monthNumber - 1, day));
    },
    onMonthChange,
  });

  return bindCalendarHeaderHost(calendarRoot, navigationRoot);
}
