// Canonical availability queries over WorkPlan + neutral TimeGrid + occupancy sources.
// UI and business entities ask this module; they do not rebuild time availability themselves.
import { getDay, getDayTime, getDays } from '../day/index.js';
import { getWorkplaces } from '../workplace-time.js';
import { getTimeUsagesForScope } from './usage.js';
import { minutesToTime, timeToMinutes } from './math.js';
import { createTimeGrid, getTimeGridMinuteState, getTimeGridRangeState, listTimeGridAvailableEnds, listTimeGridAvailableStarts } from './grid.js';

function dateKey(value) { return String(value || '').slice(0, 10); }
function nextDateKey(value) {
  const match = dateKey(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function getAvailabilityGrid({ date, workplaceId } = {}) {
  const day = dateKey(date), workplace = String(workplaceId || '');
  const workingDay = getDay(getDays(), workplace, day);
  const plan = getDayTime(workingDay, getWorkplaces());
  const usages = getTimeUsagesForScope({ date: day, workplaceId: workplace });
  return createTimeGrid({ date: day, workplaceId: workplace, plan, usages });
}

function crossMidnightAvailability({ date, workplaceId, from, to, excludeId = '' }) {
  const start = timeToMinutes(from), end = timeToMinutes(to);
  if (start == null || end == null || end >= start) return null;
  const first = getAvailabilityGrid({ date, workplaceId });
  const second = getAvailabilityGrid({ date: nextDateKey(date), workplaceId });
  const conflicts = [];
  const inspect = (grid, begin, finish, allow2359AsEnd = false) => {
    const effectiveFinish = allow2359AsEnd && timeToMinutes(grid?.plan?.to) === 1439 ? Math.min(finish, 1439) : finish;
    for (let minute = begin; minute < effectiveFinish; minute += 1) {
      const state = getTimeGridMinuteState(grid, minutesToTime(minute), { excludeId });
      if (state.state === 'outside-plan') return { ok: false, reason: 'outside-working-time' };
      if (state.state === 'occupied' && state.usage && !conflicts.some((item) => item.sourceId === state.usage.sourceId)) conflicts.push(state.usage);
    }
    return { ok: true, reason: '' };
  };
  const firstResult = inspect(first, start, 1440, true);
  if (!firstResult.ok) return { ...firstResult, conflicts: [], grid: first, nextGrid: second };
  const secondResult = inspect(second, 0, end);
  if (!secondResult.ok) return { ...secondResult, conflicts: [], grid: first, nextGrid: second };
  if (conflicts.length) return { ok: false, reason: 'occupied', conflicts, grid: first, nextGrid: second };
  return { ok: true, reason: '', conflicts: [], grid: first, nextGrid: second };
}

export function checkTimeAvailability({ date, workplaceId, from, to, excludeId = '' } = {}) {
  const cross = crossMidnightAvailability({ date, workplaceId, from, to, excludeId });
  if (cross) return cross;
  const grid = getAvailabilityGrid({ date, workplaceId });
  return { ...getTimeGridRangeState(grid, { from, to, excludeId }), grid };
}
export function getTimeAvailabilityAt({ date, workplaceId, time, excludeId = '' } = {}) { const grid = getAvailabilityGrid({ date, workplaceId }); return { ...getTimeGridMinuteState(grid, time, { excludeId }), grid }; }
export function listAvailableStartTimes({ date, workplaceId, duration, step = 5, from = '', to = '', excludeId = '' } = {}) { const grid = getAvailabilityGrid({ date, workplaceId }); return listTimeGridAvailableStarts(grid, { duration, step, from, to, excludeId }); }
export function listAvailableEndTimes({ date, workplaceId, from, step = 5, to = '', excludeId = '' } = {}) { const grid = getAvailabilityGrid({ date, workplaceId }); return listTimeGridAvailableEnds(grid, { from, step, to, excludeId }); }
