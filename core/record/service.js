import { checkTimeAvailability } from '../time/index.js';
import { deleteRecordRow, hydrateRecordStateFromServer, insertRecordRow, patchRecordRow } from './data.js';
import { appendRecordEvent, deleteRecordEvents, RECORD_EVENT_TYPES } from './events.js';
import { getRecord } from './read.js';
import { apiRequest } from '../auth.js';

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallback);
  return payload;
}

export async function refreshRecordsFromServer() {
  const response = await apiRequest('/business-state');
  const payload = await responseJson(response, 'Не удалось обновить записи');
  hydrateRecordStateFromServer({
    records: payload.records || [],
    recordEvents: payload.recordEvents || [],
  });
  notify('book:records-changed', { action: 'server-refresh' });
  notify('book:time-usage-changed', { action: 'server-refresh' });
  return payload.records || [];
}

function notify(name, detail = {}) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeId(value) {
  return String(value || '');
}

function normalizeGroup(group = null, fallbackPerson = null) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return null;
  const capacity = Math.max(2, Math.min(999, Math.floor(Number(group.capacity) || 0)));
  if (!Number.isFinite(capacity) || capacity < 2) return null;
  const source = Array.isArray(group.participants) ? group.participants : [];
  const seen = new Set();
  const participants = [];
  for (const value of source) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const key = String(value.key || value.id || '').trim();
    if (!key || seen.has(key) || participants.length >= capacity) continue;
    seen.add(key);
    participants.push({
      key: String(value.key || ''),
      id: String(value.id || ''),
      name: String(value.name || ''),
      surname: String(value.surname || ''),
      phone: String(value.phone || value.phones?.[0] || ''),
      discountPercent: Math.max(0, Math.min(100, Number(value.discountPercent) || 0)),
    });
  }
  if (!participants.length && fallbackPerson && typeof fallbackPerson === 'object') {
    const key = String(fallbackPerson.key || fallbackPerson.id || '').trim();
    if (key) participants.push({
      key: String(fallbackPerson.key || ''),
      id: String(fallbackPerson.id || ''),
      name: String(fallbackPerson.name || ''),
      surname: String(fallbackPerson.surname || ''),
      phone: String(fallbackPerson.phone || fallbackPerson.phones?.[0] || ''),
      discountPercent: Math.max(0, Math.min(100, Number(fallbackPerson.discountPercent) || 0)),
    });
  }
  return { capacity, participants };
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function dataPatchFrom(patch = {}) {
  const lifecycleKeys = new Set([
    'finance',
    'payment',
    'status',
    'confirmed',
    'attendance',
    'completed',
    'confirmedAt',
    'attendanceAt',
    'completedAt',
    'cancelledAt',
    'lifecycleUpdatedAt',
  ]);
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !lifecycleKeys.has(key)));
}

function scheduleSnapshot(record = {}) {
  return {
    date: normalizeDate(record?.date),
    workplaceId: normalizeId(record?.workplaceId),
    from: String(record?.from || ''),
    to: String(record?.to || ''),
  };
}

function scheduleChanged(before = {}, after = {}) {
  const left = scheduleSnapshot(before);
  const right = scheduleSnapshot(after);
  return ['date', 'workplaceId', 'from', 'to'].some((key) => left[key] !== right[key]);
}

function recordSubject(record = {}) {
  const person = record?.person && typeof record.person === 'object' ? record.person : {};
  return {
    personId: String(person?.id || ''),
    personKey: String(person?.key || ''),
    name: String(person?.name || ''),
    surname: String(person?.surname || ''),
  };
}

function eventContext(record = {}, actionContext = null) {
  const context = actionContext && typeof actionContext === 'object' ? actionContext : {};
  const actor = context.actor && typeof context.actor === 'object' ? context.actor : {};
  return {
    source: String(context.source || record?.source || ''),
    actor: {
      type: String(actor.type || ''),
      profileId: String(actor.profileId || ''),
      accountId: String(actor.accountId || ''),
    },
    subject: recordSubject(record),
  };
}

