import { v2HorizontalRail } from '../v2/index.js';
import { escapeHtml } from '../utils/escape-html.js';

export const NOTE_DEFAULT_COLOR = '#CFC3FF';

function validColor(value = '') {
  const color = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : NOTE_DEFAULT_COLOR;
}

function timeLabel(note = {}) {
  const from = String(note?.from || '');
  const to = String(note?.to || '');
  if (from && to) return `${from}–${to}`;
  return from || to || '';
}

function dateLabel(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function minutes(value = '') {
  const match = String(value || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function noteActivationMinute(note = {}, activeTime = '') {
  const active = minutes(activeTime);
  const from = minutes(note?.from);
  const to = minutes(note?.to);
  if (active == null) return -1;
  if (from != null && to == null) return from;
  if (from == null && to != null) return to;
  if (from == null || to == null) return -1;
  if (from <= to) return from;
  return active >= from ? from : from - (24 * 60);
}

export function noteIsActiveAt(note = {}, activeTime = '') {
  const active = minutes(activeTime);
  if (active == null) return false;
  const from = minutes(note?.from);
  const to = minutes(note?.to);
  if (from == null && to == null) return false;
  if (from != null && to == null) return active === from;
  if (from == null && to != null) return active === to;
  if (from <= to) return active >= from && active <= to;
  return active >= from || active <= to;
}

export function orderNoteReels(notes = [], activeTime = '') {
  return (Array.isArray(notes) ? notes : [])
    .map((note, index) => ({
      note,
      index,
      active: noteIsActiveAt(note, activeTime),
      activation: noteActivationMinute(note, activeTime),
    }))
    .sort((left, right) => {
      if (left.active !== right.active) return left.active ? -1 : 1;
      if (left.active && left.activation !== right.activation) return right.activation - left.activation;
      return left.index - right.index;
    })
    .map((item) => item.note);
}

export function noteCard(note = {}, {
  active = false,
  related = false,
  targetLabel = '',
} = {}) {
  const id = String(note?.id || '');
  const title = String(note?.title || '').trim();
  const body = String(note?.text || '').trim();
  const summary = title || body || 'Заметка';
  const time = timeLabel(note);
  const color = validColor(note?.color);
  const classes = [
    'note-reel-card',
    active ? 'is-time-active' : '',
    related ? 'is-related' : '',
  ].filter(Boolean).join(' ');
  const target = targetLabel
    ? `<span class="note-reel-card__target">${escapeHtml(targetLabel)}</span>`
    : '';
  return `<button type="button" class="${classes}" data-note-reel="${escapeHtml(id)}" style="--note-color:${escapeHtml(color)}" aria-label="Открыть заметку ${escapeHtml(summary)}">
    <span class="note-reel-card__meta">${time ? escapeHtml(time) : 'На день'}</span>
    ${target}
    ${title ? `<strong class="note-reel-card__title">${escapeHtml(title)}</strong>` : ''}
    ${body ? `<span class="note-reel-card__text">${escapeHtml(body)}</span>` : ''}
  </button>`;
}

export function noteReels(notes = [], {
  activeTime = '',
  relatedIds = [],
  targetLabel = () => '',
} = {}) {
  const values = orderNoteReels(notes, activeTime);
  if (!values.length) return '';
  const related = new Set((Array.isArray(relatedIds) ? relatedIds : []).map((id) => String(id || '')));
  const cards = values.map((note) => noteCard(note, {
    active: noteIsActiveAt(note, activeTime),
    related: related.has(String(note?.id || '')),
    targetLabel: targetLabel(note),
  })).join('');
  return `<section class="note-reels" aria-label="Заметки">
    <div class="note-reels__label">Заметки</div>
    ${v2HorizontalRail(cards, { className: 'note-reels__rail' })}
  </section>`;
}

export function initNoteReels(root, { onOpen = () => {} } = {}) {
  root?.querySelectorAll?.('[data-note-reel]').forEach((node) => {
    node.addEventListener('click', () => {
      const noteId = String(node.dataset.noteReel || '');
      if (noteId) onOpen({ noteId });
    });
  });
}

export function focusNoteReels(root, noteIds = []) {
  const values = new Set((Array.isArray(noteIds) ? noteIds : [noteIds]).map((id) => String(id || '')).filter(Boolean));
  if (!root || !values.size) return null;
  let first = null;
  root.querySelectorAll?.('[data-note-reel]').forEach((node) => {
    const focused = values.has(String(node.dataset.noteReel || ''));
    node.classList.toggle('is-related', focused);
    if (focused && !first) first = node;
  });
  first?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  return first;
}

export function noteDetail(note = {}, { targetLabel = '' } = {}) {
  const color = validColor(note?.color);
  const meta = [dateLabel(note?.date), timeLabel(note)].filter(Boolean).join(' · ');
  const title = String(note?.title || '').trim();
  const body = String(note?.text || '').trim();
  return `<section class="note-detail" style="--note-color:${escapeHtml(color)}">
    <div class="note-detail__meta">${escapeHtml(meta)}</div>
    ${targetLabel ? `<div class="note-detail__target">${escapeHtml(targetLabel)}</div>` : ''}
    <div class="note-detail__color" aria-label="Цвет заметки"></div>
    ${title ? `<h2>${escapeHtml(title)}</h2>` : ''}
    ${body ? `<div class="note-detail__text">${escapeHtml(body)}</div>` : ''}
  </section>`;
}
