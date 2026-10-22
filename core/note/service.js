import { apiRequest } from '../auth.js';
import { deleteNoteRow, getNotes, hydrateNotesFromServer, insertNote, NOTE_DEFAULT_COLOR, patchNote } from './data.js';
import { getNote } from './data.js';

function noteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizedTarget(type, id) {
  const targetType = type === 'record' || type === 'event' ? String(type) : '';
  return {
    targetType,
    targetId: targetType ? String(id || '') : '',
  };
}

function normalizedInput(input = {}) {
  const target = normalizedTarget(input?.targetType, input?.targetId);
  return {
    ownerType: String(input?.ownerType || 'profile'),
    ownerId: String(input?.ownerId || ''),
    tenantId: String(input?.tenantId || ''),
    context: input?.context && typeof input.context === 'object' && !Array.isArray(input.context)
      ? { ...input.context }
      : { scope: 'professional' },
    date: String(input?.date || '').slice(0, 10),
    from: String(input?.from || '').slice(0, 5),
    to: String(input?.to || '').slice(0, 5),
    ...target,
    title: String(input?.title || '').trim(),
    text: String(input?.text || '').trim(),
    color: /^#[0-9A-Fa-f]{6}$/.test(String(input?.color || ''))
      ? String(input.color).toUpperCase()
      : NOTE_DEFAULT_COLOR,
  };
}

function valid(note) {
  return /^\d{4}-\d{2}-\d{2}$/.test(note.date) && Boolean(note.title || note.text);
}

function notify(detail = {}) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('book:notes-changed', { detail }));
  }
}

function targetSnapshot(targetType = '', entity = {}) {
  const type = targetType === 'record' || targetType === 'event' ? String(targetType) : '';
  const id = String(entity?.id || '');
  if (!type || !id) return null;
  if (type === 'record') {
    const person = entity?.person && typeof entity.person === 'object' ? entity.person : {};
    return {
      type,
      id,
      date: String(entity?.date || '').slice(0, 10),
      from: String(entity?.from || '').slice(0, 5),
      to: String(entity?.to || '').slice(0, 5),
      workplaceId: String(entity?.workplaceId || ''),
      status: String(entity?.status || ''),
      person: {
        id: String(person?.id || ''),
        key: String(person?.key || ''),
        uei: String(person?.uei || ''),
        name: String(person?.name || ''),
        surname: String(person?.surname || ''),
      },
    };
  }
  return {
    type,
    id,
    date: String(entity?.date || '').slice(0, 10),
    from: String(entity?.from || '').slice(0, 5),
    to: String(entity?.to || '').slice(0, 5),
    workplaceId: String(entity?.workplaceId || ''),
    title: String(entity?.title || 'Событие'),
    color: String(entity?.color || ''),
  };
}

export function createNote(input = {}) {
  const normalized = normalizedInput(input);
  if (!valid(normalized)) return null;
  const now = new Date().toISOString();
  const note = insertNote({
    ...normalized,
    id: String(input?.id || noteId()),
    createdAt: String(input?.createdAt || now),
    updatedAt: now,
  });
  notify({ action: 'create', noteId: note.id });
  return note;
}

export function updateNote(id, patch = {}) {
  const current = getNote(id);
  if (!current) return null;
  const next = normalizedInput({ ...current, ...patch });
  if (!valid(next)) return null;
  const updated = patchNote(id, next);
  if (updated) notify({ action: 'update', noteId: updated.id });
  return updated;
}

export function preserveNotesForTarget(targetType = '', entity = {}) {
  const snapshot = targetSnapshot(targetType, entity);
  if (!snapshot) return [];
  const targetId = String(snapshot.id || '');
  const updated = [];
  for (const note of getNotes()) {
    if (note?.targetType !== targetType || String(note?.targetId || '') !== targetId) continue;
    const context = note?.context && typeof note.context === 'object' && !Array.isArray(note.context)
      ? { ...note.context, targetSnapshot: snapshot }
      : { targetSnapshot: snapshot };
    const next = updateNote(note.id, { context });
    if (next) updated.push(next);
  }
  return updated;
}

export function removeNote(id) {
  const removed = deleteNoteRow(id);
  if (removed) notify({ action: 'delete', noteId: String(id || '') });
  return removed;
}

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallback);
  return payload;
}

export async function refreshNotesFromServer() {
  const payload = await responseJson(await apiRequest('/notes'), 'Не удалось обновить заметки');
  hydrateNotesFromServer(Array.isArray(payload) ? payload : []);
  notify({ action: 'server-refresh' });
  return payload;
}