function appendLifecyclePatch(before, after, patch = {}, actionContext = null) {
  if (!before?.id) return;
  const context = eventContext(after || before, actionContext);
  if (hasOwn(patch, 'confirmed') && Boolean(patch.confirmed) !== Boolean(before.confirmed)) {
    appendRecordEvent(before.id, patch.confirmed ? RECORD_EVENT_TYPES.CONFIRMED : RECORD_EVENT_TYPES.UNCONFIRMED, context);
  }

  if (hasOwn(patch, 'attendance')) {
    const next = patch.attendance === 'arrived' || patch.attendance === 'no-show' ? patch.attendance : '';
    if (next && next !== before.attendance) {
      appendRecordEvent(before.id, next === 'arrived' ? RECORD_EVENT_TYPES.ARRIVED : RECORD_EVENT_TYPES.NO_SHOW, context);
    } else if (!next && before.attendance) {
      appendRecordEvent(before.id, RECORD_EVENT_TYPES.ATTENDANCE_CLEARED, context);
    }
  }
}

export function checkRecordTime({ date, workplaceId, from, to, excludeId = '' } = {}) {
  const result = checkTimeAvailability({ date, workplaceId, from, to, excludeId });
  return { ok: result.ok, reason: result.reason, conflicts: result.conflicts || [] };
}

export function createRecord({
  date,
  workplaceId,
  from,
  to,
  person,
  procedures = [],
  products = [],
  source = 'manual',
  sourceRequestId = '',
  actionContext = null,
  group = null,
} = {}) {
  const normalizedDate = normalizeDate(date);
  const normalizedWorkplaceId = normalizeId(workplaceId);
  if (!checkRecordTime({ date: normalizedDate, workplaceId: normalizedWorkplaceId, from, to }).ok) return null;

  const now = new Date().toISOString();
  const sourceRecord = {
    procedures: Array.isArray(procedures) ? procedures : [],
    products: Array.isArray(products) ? products : [],
  };
  const row = {
    id: crypto.randomUUID(),
    date: normalizedDate,
    workplaceId: normalizedWorkplaceId,
    from: String(from || ''),
    to: String(to || ''),
    person: person || null,
    group: normalizeGroup(group, person),
    procedures: sourceRecord.procedures,
    products: sourceRecord.products,
    source: String(source || 'manual'),
    sourceRequestId: String(sourceRequestId || ''),
    createdBy: actionContext?.actor && typeof actionContext.actor === 'object' ? { ...actionContext.actor } : {},
    createdAt: now,
    updatedAt: now,
  };

  const stored = insertRecordRow(row);
  if (!stored) return null;
  appendRecordEvent(stored.id, RECORD_EVENT_TYPES.CREATED, {
    at: now,
    ...eventContext(stored, actionContext),
    payload: { appointment: scheduleSnapshot(stored) },
  });
  const record = getRecord(stored.id);
  notify('book:records-changed', { action: 'create', recordId: stored.id });
  notify('book:time-usage-changed', {
    action: 'occupy',
    usageId: stored.id,
    sourceId: stored.id,
    date: stored.date,
    workplaceId: stored.workplaceId,
    from: stored.from,
    to: stored.to,
  });
  return record;
}

