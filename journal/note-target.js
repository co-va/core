import { getRecord, getRecordsForDay } from '../core/record/index.js';
import { getEventsForDay, readEvent } from '../core/event/index.js';

function personName(person = {}) {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
}

function recordOption(record = {}, label = 'Запись') {
  const time = String(record?.from || '');
  return {
    value: `record:${String(record?.id || '')}`,
    label,
    meta: [time, personName(record?.person)].filter(Boolean).join(' · '),
  };
}

function eventOption(event = {}, label = 'Событие') {
  const time = String(event?.from || '');
  return {
    value: `event:${String(event?.id || '')}`,
    label,
    meta: [time, String(event?.title || 'Событие')].filter(Boolean).join(' · '),
    indicatorColor: String(event?.color || ''),
  };
}

function snapshotPerson(person = {}) {
  return {
    id: String(person?.id || ''),
    key: String(person?.key || ''),
    uei: String(person?.uei || ''),
    name: String(person?.name || ''),
    surname: String(person?.surname || ''),
  };
}

function targetSnapshot(target = null) {
  if (!target?.entity || (target.type !== 'record' && target.type !== 'event')) return null;
  const entity = target.entity;
  if (target.type === 'record') {
    return {
      type: 'record',
      id: String(entity?.id || ''),
      date: String(entity?.date || '').slice(0, 10),
      from: String(entity?.from || '').slice(0, 5),
      to: String(entity?.to || '').slice(0, 5),
      workplaceId: String(entity?.workplaceId || ''),
      status: String(entity?.status || ''),
      person: snapshotPerson(entity?.person || {}),
    };
  }
  return {
    type: 'event',
    id: String(entity?.id || ''),
    date: String(entity?.date || '').slice(0, 10),
    from: String(entity?.from || '').slice(0, 5),
    to: String(entity?.to || '').slice(0, 5),
    workplaceId: String(entity?.workplaceId || ''),
    title: String(entity?.title || 'Событие'),
    color: String(entity?.color || ''),
  };
}

function storedTargetSnapshot(note = {}) {
  const snapshot = note?.context?.targetSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const type = snapshot.type === 'record' || snapshot.type === 'event' ? String(snapshot.type) : '';
  const id = String(snapshot.id || '');
  if (!type || !id || type !== note?.targetType || id !== String(note?.targetId || '')) return null;
  return { ...snapshot, type, id };
}

function liveTarget(type = '', id = '') {
  if (!id) return null;
  if (type === 'record') {
    const record = getRecord(id);
    return record ? { type: 'record', entity: record, historical: false, deleted: false } : null;
  }
  if (type === 'event') {
    const event = readEvent(id);
    return event ? { type: 'event', entity: event, historical: false, deleted: false } : null;
  }
  return null;
}

export function noteTargetSnapshot(targetType = '', targetId = '') {
  return targetSnapshot(liveTarget(targetType, targetId));
}

export function noteContextWithTarget(context = {}, targetType = '', targetId = '') {
  const next = context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {};
  const type = targetType === 'record' || targetType === 'event' ? String(targetType) : '';
  const id = type ? String(targetId || '') : '';
  if (!type || !id) {
    delete next.targetSnapshot;
    return next;
  }

  const snapshot = noteTargetSnapshot(type, id);
  if (snapshot) {
    next.targetSnapshot = snapshot;
    return next;
  }

  const existing = next.targetSnapshot;
  if (!existing || existing.type !== type || String(existing.id || '') !== id) {
    delete next.targetSnapshot;
  }
  return next;
}

export function noteTargetOptions(date, { includeNote = null } = {}) {
  const options = [
    { value: '', label: 'Не прикреплено' },
    ...getRecordsForDay(date, '').filter((record) => record?.status !== 'cancelled').map((record) => recordOption(record)),
    ...getEventsForDay(date, '').map((event) => eventOption(event)),
  ];

  const currentValue = noteTargetValue(includeNote || {});
  if (!currentValue || options.some((option) => String(option.value || '') === currentValue)) return options;
  const target = resolveNoteTarget(includeNote || {});
  if (!target) return options;
  if (target.type === 'record') {
    const label = target.deleted
      ? 'Запись удалена'
      : target.entity?.status === 'cancelled'
        ? 'Запись отменена'
        : 'Запись';
    options.push(recordOption(target.entity, label));
  } else {
    options.push(eventOption(target.entity, target.deleted ? 'Событие удалено' : 'Событие'));
  }
  return options;
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
  const type = note?.targetType === 'record' || note?.targetType === 'event'
    ? String(note.targetType)
    : '';
  const id = String(note?.targetId || '');
  if (!type || !id) return null;

  const live = liveTarget(type, id);
  if (live) return live;

  const snapshot = storedTargetSnapshot(note);
  return snapshot
    ? { type, entity: snapshot, historical: true, deleted: true }
    : null;
}

export function noteTargetLabel(note = {}) {
  const target = resolveNoteTarget(note);
  if (!target) return '';
  if (target.type === 'record') {
    const status = target.deleted
      ? 'Запись удалена'
      : target.entity?.status === 'cancelled'
        ? 'Запись отменена'
        : 'Запись';
    return `${status} · ${String(target.entity?.from || '')} · ${personName(target.entity?.person)}`;
  }
  const status = target.deleted ? 'Событие удалено' : 'Событие';
  return `${status} · ${String(target.entity?.from || '')} · ${String(target.entity?.title || 'Событие')}`;
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
