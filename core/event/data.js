import { queueEventDelete, queueEventUpsert } from '../business-persistence.js';

let rows = [];
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function normalize(value = {}) {
  const now = new Date().toISOString();
  return {
    id: String(value?.id || ''), tenantId: String(value?.tenantId || ''),
    ownerType: String(value?.ownerType || 'tenant'), ownerId: String(value?.ownerId || ''),
    context: value?.context && typeof value.context === 'object' && !Array.isArray(value.context) ? clone(value.context) : {},
    date: String(value?.date || '').slice(0, 10), from: String(value?.from || ''), to: String(value?.to || ''),
    title: String(value?.title || ''), description: String(value?.description || ''), color: String(value?.color || '#777A7D'),
    workplaceId: String(value?.workplaceId || ''), createdAt: String(value?.createdAt || now), updatedAt: String(value?.updatedAt || value?.createdAt || now),
  };
}

export function hydrateEventsFromServer(value = []) { rows = (Array.isArray(value) ? value : []).map(normalize).filter((item) => item.id); return getEvents(); }
export function getEvents() { return rows.map(clone); }
export function getEvent(id) { const row = rows.find((item) => item.id === String(id || '')); return row ? clone(row) : null; }
export function insertEvent(value = {}) { const event = normalize(value); if (!event.id) throw new Error('Event id is required'); if (rows.some((item) => item.id === event.id)) return getEvent(event.id); rows.push(event); void queueEventUpsert(event); return clone(event); }
export function patchEvent(id, patch = {}) { const index = rows.findIndex((item) => item.id === String(id || '')); if (index < 0) return null; const current = rows[index]; const next = normalize({ ...current, ...clone(patch), id: current.id, createdAt: current.createdAt, updatedAt: new Date().toISOString() }); rows[index] = next; void queueEventUpsert(next); return clone(next); }
export function deleteEventRow(id) { const key = String(id || ''); const before = rows.length; rows = rows.filter((item) => item.id !== key); if (rows.length !== before) void queueEventDelete(key); return rows.length !== before; }
