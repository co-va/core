import { getEventsForDay } from '../core/event/index.js';
import { getRecordsForDay } from '../core/record/index.js';
import { timeToMinutes } from '../core/time/index.js';

function previousDateKey(value = '') {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) - 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function crossesMidnight(item = null) {
  const from = timeToMinutes(item?.from);
  const to = timeToMinutes(item?.to);
  return from != null && to != null && to < from;
}

export function getJournalTimeUsages({ date, workplaceId } = {}) {
  const day = String(date || '').slice(0, 10);
  const workplace = String(workplaceId || '');
  const previousDay = previousDateKey(day);
  const records = [
    ...getRecordsForDay(day, workplace),
    ...(previousDay ? getRecordsForDay(previousDay, workplace).filter(crossesMidnight) : []),
  ].filter((record) => record?.status !== 'cancelled').map((record) => ({
    ...record, type: 'record', rigidity: 'hard', sourceId: String(record?.id || ''), from: String(record?.from || ''), to: String(record?.to || ''),
  }));
  const events = [
    ...getEventsForDay(day),
    ...(previousDay ? getEventsForDay(previousDay).filter(crossesMidnight) : []),
  ].map((item) => ({
    ...item, type: 'event', rigidity: 'soft', sourceId: String(item?.id || ''), from: String(item?.from || ''), to: String(item?.to || ''),
  }));
  return [...records, ...events];
}

export function releaseJournalSoftTimeUsages() {
  return 0;
}
