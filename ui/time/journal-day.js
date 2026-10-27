import { timeToMinutes, minutesToTime } from '../../core/time/index.js';

const DAY_MINUTES = 24 * 60;

const escape = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const moneyText = (value) => `${Math.max(0, Number(value) || 0).toLocaleString('ru-RU')} ₽`;
const overlapMarkup = (usage) => usage?.overlap ? '<span class="journal-usage__overlap" aria-label="Есть пересечение" title="Есть пересечение">⚠</span>' : '';

function recordMarkup(usage, { interactive = true } = {}) {
  const person = usage?.person || {};
  const name = [person.name, person.surname].filter(Boolean).join(' ') || 'Без имени';
  const id = String(person.uei || person.id || '').trim();
  const identity = id ? `${escape(id)} - ${escape(name)}` : escape(name);
  const total = moneyText(usage?.financialTotal ?? usage?.finance?.planTotal ?? usage?.finance?.dueTotal ?? 0);
  const phone = person.phone ? `<span class="journal-record__phone">${escape(person.phone)}</span>` : '';
  const services = (usage.procedures || []).map((item) => `<span class="journal-record__service">${escape(item.name)}</span>`).join('');
  const statusClass = usage?.paid ? ' journal-record--paid' : usage?.attendance === 'no-show' ? ' journal-record--no-show' : '';
  const content = `<span class="journal-record__head"><strong class="journal-record__identity">${identity}</strong><strong class="journal-record__total">${escape(total)}</strong></span>${phone}${services}${overlapMarkup(usage)}`;
  return interactive
    ? `<button type="button" class="journal-record${statusClass}" data-journal-usage="${escape(usage.sourceId || usage.id)}">${content}</button>`
    : `<div class="journal-record${statusClass}" aria-disabled="true">${content}</div>`;
}

function usageMarkup(usage, { interactive = true } = {}) {
  if (usage?.type === 'record') return recordMarkup(usage, { interactive });
  const title = escape(usage?.title || 'Событие');
  const period = `${escape(usage?.from || '')}–${escape(usage?.to || '')}`;
  const color = /^#[0-9A-Fa-f]{6}$/.test(String(usage?.color || '')) ? String(usage.color) : '#777A7D';
  const content = `<span class="journal-event__time">${period}</span><strong class="journal-event__title">${title}</strong>${overlapMarkup(usage)}`;
  return interactive
    ? `<button type="button" class="journal-record journal-record--event" style="--journal-event-color:${escape(color)}" data-journal-usage="${escape(usage.sourceId || usage.id)}">${content}</button>`
    : `<div class="journal-record journal-record--event" style="--journal-event-color:${escape(color)}" aria-disabled="true">${content}</div>`;
}

function dateOrdinal(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const stamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(stamp) ? Math.floor(stamp / 86400000) : null;
}

function usageSegment(usage, day = '') {
  const start = timeToMinutes(usage?.from);
  const rawEnd = timeToMinutes(usage?.to);
  if (start == null || rawEnd == null || rawEnd === start) return null;

  let absoluteStart = start;
  let absoluteEnd = rawEnd > start ? rawEnd : rawEnd + DAY_MINUTES;
  const usageDay = dateOrdinal(usage?.date);
  const visibleDay = dateOrdinal(day);
  if (usageDay != null && visibleDay != null) {
    const offset = usageDay - visibleDay;
    absoluteStart += offset * DAY_MINUTES;
    absoluteEnd += offset * DAY_MINUTES;
  }

  const clippedStart = Math.max(0, absoluteStart);
  const clippedEnd = Math.min(DAY_MINUTES, absoluteEnd);
  if (clippedEnd <= clippedStart) return null;
  return { start: clippedStart, end: clippedEnd };
}

function renderUsage(usage, options, renderer) {
  return String((typeof renderer === 'function' ? renderer : usageMarkup)(usage, options) ?? '');
}

