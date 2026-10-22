import { getNote, getNotes } from './data.js';

export function readNote(id) {
  return getNote(id);
}

export function readNotes() {
  return getNotes();
}

export function getNotesForDay(date) {
  const day = String(date || '').slice(0, 10);
  return getNotes().filter((note) => note.date === day);
}

export function getNotesForTarget(targetType, targetId) {
  const type = targetType === 'record' || targetType === 'event' ? String(targetType) : '';
  const id = String(targetId || '');
  if (!type || !id) return [];
  return getNotes().filter((note) => note.targetType === type && note.targetId === id);
}

export function hasNotesForTarget(targetType, targetId) {
  return getNotesForTarget(targetType, targetId).length > 0;
}
