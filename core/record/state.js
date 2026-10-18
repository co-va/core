import { RECORD_EVENT_TYPES } from './events.js';

function orderedEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.type)
    .slice()
    .sort((left, right) => Date.parse(left?.at || '') - Date.parse(right?.at || ''));
}

export function projectRecordLifecycle(record = {}, events = []) {
  let status = 'active';
  let confirmed = false;
  let attendance = '';
  let completed = false;
  let confirmedAt = '';
  let attendanceAt = '';
  let completedAt = '';
  let cancelledAt = '';
  let lifecycleUpdatedAt = record?.createdAt || record?.updatedAt || '';

  for (const event of orderedEvents(events)) {
    const at = String(event?.at || '');
    if (event.type === RECORD_EVENT_TYPES.CONFIRMED) {
      confirmed = true;
      confirmedAt = at;
    } else if (event.type === RECORD_EVENT_TYPES.UNCONFIRMED) {
      confirmed = false;
      confirmedAt = at;
    } else if (event.type === RECORD_EVENT_TYPES.ARRIVED) {
      attendance = 'arrived';
      attendanceAt = at;
    } else if (event.type === RECORD_EVENT_TYPES.NO_SHOW) {
      attendance = 'no-show';
      attendanceAt = at;
    } else if (event.type === RECORD_EVENT_TYPES.ATTENDANCE_CLEARED) {
      attendance = '';
      attendanceAt = at;
    } else if (event.type === RECORD_EVENT_TYPES.COMPLETED) {
      completed = true;
      completedAt = at;
      if (!attendance) {
        attendance = 'arrived';
        attendanceAt = at;
      }
    } else if (event.type === RECORD_EVENT_TYPES.CANCELLED) {
      status = 'cancelled';
      cancelledAt = at;
    }
    if (at) lifecycleUpdatedAt = at;
  }

  return {
    ...record,
    status,
    confirmed,
    attendance,
    completed,
    confirmedAt,
    attendanceAt,
    completedAt,
    cancelledAt,
    lifecycleUpdatedAt,
  };
}

export function recordActionState(record = {}, events = []) {
  let state = 'booked';
  for (const event of orderedEvents(events)) {
    if (event.type === RECORD_EVENT_TYPES.CANCELLED) return 'cancelled';
    if (event.type === RECORD_EVENT_TYPES.CREATED) state = 'booked';
    else if (event.type === RECORD_EVENT_TYPES.RESCHEDULED) state = 'rescheduled';
  }
  return state;
}

export function recordVisitState(record = {}, events = []) {
  if (recordActionState(record, events) === 'cancelled') return '';
  const lifecycle = projectRecordLifecycle(record, events);
  if (lifecycle.attendance === 'arrived') return 'arrived';
  if (lifecycle.attendance === 'no-show') return 'no-show';
  return 'expected';
}

export function recordPaymentStatus(record = {}, events = [], payment = {}) {
  const visit = recordVisitState(record, events);
  if (!visit || visit === 'no-show') return '';
  const dueValue = payment?.due ?? payment?.remaining ?? 0;
  const due = Math.max(0, Number(dueValue) || 0);
  if (due <= 0.009) return 'paid';
  return visit === 'arrived' ? 'debt' : 'due';
}

export function projectRecordStatuses(record = {}, events = [], payment = {}) {
  return {
    action: recordActionState(record, events),
    visit: recordVisitState(record, events),
    payment: recordPaymentStatus(record, events, payment),
  };
}

export function recordAppointmentTime(record, field = 'from') {
  const date = String(record?.date || '').slice(0, 10);
  const time = String(record?.[field] || '');
  const value = Date.parse(`${date}T${time}:00`);
  return Number.isFinite(value) ? value : 0;
}

export function recordVisualState(record, { paid = false } = {}) {
  if (record?.status === 'cancelled') return 'cancelled';
  if (paid) return 'paid';
  if (record?.attendance === 'no-show') return 'no-show';
  return 'active';
}

export function isRecordCompletedSide(record, { paid = false, now = Date.now() } = {}) {
  return record?.status === 'cancelled'
    || record?.attendance === 'no-show'
    || record?.completed === true
    || paid
    || recordAppointmentTime(record, 'to') <= now;
}

export function recordActivityTime(record, payment = null, { completed = false } = {}) {
  if (record?.status === 'cancelled') {
    const cancelledAt = Date.parse(String(record?.cancelledAt || record?.lifecycleUpdatedAt || record?.updatedAt || ''));
    if (Number.isFinite(cancelledAt)) return cancelledAt;
  }
  if (payment) {
    const paidAt = Date.parse(String(payment?.paidAt || payment?.createdAt || ''));
    if (Number.isFinite(paidAt)) return paidAt;
  }
  if (record?.attendance === 'no-show') {
    const attendanceAt = Date.parse(String(record?.attendanceAt || record?.lifecycleUpdatedAt || record?.updatedAt || record?.createdAt || ''));
    if (Number.isFinite(attendanceAt)) return attendanceAt;
  }
  if (record?.completed) {
    const completedAt = Date.parse(String(record?.completedAt || record?.lifecycleUpdatedAt || ''));
    if (Number.isFinite(completedAt)) return completedAt;
  }
  if (completed) return recordAppointmentTime(record, 'to') || recordAppointmentTime(record, 'from');
  const updatedAt = Date.parse(String(record?.lifecycleUpdatedAt || record?.updatedAt || record?.createdAt || ''));
  if (Number.isFinite(updatedAt)) return updatedAt;
  return recordAppointmentTime(record, 'from') || recordAppointmentTime(record, 'to');
}
