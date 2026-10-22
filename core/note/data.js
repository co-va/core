import { queueNoteDelete, queueNoteUpsert } from '../business-persistence.js';

export const NOTE_DEFAULT_COLOR = '#CFC3FF';

let rows = [];

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function normalize(value = {}) {
  const now = new Date().toISOString();
  const targetType = value?.targetType === 'record' || value?.targetType === 'event'
    ? String(value.targetType)
    : '';
  const targetId = targetType ? String(value?.targetId || '') : '';
  return {
    id: String(value?.id || ''),
    ownerType: String(value?.ownerType || 'profile'),
    ownerId: String(value?.ownerId || ''),
    tenantId: String(value?.tenantId || ''),
    context: value?.context && typeof value.context === 'object' && !Array.isArray(value.context) ? clone(value.context) : {},
    date: String(value?.date || '').slice(0, 10),
    from: String(value?.from || '').slice(0, 5),
    to: String(value?.to || '').slice(0, 5),
    targetType,
    targetId,
    title: String(value?.title || ''),
    text: String(value?.text || ''),
    color: /^#[0-9A-Fa-f]{6}$/.test(String(value?.color || '')) ? String(value.color).toUpperCase() : NOTE_DEFAULT_COLOR,
    createdAt: String(value?.createdAt || now),
    updatedAt: String(value?.updatedAt || value?.createdAt || now),
  };
}

export function hydrateNotesFromServer(value = []) {
  rows = (Array.isArray(value) ? value : []).map(normalize).filter((item) => item.id);
  return getNotes();
}

export function getNotes() {
  return rows.map(clone);
}

export function getNote(id) {
  const row = rows.find((item) => item.id === String(id || ''));
  return row ? clone(row) : null;
}

export function insertNote(value = {}) {
  const note = normalize(value);
  if (!note.id) throw new Error('Note id is required');
  if (rows.some((item) => item.id === note.id)) return getNote(note.id);
  rows.push(note);
  void queueNoteUpsert(note);
  return clone(note);
}

export function patchNote(id, patch = {}) {
  const key = String(id || '');
  const index = rows.findIndex((item) => item.id === key);
  if (index < 0) return null;
  const current = rows[index];
  const next = normalize({
    ...current,
    ...clone(patch),
    id: current.id,
    ownerType: current.ownerType,
    ownerId: current.ownerId,
    tenantId: current.tenantId,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  rows[index] = next;
  void queueNoteUpsert(next);
  return clone(next);
}

export function deleteNoteRow(id) {
  const key = String(id || '');
  const before = rows.length;
  rows = rows.filter((item) => item.id !== key);
  if (rows.length !== before) void queueNoteDelete(key);
  return rows.length !== before;
}
