import {
  buildNaturalBookingTimeRows,
  createTimeGrid,
  listTimeGridAvailableStarts,
  timeToMinutes,
  minutesToTime,
  zonedDateTimeParts,
} from '../core/time/index.js';

function key(value) {
  return String(value || '');
}

export function getBookingWorkplace(context = {}, workplaceKey = '') {
  const target = key(workplaceKey);
  return (Array.isArray(context.workplaces) ? context.workplaces : [])
    .find((item) => key(item?.key) === target) || null;
}

export function procedureWorkplaceAssignment(procedure = {}, workplaceKey = '') {
  const target = key(workplaceKey);
  return (Array.isArray(procedure.workplaces) ? procedure.workplaces : [])
    .find((item) => key(item?.workplaceId ?? item?.key ?? item?.id) === target) || null;
}

export function getBookingProcedures(context = {}, workplaceKey = '') {
  return (Array.isArray(context.procedures) ? context.procedures : [])
    .filter((procedure) => procedureWorkplaceAssignment(procedure, workplaceKey));
}

export function bookingProcedurePrice(procedure = {}, workplaceKey = '') {
  const price = procedureWorkplaceAssignment(procedure, workplaceKey)?.bookingPrice;
  return {
    minimum: Math.max(0, Number(price?.minimum || 0)),
    variable: Boolean(price?.variable),
    free: Boolean(price?.free),
  };
}

export function bookingProcedureCost(procedure = {}, workplaceKey = '') {
  const price = bookingProcedurePrice(procedure, workplaceKey);
  return price.free ? '' : price.minimum;
}

export function bookingSelection(context = {}, workplaceKey = '', ids = []) {
  const selected = new Set((Array.isArray(ids) ? ids : []).map(key));
  return getBookingProcedures(context, workplaceKey).filter((procedure) => selected.has(key(procedure.id)));
}

export function bookingDuration(context = {}, workplaceKey = '', ids = []) {
  return bookingSelection(context, workplaceKey, ids)
    .reduce((sum, procedure) => sum + Math.max(0, Number(procedure.duration || 0)), 0);
}

export function getBookingWorkingDates(context = {}, workplaceKey = '', { fromDate = '', now = new Date() } = {}) {
  const target = key(workplaceKey);
  const workplace = getBookingWorkplace(context, target);
  const clock = zonedDateTimeParts(now, workplace?.timeZone);
  const minimum = String(fromDate || clock.date).slice(0, 10);
  return [...new Set((Array.isArray(context.days) ? context.days : [])
    .filter((day) => key(day?.workplaceId) === target)
    .map((day) => String(day?.date || '').slice(0, 10))
    .filter((date) => date && (!minimum || date >= minimum))
    .filter((date) => Boolean(getBookingDayPlan(context, target, date))))]
    .sort();
}

export function getBookingDayPlan(context = {}, workplaceKey = '', date = '') {
  const target = key(workplaceKey);
  const dayKey = String(date || '').slice(0, 10);
  const day = (Array.isArray(context.days) ? context.days : [])
    .find((item) => key(item?.workplaceId) === target && String(item?.date || '').slice(0, 10) === dayKey);
  if (!day) return null;
  const workplace = getBookingWorkplace(context, workplaceKey);
  const from = String(day.from || workplace?.from || '');
  const to = String(day.to || workplace?.to || '');
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start ? { from, to } : null;
}

export function getBookingOccupancy(context = {}, workplaceKey = '', date = '') {
  const target = key(workplaceKey);
  const dayKey = String(date || '').slice(0, 10);
  return (Array.isArray(context.occupancy) ? context.occupancy : [])
    .filter((item) => key(item?.workplaceId) === target && String(item?.date || '').slice(0, 10) === dayKey)
    .map((item) => ({
      sourceId: key(item?.id),
      type: String(item?.type || 'usage'),
      rigidity: 'hard',
      from: String(item?.from || ''),
      to: String(item?.to || ''),
    }));
}