function timelineRange({ workRanges = [], usages = [], day = '', neutralBaseline = null } = {}) {
  const segments = (Array.isArray(usages) ? usages : []).map((usage) => usageSegment(usage, day)).filter(Boolean);
  const starts = workRanges.map((range) => timeToMinutes(range?.from)).filter((value) => value != null);
  const ends = workRanges.map((range) => timeToMinutes(range?.to)).filter((value) => value != null);
  const baselineStart = timeToMinutes(neutralBaseline?.from);
  const baselineEnd = timeToMinutes(neutralBaseline?.to);
  if (baselineStart != null && baselineEnd != null && baselineEnd > baselineStart) {
    starts.push(baselineStart);
    ends.push(baselineEnd);
  }
  starts.push(...segments.map((segment) => segment.start));
  ends.push(...segments.map((segment) => segment.end));
  if (!starts.length || !ends.length) return { start: 0, end: 0, segments };
  const start = Math.max(0, Math.min(...starts));
  const end = Math.min(DAY_MINUTES, Math.max(...ends));
  return { start, end, segments };
}

function slotsMarkup(start, end, { interactive = true, workStart = start, workEnd = end } = {}) {
  const slots = [];
  for (let minutes = Math.ceil(start / 30) * 30; minutes < end; minutes += 30) {
    const next = Math.min(minutes + 30, end);
    const label = minutesToTime(minutes);
    const nextLabel = minutesToTime(next);
    const inner = `<span class="time-timeline__hour">${label}</span><span class="time-timeline__line"></span>`;
    const insideWork = interactive && minutes >= workStart && minutes < workEnd;
    slots.push(insideWork
      ? `<button type="button" class="time-timeline__slot" data-time-slot-from="${label}" data-time-slot-to="${nextLabel}" aria-label="${label}–${nextLabel}">${inner}</button>`
      : `<div class="time-timeline__slot time-timeline__slot--readonly${interactive ? ' time-timeline__slot--outside-work' : ''}" aria-hidden="true">${inner}</div>`);
  }
  return slots.join('');
}

function aggregateTimeline(columns = [], { day = '', usageRenderer = usageMarkup, neutralBaseline = null } = {}) {
  const prepared = (Array.isArray(columns) ? columns : []).map((column) => {
    const start = timeToMinutes(column?.from);
    const end = timeToMinutes(column?.to);
    if (start == null || end == null || end <= start) return null;
    return { ...column, start, end, usages: Array.isArray(column?.usages) ? column.usages : [] };
  }).filter(Boolean);
  if (!prepared.length) return '';

  const { start, end } = timelineRange({
    workRanges: prepared.map((column) => ({ from: column.from, to: column.to })),
    usages: [],
    day,
    neutralBaseline,
  });
  const total = end - start;
  const minWidth = 56 + prepared.length * 104;
  const headings = prepared.map((column) => `<strong class="journal-day-columns__heading">${escape(column?.name || 'Рабочее место')}</strong>`).join('');

  const fields = prepared.map((column) => {
    const top = ((column.start - start) / total) * 100;
    const height = ((column.end - column.start) / total) * 100;
    const usages = column.usages.map((usage) => {
      const segment = usageSegment(usage, day);
      if (!segment) return '';
      const visibleStart = Math.max(segment.start, column.start);
      const visibleEnd = Math.min(segment.end, column.end);
      if (visibleEnd <= visibleStart) return '';
      const usageTop = ((visibleStart - start) / total) * 100;
      const usageHeight = ((visibleEnd - visibleStart) / total) * 100;
      const markup = usageRenderer === usageMarkup
        ? usageMarkup(usage, { interactive: false })
        : renderUsage(usage, { interactive: false }, usageRenderer);
      return `<div class="journal-work-field__usage" style="top:${usageTop}%;height:${usageHeight}%" data-time-usage="${escape(usage.sourceId || usage.id)}">${markup}</div>`;
    }).join('');
    return `<div class="journal-work-column"><div class="journal-work-field${column?.conflict ? ' is-conflict' : ''}" role="button" tabindex="0" aria-label="Изменить рабочее пространство ${escape(column?.name || '')}" style="top:${top}%;height:${height}%" data-journal-work-field="${escape(column?.workplaceId || '')}"></div>${usages}</div>`;
  }).join('');

  return `<div class="journal-day-columns" data-journal-day-columns><div class="journal-day-columns__inner" style="min-width:${minWidth}px;--journal-column-count:${prepared.length}"><div class="journal-day-columns__headings"><span aria-hidden="true"></span>${headings}</div><section class="time-timeline time-timeline--columns" data-time-timeline data-time-from="${escape(minutesToTime(start))}" data-time-to="${escape(minutesToTime(end))}" style="--time-total-minutes:${total}">${slotsMarkup(start, end, { interactive: false })}<div class="journal-work-columns">${fields}</div></section></div></div>`;
}

