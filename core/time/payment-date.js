// Payment classification uses the workplace calendar, never the device date or appointment clock.
import { zonedDateTimeParts } from './zone.js';
export function recordPaymentCalendarPhase(visitDate, at = new Date(), timeZone = '') {
  const day=String(visitDate||'').slice(0,10);
  const moment=at instanceof Date?at:new Date(at);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(moment.getTime()))return '';
  const current=zonedDateTimeParts(moment,timeZone).date;
  return day>current?'before':day<current?'after':'on';
}
