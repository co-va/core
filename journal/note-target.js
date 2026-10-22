import { getRecord, getRecordsForDay } from '../core/record/index.js';
import { getEventsForDay, readEvent } from '../core/event/index.js';

function personName(person = {}) {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
}

function recordOption(record = {}) {
  const time = String(record?.from || '');
  return {
    value: `record:${String(record?.id || '')}`,
    label: 'Запись',
    meta: [time, personName(record?.person)].filter(Boolean).join(' · '),
  };
}

function eventOption(event = {}) {
  const time = String(event?.from || '');
  return {
    value: `event:${String(event?.id || '')}`,
    label: 'Событие',
    meta: [time, String(event?.title || 'Событие')].filter(Boolean).join(' · '),
    indicatorColor: String(event?.color || ''),
  };
}

export function noteTargetOptions(date) {
  return [
    { value: '', label: 'Не прикреплено' },
    ...getRecordsForDay(date, '').filter((record) => record?.status !== 'cancelled').map(recordOption),
    ...getEventsForDay(date, '').map(eventOption),
  ];
}

export function parseNoteTargetValue(value = '') {
  const match = String(value || '').match(/^(record|event):(.+)$/);
  return match
    ? { targetType: match[1], targetId: match[2] }
    : { targetType: '', targetId: '' };
}

export function noteTargetValue(note = {}) {
  const type = note?.targetType === 'record' || note?.targetType === 'event'
    ? String(note.targetType)
    : '';
  const id = String(note?.targetId || '');
  return type && id ? `${type}:${id}` : '';
}

export function resolveNoteTarget(note = {}) {
  const id = String(note?.targetId || '');
  if (!id) return null;
  if (note?.targetType === 'record') {
    const record = getRecord(id);
    return record ? { type: 'record', entity: record } : null;
  }
  if (note?.targetType === 'event') {
    const event = readEvent(id);
    return event ? { type: 'event', entity: event } : null;
  }
  return null;
}

export function noteTargetLabel(note = {}) {
  const target = resolveNoteTarget(note);
  if (!target) return '';
  if (target.type === 'record') {
    return `Запись · ${String(target.entity?.from || '')} · ${personName(target.entity?.person)}`;
  }
  return `Событие · ${String(target.entity?.from || '')} · ${String(target.entity?.title || 'Событие')}`;
}

export function noteVisibleForWorkplace(note = {}, workplaceId = '', {
  allMode = false,
  resolveTarget = resolveNoteTarget,
} = {}) {
  if (allMode) return true;
  const target = resolveTarget(note);
  if (!target) return true;
  return String(target.entity?.workplaceId || '') === String(workplaceId || '');
}
