// Neutral occupancy contract between business owners and Core time mechanisms.
// This module does not own WorkPlan, Record, Event, Availability, or UI state.
import { containsRange, isValidRange, timeToMinutes } from './math.js';

let timeUsageSource = () => [];
let softTimeUsageReleaseSource = () => 0;

export function configureTimeUsageSource(source) {
  timeUsageSource = typeof source === 'function' ? source : () => [];
}

export function configureSoftTimeUsageReleaseSource(source) {
  softTimeUsageReleaseSource = typeof source === 'function' ? source : () => 0;
}

export function normalizeTimeUsage(usage = {}) {
  const from = String(usage?.from || '');
  const to = String(usage?.to || '');
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  if (start == null || end == null || start === end) return null;
  return {
    ...usage,
    type: String(usage?.type || 'usage'),
    rigidity: usage?.rigidity === 'hard' ? 'hard' : 'soft',
    sourceId: String(usage?.sourceId ?? usage?.id ?? ''),
    from,
    to,
  };
}

export function getTimeUsagesForScope(options = {}) {
  const values = timeUsageSource(options);
  return (Array.isArray(values) ? values : []).map(normalizeTimeUsage).filter(Boolean);
}

// WorkPlan asks whether existing usages still fit inside a changed working interval.
// This is not appointment availability: that belongs to availability.js.
export function getWorkingTimeUsageConflicts({ operation = 'resize', from, to, ...scope } = {}) {
  const usages = getTimeUsagesForScope(scope);
  if (operation === 'remove') return usages.filter((usage) => usage.rigidity === 'hard');
  if (!isValidRange(from, to)) return [];
  return usages.filter((usage) => !containsRange(from, to, usage.from, usage.to));
}

export function releaseWorkingTimeSoftUsages(options = {}) {
  const released = Number(softTimeUsageReleaseSource(options));
  return Number.isFinite(released) && released > 0 ? released : 0;
}

export function notifyTimeUsageChanged(detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('book:time-usage-changed', { detail }));
}
