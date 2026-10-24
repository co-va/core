import { getEvent, getEvents } from './data.js';
export function readEvent(id) { return getEvent(id); }
export function readEvents() { return getEvents(); }
export function getEventsForDay(date, workplaceId = '') { const day = String(date || '').slice(0, 10); const workplace = String(workplaceId || ''); return getEvents().filter((item) => item.date === day && (!workplace || item.workplaceId === workplace)); }
