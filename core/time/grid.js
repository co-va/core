// Neutral minute-resolution time grid.
// Owns no business entities and stores no application state.
import { isValidRange, timeToMinutes, minutesToTime } from './math.js';

const RIGIDITY_WEIGHT = Object.freeze({ soft: 1, hard: 2 });
const DAY_MINUTES = 24 * 60;

function normalizeDate(value) { return String(value || '').slice(0, 10); }
function dateOrdinal(value) {
  const match = normalizeDate(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

function normalizeUsage(usage = {}, gridDate = '') {
  const from = String(usage?.from || '');
  const to = String(usage?.to || '');
  const start = timeToMinutes(from);
  const rawEnd = timeToMinutes(to);
  if (start == null || rawEnd == null || start === rawEnd) return null;
  const usageDay = dateOrdinal(usage?.date || gridDate);
  const visibleDay = dateOrdinal(gridDate);
  const offset = usageDay != null && visibleDay != null ? (usageDay - visibleDay) * DAY_MINUTES : 0;
  const absoluteStart = start + offset;
  const absoluteEnd = (rawEnd > start ? rawEnd : rawEnd + DAY_MINUTES) + offset;
  const gridStart = Math.max(0, absoluteStart);
  const gridEnd = Math.min(DAY_MINUTES, absoluteEnd);
  if (gridEnd <= gridStart) return null;
  const rigidity = usage?.rigidity === 'hard' ? 'hard' : 'soft';
  return { ...usage, sourceId: String(usage?.sourceId ?? usage?.id ?? ''), type: String(usage?.type || 'usage'), rigidity, from, to, gridStart, gridEnd };
}

function normalizePlan(plan = null) { if (!plan || !isValidRange(plan?.from, plan?.to)) return null; return { from: String(plan.from), to: String(plan.to) }; }

export function createTimeGrid({ date = '', workplaceId = '', plan = null, usages = [] } = {}) {
  const day = normalizeDate(date);
  return Object.freeze({ date: day, workplaceId: String(workplaceId || ''), plan: normalizePlan(plan), usages: Object.freeze((Array.isArray(usages) ? usages : []).map((usage) => normalizeUsage(usage, day)).filter(Boolean)) });
}

export function getTimeGridMinuteState(grid, time, { excludeId = '' } = {}) {
  const minute = timeToMinutes(time);
  const planStart = timeToMinutes(grid?.plan?.from);
  const planEnd = timeToMinutes(grid?.plan?.to);
  if (minute == null || planStart == null || planEnd == null || minute < planStart || minute >= planEnd) return { state: 'outside-plan', rigidity: '', usage: null };
  const excluded = String(excludeId || '');
  const occupied = (Array.isArray(grid?.usages) ? grid.usages : []).filter((usage) => (!excluded || String(usage?.sourceId || '') !== excluded) && usage.gridStart <= minute && minute < usage.gridEnd).sort((left, right) => (RIGIDITY_WEIGHT[right?.rigidity] || 0) - (RIGIDITY_WEIGHT[left?.rigidity] || 0));
  const usage = occupied[0] || null;
  if (!usage) return { state: 'free', rigidity: '', usage: null };
  return { state: 'occupied', rigidity: usage.rigidity, usage };
}

export function getTimeGridRangeState(grid, { from, to, excludeId = '' } = {}) {
  if (!isValidRange(from, to)) return { ok: false, reason: 'invalid-time', conflicts: [] };
  const planStart = timeToMinutes(grid?.plan?.from), planEnd = timeToMinutes(grid?.plan?.to), start = timeToMinutes(from), end = timeToMinutes(to);
  if (planStart == null || planEnd == null) return { ok: false, reason: 'day-not-working', conflicts: [] };
  if (start == null || end == null || start < planStart || end > planEnd) return { ok: false, reason: 'outside-working-time', conflicts: [] };
  const excluded = String(excludeId || '');
  const conflicts = (Array.isArray(grid?.usages) ? grid.usages : []).filter((usage) => (!excluded || String(usage?.sourceId || '') !== excluded) && start < usage.gridEnd && usage.gridStart < end).sort((left, right) => (RIGIDITY_WEIGHT[right?.rigidity] || 0) - (RIGIDITY_WEIGHT[left?.rigidity] || 0));
  return conflicts.length ? { ok: false, reason: 'occupied', conflicts } : { ok: true, reason: '', conflicts: [] };
}

export function listTimeGridAvailableStarts(grid, { duration = 0, step = 5, from = '', to = '', excludeId = '' } = {}) {
  const minutes = Math.max(1, Number(duration) || 0), increment = Math.max(1, Number(step) || 1);
  const planStart = timeToMinutes(grid?.plan?.from), planEnd = timeToMinutes(grid?.plan?.to), windowStart = timeToMinutes(from), windowEnd = timeToMinutes(to);
  if (planStart == null || planEnd == null) return [];
  const start = Math.max(planStart, windowStart == null ? planStart : windowStart), end = Math.min(planEnd, windowEnd == null ? planEnd : windowEnd), values = [];
  for (let minute = Math.ceil(start / increment) * increment; minute + minutes <= end; minute += increment) { const candidateFrom = minutesToTime(minute), candidateTo = minutesToTime(minute + minutes); if (!candidateFrom || !candidateTo) continue; if (getTimeGridRangeState(grid, { from: candidateFrom, to: candidateTo, excludeId }).ok) values.push(candidateFrom); }
  return values;
}

export function listTimeGridAvailableEnds(grid, { from, step = 5, to = '', excludeId = '' } = {}) {
  const start = timeToMinutes(from), planEnd = timeToMinutes(grid?.plan?.to), windowEnd = timeToMinutes(to), increment = Math.max(1, Number(step) || 1);
  if (start == null || planEnd == null) return [];
  const end = Math.min(planEnd, windowEnd == null ? planEnd : windowEnd), values = [];
  for (let minute = start + increment; minute <= end; minute += increment) { const candidateTo = minutesToTime(minute); if (!candidateTo) continue; if (getTimeGridRangeState(grid, { from, to: candidateTo, excludeId }).ok) values.push(candidateTo); }
  return values;
}
