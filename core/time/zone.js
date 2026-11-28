const DEFAULT_WORKPLACE_TIME_ZONE = 'Europe/Moscow';

function validTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return DEFAULT_WORKPLACE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_WORKPLACE_TIME_ZONE;
  }
}

export function normalizeWorkplaceTimeZone(value) {
  return validTimeZone(value);
}

export function zonedDateTimeParts(value = new Date(), timeZone = DEFAULT_WORKPLACE_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    hour,
    minute,
    second,
    minuteOfDay: hour * 60 + minute,
  };
}


function parseLocalDateTime(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
  };
}

function partsUtcValue(parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
}

export function zonedDateTimeToDate(value, timeZone = DEFAULT_WORKPLACE_TIME_ZONE) {
  const desired = parseLocalDateTime(value);
  if (!desired) return null;
  const zone = validTimeZone(timeZone);
  const desiredUtc = partsUtcValue(desired);
  let candidate = new Date(desiredUtc);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = zonedDateTimeParts(candidate, zone);
    const actualUtc = Date.UTC(
      Number(actual.date.slice(0, 4)),
      Number(actual.date.slice(5, 7)) - 1,
      Number(actual.date.slice(8, 10)),
      actual.hour,
      actual.minute,
      actual.second,
    );
    const delta = actualUtc - desiredUtc;
    if (Math.abs(delta) < 1000) return candidate;
    candidate = new Date(candidate.getTime() - delta);
  }
  return candidate;
}

// Payment classification uses the workplace calendar, never the device date or appointment clock.
export function recordPaymentCalendarPhase(visitDate, at = new Date(), timeZone = '') {
  const day=String(visitDate||'').slice(0,10);
  const moment=at instanceof Date?at:new Date(at);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(moment.getTime()))return '';
  const current=zonedDateTimeParts(moment,timeZone).date;
  return day>current?'before':day<current?'after':'on';
}