function bookingTimeContext(context = {}, {
  workplaceKey = '',
  date = '',
  procedureIds = [],
  duration = 0,
  step = 0,
  notBefore = '',
  now = new Date(),
} = {}) {
  const requestedDuration = Number(duration);
  const resolvedDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? requestedDuration
    : bookingDuration(context, workplaceKey, procedureIds);
  const plan = getBookingDayPlan(context, workplaceKey, date);
  const workplace = getBookingWorkplace(context, workplaceKey);
  if (!plan || resolvedDuration <= 0 || !workplace) return null;

  const clock = zonedDateTimeParts(now, workplace.timeZone);
  const dayKey = String(date || '').slice(0, 10);
  if (dayKey < clock.date) return null;

  let minimum = String(notBefore || '');
  if (!minimum && dayKey === clock.date) {
    const minute = clock.minuteOfDay + (clock.second > 0 ? 1 : 0);
    if (minute >= 24 * 60) return null;
    minimum = minutesToTime(minute) || '';
  }

  const occupancy = getBookingOccupancy(context, workplaceKey, date);
  const grid = createTimeGrid({
    date,
    workplaceId: workplaceKey,
    plan,
    usages: occupancy,
  });
  const numericStep = Number(step);
  return {
    duration: resolvedDuration,
    plan,
    minimum,
    occupancy,
    step: Number.isFinite(numericStep) && numericStep > 0 ? numericStep : 0,
    grid,
  };
}

export function getBookingSlots(context = {}, options = {}) {
  const setup = bookingTimeContext(context, options);
  if (!setup) return [];
  if (setup.step === 0) {
    return buildNaturalBookingTimeRows(setup.grid, setup.duration, { notBefore: setup.minimum })
      .filter((row) => row.available)
      .map((row) => ({ from: row.from, to: row.to }));
  }
  return listTimeGridAvailableStarts(setup.grid, {
    duration: setup.duration,
    step: setup.step,
    from: setup.minimum,
  }).map((from) => ({
    from,
    to: minutesToTime((timeToMinutes(from) ?? 0) + setup.duration),
  }));
}

export function getBookingTimeRows(context = {}, options = {}) {
  const setup = bookingTimeContext(context, options);
  if (!setup) return [];
  if (setup.step === 0) {
    return buildNaturalBookingTimeRows(setup.grid, setup.duration, { notBefore: setup.minimum });
  }

  const free = new Set(listTimeGridAvailableStarts(setup.grid, {
    duration: setup.duration,
    step: setup.step,
    from: setup.minimum,
  }));
  const start = timeToMinutes(setup.plan.from);
  const end = timeToMinutes(setup.plan.to);
  const minimum = timeToMinutes(setup.minimum);
  if (start == null || end == null || end <= start) return [];

  const rows = [];
  for (let minute = start; minute < end; minute += setup.step) {
    if (minimum != null && minute < minimum) continue;
    const from = minutesToTime(minute);
    const to = minutesToTime(minute + setup.duration);
    if (!from) continue;
    const overlaps = setup.occupancy.some((usage) => {
      const usageFrom = timeToMinutes(usage.from);
      const usageTo = timeToMinutes(usage.to);
      if (usageFrom == null || usageTo == null) return false;
      return minute < usageTo && minute + setup.duration > usageFrom;
    });
    const available = free.has(from);
    rows.push({
      from,
      to: to || '',
      value: from,
      label: from,
      available,
      occupied: overlaps,
      disabled: !available,
      state: available ? 'free' : overlaps ? 'occupied' : 'unavailable',
      emphasized: minute % 30 === 0,
    });
  }
  return rows;
}

export function requiredBookingDocuments(context = {}) {
  return (Array.isArray(context.documents) ? context.documents : []).filter((document) => Boolean(document?.personConsent));
}