export function journalDayTimeline({
  from = '09:00',
  to = '18:00',
  usages = [],
  columns = [],
  day = '',
  renderUsage: usageRenderer = usageMarkup,
  neutralBaseline = null,
  clipUsagesToWorkRange = false,
} = {}) {
  if (Array.isArray(columns) && columns.length) return aggregateTimeline(columns, { day, usageRenderer, neutralBaseline });
  const workStart = timeToMinutes(from), workEnd = timeToMinutes(to);
  if (workStart == null || workEnd == null || workEnd <= workStart) return '';

  const values = Array.isArray(usages) ? usages : [];
  const naturalRange = timelineRange({ workRanges: [{ from, to }], usages: values, day, neutralBaseline });
  const start = clipUsagesToWorkRange ? workStart : naturalRange.start;
  const end = clipUsagesToWorkRange ? workEnd : naturalRange.end;
  const total = end - start;
  const overlays = values.map((usage) => {
    const segment = usageSegment(usage, day);
    if (!segment) return '';
    const clippedStart = Math.max(start, segment.start), clippedEnd = Math.min(end, segment.end);
    if (clippedEnd <= clippedStart) return '';
    const top = ((clippedStart - start) / total) * 100;
    const height = ((clippedEnd - clippedStart) / total) * 100;
    return `<div class="time-timeline__usage" style="top:${top}%;height:${height}%" data-time-usage="${escape(usage.sourceId || usage.id)}">${renderUsage(usage, { interactive: true }, usageRenderer)}</div>`;
  }).join('');

  return `<section class="time-timeline" data-time-timeline data-time-from="${escape(minutesToTime(start))}" data-time-to="${escape(minutesToTime(end))}" style="--time-total-minutes:${total}">${slotsMarkup(start, end, { workStart, workEnd })}<div class="time-timeline__usages">${overlays}</div></section>`;
}

export function initJournalDayTimeline(root, {
  onSlotClick = () => {},
  onUsageClick = () => {},
  onWorkFieldClick = () => {},
} = {}) {
  if (root.__bookTimeUsageChangeHandler) window.removeEventListener('book:time-usage-changed', root.__bookTimeUsageChangeHandler);
  root.__bookTimeUsageChangeHandler = () => {};
  window.addEventListener('book:time-usage-changed', root.__bookTimeUsageChangeHandler);

  root.querySelectorAll('[data-journal-work-field]').forEach((field) => {
    const open = () => {
      const workplaceId = String(field.dataset.journalWorkField || '');
      if (workplaceId) onWorkFieldClick({ workplaceId });
    };
    field.addEventListener('click', open);
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      open();
    });
  });

  root.querySelectorAll('[data-time-slot-from]').forEach((slot) => slot.addEventListener('click', () => {
    onSlotClick({
      from: slot.dataset.timeSlotFrom || '',
      to: slot.dataset.timeSlotTo || '',
    });
  }));

  root.querySelectorAll('[data-journal-usage]').forEach((node) => node.addEventListener('click', (event) => {
    event.stopPropagation();
    const usageId = String(node.dataset.journalUsage || '');
    if (usageId) onUsageClick({ usageId });
  }));
}