export function updateRecord(id, patch = {}, { actionContext = null } = {}) {
  const current = getRecord(id);
  if (!current || current.status === 'cancelled') return null;

  const nextDataPatch = dataPatchFrom(patch);
  if (hasOwn(nextDataPatch, 'date')) nextDataPatch.date = normalizeDate(nextDataPatch.date);
  if (hasOwn(nextDataPatch, 'workplaceId')) nextDataPatch.workplaceId = normalizeId(nextDataPatch.workplaceId);
  if (hasOwn(nextDataPatch, 'from')) nextDataPatch.from = String(nextDataPatch.from || '');
  if (hasOwn(nextDataPatch, 'to')) nextDataPatch.to = String(nextDataPatch.to || '');
  if (hasOwn(nextDataPatch, 'procedures')) nextDataPatch.procedures = Array.isArray(nextDataPatch.procedures) ? nextDataPatch.procedures : [];
  if (hasOwn(nextDataPatch, 'products')) nextDataPatch.products = Array.isArray(nextDataPatch.products) ? nextDataPatch.products : [];
  if (hasOwn(nextDataPatch, 'group')) nextDataPatch.group = normalizeGroup(nextDataPatch.group, nextDataPatch.person ?? current.person);

  const next = { ...current, ...nextDataPatch };
  if (next.group?.participants?.length) next.person = next.group.participants[0];
  if (!checkRecordTime({
    date: next.date,
    workplaceId: next.workplaceId,
    from: next.from,
    to: next.to,
    excludeId: id,
  }).ok) return null;

  if (Object.keys(nextDataPatch).length) {
    nextDataPatch.updatedAt = new Date().toISOString();
    if (!patchRecordRow(id, nextDataPatch)) return null;
  }

  const updatedData = getRecord(id);
  if (scheduleChanged(current, updatedData)) {
    appendRecordEvent(id, RECORD_EVENT_TYPES.RESCHEDULED, {
      ...eventContext(updatedData, actionContext),
      payload: {
        before: scheduleSnapshot(current),
        after: scheduleSnapshot(updatedData),
      },
    });
  }
  appendLifecyclePatch(current, updatedData, patch, actionContext);
  const updated = getRecord(id);
  notify('book:records-changed', { action: 'update', recordId: id });
  if (scheduleChanged(current, updated)) {
    notify('book:time-usage-changed', {
      action: 'change', usageId: id, sourceId: id,
      date: updated?.date, workplaceId: updated?.workplaceId,
      from: updated?.from, to: updated?.to,
    });
  }
  return updated;
}

export function setRecordConfirmed(id, confirmed, options = {}) {
  return updateRecord(id, { confirmed: Boolean(confirmed) }, options);
}

export function setRecordAttendance(id, attendance, options = {}) {
  const value = attendance === 'arrived' || attendance === 'no-show' ? attendance : '';
  return updateRecord(id, { attendance: value }, options);
}

export function completeRecord(id, { actionContext = null } = {}) {
  const current = getRecord(id);
  if (!current || current.status === 'cancelled' || current.attendance === 'no-show') return null;
  if (current.completed) return current;
  appendRecordEvent(id, RECORD_EVENT_TYPES.COMPLETED, {
    ...eventContext(current, actionContext),
    payload: { appointment: scheduleSnapshot(current) },
  });
  const completed = getRecord(id);
  notify('book:records-changed', { action: 'complete', recordId: id });
  return completed;
}

export function cancelRecord(id, { actionContext = null } = {}) {
  const current = getRecord(id);
  if (!current || current.status === 'cancelled') return null;
  appendRecordEvent(id, RECORD_EVENT_TYPES.CANCELLED, {
    ...eventContext(current, actionContext),
    payload: { appointment: scheduleSnapshot(current) },
  });
  const cancelled = getRecord(id);
  notify('book:records-changed', { action: 'cancel', recordId: id });
  notify('book:time-usage-changed', {
    action: 'release', usageId: id, sourceId: id,
    date: current.date, workplaceId: current.workplaceId,
    from: current.from, to: current.to,
  });
  return cancelled;
}

export function deleteRecord(id) {
  const current = getRecord(id);
  if (!current) return false;
  if (!deleteRecordRow(id)) return false;
  deleteRecordEvents(id);
  notify('book:records-changed', { action: 'delete', recordId: id });
  if (current.status !== 'cancelled') {
    notify('book:time-usage-changed', {
      action: 'release', usageId: id, sourceId: id,
      date: current.date, workplaceId: current.workplaceId,
      from: current.from, to: current.to,
    });
  }
  return true;
}

export function moveRecord(id, { date, workplaceId, from, to } = {}, options = {}) {
  return updateRecord(id, {
    date: normalizeDate(date),
    workplaceId: normalizeId(workplaceId),
    from: String(from || ''),
    to: String(to || ''),
  }, options);
}

export function removeRecord(id, options = {}) {
  return Boolean(cancelRecord(id, options));
}
