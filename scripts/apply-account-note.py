from pathlib import Path


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text)


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one replacement, found {count}: {old[:80]!r}')
    write(path, text.replace(old, new, 1))


write('core/note/account-owner.js', """import { API_BASE } from '../../environment.js';
import { getAccountToken } from '../account/index.js';
import { NOTE_DEFAULT_COLOR } from './data.js';

let rows = [];
let loaded = false;
let loading = null;

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));

function normalize(value = {}) {
  const now = new Date().toISOString();
  const targetType = value?.targetType === 'record' || value?.targetType === 'event'
    ? String(value.targetType)
    : '';
  const targetId = targetType ? String(value?.targetId || '') : '';
  return {
    id: String(value?.id || ''),
    tenantId: '',
    ownerType: 'account',
    ownerId: String(value?.ownerId || ''),
    context: value?.context && typeof value.context === 'object' && !Array.isArray(value.context)
      ? { ...clone(value.context), scope: 'account' }
      : { scope: 'account' },
    date: String(value?.date || '').slice(0, 10),
    from: String(value?.from || '').slice(0, 5),
    to: String(value?.to || '').slice(0, 5),
    targetType,
    targetId,
    title: String(value?.title || ''),
    text: String(value?.text || ''),
    color: /^#[0-9A-Fa-f]{6}$/.test(String(value?.color || ''))
      ? String(value.color).toUpperCase()
      : NOTE_DEFAULT_COLOR,
    createdAt: String(value?.createdAt || now),
    updatedAt: String(value?.updatedAt || value?.createdAt || now),
  };
}

function noteId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccountToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Сервер не подтвердил сохранение заметки.'));
  return payload;
}

function replaceRow(value) {
  const note = normalize(value);
  const index = rows.findIndex((item) => item.id === note.id);
  if (index >= 0) rows[index] = note;
  else rows.push(note);
  return clone(note);
}

export function accountNotesLoaded() {
  return loaded;
}

export function getAccountNotes() {
  return rows.map(clone);
}

export function getAccountNote(id) {
  const row = rows.find((item) => item.id === String(id || ''));
  return row ? clone(row) : null;
}

export function getAccountNotesForDay(date) {
  const day = String(date || '').slice(0, 10);
  return getAccountNotes().filter((note) => note.date === day);
}

export async function loadAccountNotes({ force = false } = {}) {
  if (loaded && !force) return getAccountNotes();
  if (loading && !force) return loading;
  loading = request('/online-booking/account/notes')
    .then((payload) => {
      rows = (Array.isArray(payload) ? payload : []).map(normalize).filter((item) => item.id);
      loaded = true;
      return getAccountNotes();
    })
    .finally(() => { loading = null; });
  return loading;
}

export async function createAccountNote(input = {}) {
  const note = normalize({
    ...input,
    id: String(input?.id || noteId()),
    ownerType: 'account',
    context: { ...(input?.context || {}), scope: 'account' },
  });
  const saved = await request(`/online-booking/account/notes/${encodeURIComponent(note.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  });
  loaded = true;
  return replaceRow(saved);
}

export async function updateAccountNote(id, patch = {}) {
  const current = getAccountNote(id);
  if (!current) throw new Error('Заметка не найдена.');
  const note = normalize({
    ...current,
    ...clone(patch),
    id: current.id,
    ownerType: 'account',
    ownerId: current.ownerId,
    createdAt: current.createdAt,
    context: { ...(current.context || {}), ...(patch?.context || {}), scope: 'account' },
  });
  const saved = await request(`/online-booking/account/notes/${encodeURIComponent(current.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ note }),
  });
  loaded = true;
  return replaceRow(saved);
}

export async function removeAccountNote(id) {
  const key = String(id || '');
  if (!key) return false;
  await request(`/online-booking/account/notes/${encodeURIComponent(key)}`, { method: 'DELETE' });
  rows = rows.filter((item) => item.id !== key);
  loaded = true;
  return true;
}

export const accountNoteActions = {
  read: getAccountNote,
  create: createAccountNote,
  update: updateAccountNote,
  remove: removeAccountNote,
};
""")

write('server/src/online-booking/account-note.controller.ts', """import { Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { NoteService } from '../note/note.service';
import { AccountGuard } from './account.guard';

type AccountRequest = Request & { accountAuth?: { accountId: string; tenantId: string } };

@Controller('online-booking/account/notes')
@UseGuards(AccountGuard)
export class AccountNoteController {
  constructor(private readonly notes: NoteService) {}

  @Get()
  list(@Req() req: AccountRequest) {
    return this.notes.listOwned('account', String(req.accountAuth?.accountId || ''));
  }

  @Get(':id')
  get(@Req() req: AccountRequest, @Param('id') id: string) {
    return this.notes.getOwned('account', String(req.accountAuth?.accountId || ''), id);
  }

  @Put(':id')
  upsert(@Req() req: AccountRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.notes.upsertOwned('account', String(req.accountAuth?.accountId || ''), id, body);
  }

  @Delete(':id')
  remove(@Req() req: AccountRequest, @Param('id') id: string) {
    return this.notes.removeOwned('account', String(req.accountAuth?.accountId || ''), id);
  }
}
""")

write('journal/note-target.js', """import { getRecord, getRecordsForDay } from '../core/record/index.js';
import { getEventsForDay, readEvent } from '../core/event/index.js';

function personName(person = {}) {
  return [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
}

function recordOption(record = {}, label = 'Запись') {
  const time = String(record?.from || '');
  return {
    value: `record:${String(record?.id || record?.sourceId || '')}`,
    label,
    meta: [time, personName(record?.person)].filter(Boolean).join(' · '),
  };
}

function eventOption(event = {}, label = 'Событие') {
  const time = String(event?.from || '');
  return {
    value: `event:${String(event?.id || event?.sourceId || '')}`,
    label,
    meta: [time, String(event?.title || 'Событие')].filter(Boolean).join(' · '),
    indicatorColor: String(event?.color || ''),
  };
}

function snapshotPerson(person = {}) {
  return {
    id: String(person?.id || ''),
    key: String(person?.key || ''),
    uei: String(person?.uei || ''),
    name: String(person?.name || ''),
    surname: String(person?.surname || ''),
  };
}

function targetSnapshot(target = null) {
  if (!target?.entity || (target.type !== 'record' && target.type !== 'event')) return null;
  const entity = target.entity;
  if (target.type === 'record') {
    return {
      type: 'record',
      id: String(entity?.id || entity?.sourceId || ''),
      date: String(entity?.date || '').slice(0, 10),
      from: String(entity?.from || '').slice(0, 5),
      to: String(entity?.to || '').slice(0, 5),
      workplaceId: String(entity?.workplaceId || ''),
      status: String(entity?.status || ''),
      person: snapshotPerson(entity?.person || {}),
    };
  }
  return {
    type: 'event',
    id: String(entity?.id || entity?.sourceId || ''),
    date: String(entity?.date || '').slice(0, 10),
    from: String(entity?.from || '').slice(0, 5),
    to: String(entity?.to || '').slice(0, 5),
    workplaceId: String(entity?.workplaceId || ''),
    title: String(entity?.title || 'Событие'),
    color: String(entity?.color || ''),
  };
}

function storedTargetSnapshot(note = {}) {
  const snapshot = note?.context?.targetSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const type = snapshot.type === 'record' || snapshot.type === 'event' ? String(snapshot.type) : '';
  const id = String(snapshot.id || '');
  if (!type || !id || type !== note?.targetType || id !== String(note?.targetId || '')) return null;
  return { ...snapshot, type, id };
}

function recordsForDay(date, source = null) {
  if (typeof source?.recordsForDay === 'function') return source.recordsForDay(date) || [];
  return getRecordsForDay(date, '');
}

function eventsForDay(date, source = null) {
  if (typeof source?.eventsForDay === 'function') return source.eventsForDay(date) || [];
  return getEventsForDay(date, '');
}

function liveTarget(type = '', id = '', source = null) {
  if (!id) return null;
  if (type === 'record') {
    const record = typeof source?.readRecord === 'function' ? source.readRecord(id) : getRecord(id);
    return record ? { type: 'record', entity: record, historical: false, deleted: false } : null;
  }
  if (type === 'event') {
    const event = typeof source?.readEvent === 'function' ? source.readEvent(id) : readEvent(id);
    return event ? { type: 'event', entity: event, historical: false, deleted: false } : null;
  }
  return null;
}

export function noteTargetSnapshot(targetType = '', targetId = '', { source = null } = {}) {
  return targetSnapshot(liveTarget(targetType, targetId, source));
}

export function noteContextWithTarget(context = {}, targetType = '', targetId = '', { source = null } = {}) {
  const next = context && typeof context === 'object' && !Array.isArray(context) ? { ...context } : {};
  const type = targetType === 'record' || targetType === 'event' ? String(targetType) : '';
  const id = type ? String(targetId || '') : '';
  if (!type || !id) {
    delete next.targetSnapshot;
    return next;
  }

  const snapshot = noteTargetSnapshot(type, id, { source });
  if (snapshot) {
    next.targetSnapshot = snapshot;
    return next;
  }

  const existing = next.targetSnapshot;
  if (!existing || existing.type !== type || String(existing.id || '') !== id) {
    delete next.targetSnapshot;
  }
  return next;
}

export function noteTargetOptions(date, { includeNote = null, source = null } = {}) {
  const options = [
    { value: '', label: 'Не прикреплено' },
    ...recordsForDay(date, source).filter((record) => record?.status !== 'cancelled').map((record) => recordOption(record)),
    ...eventsForDay(date, source).map((event) => eventOption(event)),
  ];

  const currentValue = noteTargetValue(includeNote || {});
  if (!currentValue || options.some((option) => String(option.value || '') === currentValue)) return options;
  const target = resolveNoteTarget(includeNote || {}, { source });
  if (!target) return options;
  if (target.type === 'record') {
    const label = target.deleted
      ? 'Запись удалена'
      : target.entity?.status === 'cancelled'
        ? 'Запись отменена'
        : 'Запись';
    options.push(recordOption(target.entity, label));
  } else {
    options.push(eventOption(target.entity, target.deleted ? 'Событие удалено' : 'Событие'));
  }
  return options;
}

export function parseNoteTargetValue(value = '') {
  const match = String(value || '').match(/^(record|event):(.+)$/);
  return match
    ? { targetType: match[1], targetId: match[2] }
    : { targetType: '', targetId: '' };
}

export function noteTargetValue(note = {}) {
  const type = note?.targetType === 'record' || note?.targetType === 'event'
    ? String(note.targetType)
    : '';
  const id = String(note?.targetId || '');
  return type && id ? `${type}:${id}` : '';
}

export function resolveNoteTarget(note = {}, { source = null } = {}) {
  const type = note?.targetType === 'record' || note?.targetType === 'event'
    ? String(note.targetType)
    : '';
  const id = String(note?.targetId || '');
  if (!type || !id) return null;

  const live = liveTarget(type, id, source);
  if (live) return live;

  const snapshot = storedTargetSnapshot(note);
  return snapshot
    ? { type, entity: snapshot, historical: true, deleted: true }
    : null;
}

export function noteTargetLabel(note = {}, { source = null } = {}) {
  const target = resolveNoteTarget(note, { source });
  if (!target) return '';
  if (target.type === 'record') {
    const status = target.deleted
      ? 'Запись удалена'
      : target.entity?.status === 'cancelled'
        ? 'Запись отменена'
        : 'Запись';
    return `${status} · ${String(target.entity?.from || '')} · ${personName(target.entity?.person)}`;
  }
  const status = target.deleted ? 'Событие удалено' : 'Событие';
  return `${status} · ${String(target.entity?.from || '')} · ${String(target.entity?.title || 'Событие')}`;
}

export function noteVisibleForWorkplace(note = {}, workplaceId = '', {
  allMode = false,
  resolveTarget = resolveNoteTarget,
} = {}) {
  if (allMode) return true;
  const target = resolveTarget(note);
  if (!target) return true;
  return String(target.entity?.workplaceId || '') === String(workplaceId || '');
}
""")

write('journal/note-create.js', """import {
  colorPicker,
  datePicker,
  field,
  initColorPickers,
  initDatePickers,
  initTimePickers,
  openNotice,
  select,
  textareaField,
  timePicker,
} from '../ui/ui.js';
import { createNote, NOTE_DEFAULT_COLOR, removeNote } from '../core/note/index.js';
import { getProfile } from '../core/profile/data.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import {
  noteContextWithTarget,
  noteTargetOptions,
  noteTargetValue,
  parseNoteTargetValue,
} from './note-target.js';

function normalizeTargetForDate(state, targetSource = null) {
  const current = noteTargetValue(state);
  if (!current) return;
  const allowed = new Set(noteTargetOptions(state.date, { source: targetSource }).map((option) => String(option.value || '')));
  if (allowed.has(current)) return;
  state.targetType = '';
  state.targetId = '';
}

export function createJournalNoteFlow({
  owner,
  date,
  noteActions = null,
  targetSource = null,
  onCreated = () => {},
} = {}) {
  if (!owner) return null;
  const customActions = noteActions && typeof noteActions.create === 'function' ? noteActions : null;

  const state = {
    date: String(date || '').slice(0, 10),
    from: '',
    to: '',
    targetType: '',
    targetId: '',
    title: '',
    text: '',
    color: NOTE_DEFAULT_COLOR,
  };

  const capture = (root) => {
    const form = root?.querySelector('[data-note-create-form]');
    if (!form) return;
    const data = new FormData(form);
    state.date = String(data.get('date') || state.date || '').slice(0, 10);
    state.from = String(data.get('from') || '').slice(0, 5);
    state.to = String(data.get('to') || '').slice(0, 5);
    const target = parseNoteTargetValue(data.get('target'));
    state.targetType = target.targetType;
    state.targetId = target.targetId;
    state.title = String(data.get('title') || '').trim();
    state.text = String(data.get('text') || '').trim();
    state.color = String(data.get('color') || NOTE_DEFAULT_COLOR);
  };

  const render = () => {
    normalizeTargetForDate(state, targetSource);
    const view = owner.render({
      step: 'note',
      title: false,
      body: `<form class="form-grid" data-note-create-form>
        ${datePicker({ label: 'Дата', name: 'date', value: state.date, required: true, allowClear: false })}
        <div class="time-range-fields">
          ${timePicker({ label: 'С', name: 'from', value: state.from, allowEmpty: true })}
          ${timePicker({ label: 'До', name: 'to', value: state.to, allowEmpty: true })}
        </div>
        ${select({
          label: 'Прикрепить к',
          name: 'target',
          value: noteTargetValue(state),
          options: noteTargetOptions(state.date, { source: targetSource }),
          aria: 'Прикрепить заметку',
        })}
        ${field({ label: 'Наименование', name: 'title', value: state.title })}
        ${textareaField({ label: 'Текст', name: 'text', value: state.text, rows: 8, placeholder: 'Текст заметки' })}
        ${colorPicker({ name: 'color', value: state.color })}
      </form>`,
      action: { label: 'Создать', data: 'data-note-create' },
    });
    if (!view) return;

    initDatePickers(view.body);
    initTimePickers(view.body);
    initColorPickers(view.body);

    const form = view.body.querySelector('[data-note-create-form]');
    form?.addEventListener('input', () => capture(view.body));
    form?.addEventListener('change', (event) => {
      const previousDate = state.date;
      capture(view.body);
      if (event.target?.name === 'date' && state.date !== previousDate) {
        normalizeTargetForDate(state, targetSource);
        render();
      }
    });

    view.action?.addEventListener('click', async (event) => {
      capture(view.body);
      if (!state.date) {
        openNotice({ title: 'Заметка', message: 'Укажите дату заметки.' });
        return;
      }
      if (!state.title && !state.text) {
        openNotice({ title: 'Заметка', message: 'Укажите наименование или текст заметки.' });
        return;
      }

      const submit = event.currentTarget;
      submit.disabled = true;
      const input = {
        context: noteContextWithTarget(
          { scope: customActions ? 'account' : 'professional' },
          state.targetType,
          state.targetId,
          { source: targetSource },
        ),
        date: state.date,
        from: state.from,
        to: state.to,
        targetType: state.targetType,
        targetId: state.targetId,
        title: state.title,
        text: state.text,
        color: state.color,
      };

      if (customActions) {
        try {
          const created = await customActions.create(input);
          if (!created) throw new Error('Не удалось создать заметку.');
          owner.commit?.();
          onCreated?.(created);
        } catch (error) {
          openNotice({
            title: 'Не удалось создать заметку',
            message: String(error?.message || 'Сервер не подтвердил сохранение.'),
          });
          if (submit.isConnected) submit.disabled = false;
        }
        return;
      }

      const ownerId = String(getProfile()?.id || '');
      if (!ownerId) {
        submit.disabled = false;
        openNotice({ title: 'Заметка', message: 'Профиль ещё не загружен.' });
        return;
      }

      const created = createNote({
        ownerType: 'profile',
        ownerId,
        ...input,
      });
      if (!created) {
        submit.disabled = false;
        openNotice({ title: 'Заметка', message: 'Не удалось создать заметку.' });
        return;
      }

      try {
        await flushBusinessPersistence();
        owner.commit?.();
        onCreated?.(created);
      } catch (error) {
        removeNote(created.id);
        openNotice({
          title: 'Не удалось создать заметку',
          message: String(error?.message || 'Сервер не подтвердил сохранение.'),
        });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  render();
  return {
    resume: render,
    getState: () => ({ ...state }),
  };
}
""")

write('journal/note-view.js', """import {
  actionBlock,
  button,
  colorPicker,
  datePicker,
  field,
  initColorPickers,
  initDatePickers,
  initTimePickers,
  modal,
  mountModal,
  openNotice,
  select,
  textareaField,
  timePicker,
} from '../ui/ui.js';
import {
  NOTE_DEFAULT_COLOR,
  createNote,
  readNote,
  removeNote,
  updateNote,
} from '../core/note/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { noteDetail } from '../ui/note/index.js';
import {
  noteContextWithTarget,
  noteTargetLabel,
  noteTargetOptions,
  noteTargetValue,
  parseNoteTargetValue,
  resolveNoteTarget,
} from './note-target.js';

function normalizeTargetForDate(state, targetSource = null) {
  const current = noteTargetValue(state);
  if (!current) return;

  const target = resolveNoteTarget(state, { source: targetSource });
  const targetDate = String(target?.entity?.date || '').slice(0, 10);
  if (targetDate && targetDate === String(state.date || '').slice(0, 10)) return;

  const allowed = new Set(noteTargetOptions(state.date, { source: targetSource }).map((option) => String(option.value || '')));
  if (allowed.has(current)) return;
  state.targetType = '';
  state.targetId = '';
}

export function openNoteView(noteOrId, {
  onClose = () => {},
  onSaved = () => {},
  onDeleted = () => {},
  noteActions = null,
  targetSource = null,
} = {}) {
  const customActions = noteActions
    && typeof noteActions.read === 'function'
    && typeof noteActions.update === 'function'
    && typeof noteActions.remove === 'function'
    ? noteActions
    : null;
  const noteId = String(typeof noteOrId === 'object' ? noteOrId?.id : noteOrId || '');
  const readCurrent = () => customActions ? customActions.read(noteId) : readNote(noteId);
  let current = readCurrent();
  if (!current) return null;

  const layer = mountModal(document.body, modal('<div data-note-view-host></div>', {
    variant: 'q',
    surface: 'app',
    title: 'Заметка',
    className: 'note-view-q',
  }));
  if (!layer) return null;

  const originalClose = layer.v2Close?.bind(layer);
  if (originalClose) {
    layer.v2Close = () => {
      if (!layer.isConnected) return;
      originalClose();
      onClose?.();
    };
  }

  const host = () => layer.querySelector('[data-note-view-host]');

  const renderRead = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;
    root.innerHTML = `${noteDetail(current, { targetLabel: noteTargetLabel(current, { source: targetSource }) })}
      ${actionBlock(button('Изменить', { data: 'data-note-view-edit' }))}`;
    root.querySelector('[data-note-view-edit]')?.addEventListener('click', renderEdit);
  };

  const renderEdit = () => {
    current = readCurrent();
    const root = host();
    if (!root || !current) return;

    const state = {
      ...current,
      context: current.context && typeof current.context === 'object' && !Array.isArray(current.context)
        ? { ...current.context }
        : {},
    };
    normalizeTargetForDate(state, targetSource);
    const before = { ...current };

    const renderForm = () => {
      normalizeTargetForDate(state, targetSource);
      root.innerHTML = `<form class="form-grid" data-note-edit-form>
        ${datePicker({ label: 'Дата', name: 'date', value: state.date, required: true, allowClear: false })}
        <div class="time-range-fields">
          ${timePicker({ label: 'С', name: 'from', value: state.from, allowEmpty: true })}
          ${timePicker({ label: 'До', name: 'to', value: state.to, allowEmpty: true })}
        </div>
        ${select({
          label: 'Прикрепить к',
          name: 'target',
          value: noteTargetValue(state),
          options: noteTargetOptions(state.date, { includeNote: state, source: targetSource }),
          aria: 'Прикрепить заметку',
        })}
        ${field({ label: 'Наименование', name: 'title', value: state.title })}
        ${textareaField({ label: 'Текст', name: 'text', value: state.text, rows: 8, placeholder: 'Текст заметки' })}
        ${colorPicker({ name: 'color', value: state.color || NOTE_DEFAULT_COLOR })}
        ${actionBlock([
          button('Сохранить', { type: 'submit' }),
          button('Удалить', { variant: 'critical', data: 'data-note-edit-delete' }),
        ].join(''))}
      </form>`;

      initDatePickers(root);
      initTimePickers(root);
      initColorPickers(root);

      const form = root.querySelector('[data-note-edit-form]');
      const capture = () => {
        if (!form) return;
        const data = new FormData(form);
        state.date = String(data.get('date') || state.date || '').slice(0, 10);
        state.from = String(data.get('from') || '').slice(0, 5);
        state.to = String(data.get('to') || '').slice(0, 5);
        const nextTarget = parseNoteTargetValue(data.get('target'));
        state.targetType = nextTarget.targetType;
        state.targetId = nextTarget.targetId;
        state.title = String(data.get('title') || '').trim();
        state.text = String(data.get('text') || '').trim();
        state.color = String(data.get('color') || NOTE_DEFAULT_COLOR);
      };

      form?.addEventListener('input', capture);
      form?.addEventListener('change', (event) => {
        const previousDate = state.date;
        capture();
        if (event.target?.name === 'date' && state.date !== previousDate) {
          normalizeTargetForDate(state, targetSource);
          renderForm();
        }
      });

      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        capture();
        normalizeTargetForDate(state, targetSource);
        if (!state.date) {
          openNotice({ title: 'Заметка', message: 'Укажите дату заметки.' });
          return;
        }
        if (!state.title && !state.text) {
          openNotice({ title: 'Заметка', message: 'Укажите наименование или текст заметки.' });
          return;
        }

        const submit = form.querySelector('[type="submit"]');
        if (submit) submit.disabled = true;
        const patch = {
          context: noteContextWithTarget(state.context, state.targetType, state.targetId, { source: targetSource }),
          date: state.date,
          from: state.from,
          to: state.to,
          targetType: state.targetType,
          targetId: state.targetId,
          title: state.title,
          text: state.text,
          color: state.color,
        };

        if (customActions) {
          try {
            const updated = await customActions.update(noteId, patch);
            if (!updated) throw new Error('Не удалось сохранить заметку.');
            current = updated;
            onSaved?.(updated);
            renderRead();
          } catch (error) {
            openNotice({
              title: 'Не удалось сохранить заметку',
              message: String(error?.message || 'Сервер не подтвердил изменения.'),
            });
            if (submit?.isConnected) submit.disabled = false;
          }
          return;
        }

        const updated = updateNote(noteId, patch);
        if (!updated) {
          if (submit) submit.disabled = false;
          openNotice({ title: 'Заметка', message: 'Не удалось сохранить заметку.' });
          return;
        }

        try {
          await flushBusinessPersistence();
          current = updated;
          onSaved?.(updated);
          renderRead();
        } catch (error) {
          updateNote(noteId, before);
          openNotice({
            title: 'Не удалось сохранить заметку',
            message: String(error?.message || 'Сервер не подтвердил изменения.'),
          });
          if (submit?.isConnected) submit.disabled = false;
        }
      });

      root.querySelector('[data-note-edit-delete]')?.addEventListener('click', async (event) => {
        const submit = event.currentTarget;
        submit.disabled = true;
        const snapshot = readCurrent();
        if (!snapshot) {
          submit.disabled = false;
          return;
        }

        if (customActions) {
          try {
            const removed = await customActions.remove(noteId);
            if (!removed) throw new Error('Не удалось удалить заметку.');
            onDeleted?.(snapshot);
            layer.v2Close?.();
          } catch (error) {
            openNotice({
              title: 'Не удалось удалить заметку',
              message: String(error?.message || 'Сервер не подтвердил удаление.'),
            });
            if (submit.isConnected) submit.disabled = false;
          }
          return;
        }

        if (!removeNote(noteId)) {
          submit.disabled = false;
          return;
        }

        try {
          await flushBusinessPersistence();
          onDeleted?.(snapshot);
          layer.v2Close?.();
        } catch (error) {
          createNote(snapshot);
          openNotice({
            title: 'Не удалось удалить заметку',
            message: String(error?.message || 'Сервер не подтвердил удаление.'),
          });
          if (submit.isConnected) submit.disabled = false;
        }
      });
    };

    renderForm();
  };

  renderRead();
  return layer;
}
""")

# Extend NoteService with account-owned storage while preserving the professional API.
service_path = 'server/src/note/note.service.ts'
service = read(service_path)
insert = """

  async listOwned(ownerType: string, ownerId: string) {
    const rows = await this.prisma.note.findMany({
      where: { ownerType, ownerId, tenantId: null },
      orderBy: [{ date: 'asc' }, { from: 'asc' }, { to: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(notePayload);
  }

  async getOwned(ownerType: string, ownerId: string, id: string) {
    const row = await this.prisma.note.findFirst({
      where: { id, ownerType, ownerId, tenantId: null },
    });
    if (!row) throw new NotFoundException('Заметка не найдена');
    return notePayload(row);
  }

  async upsertOwned(ownerType: string, ownerId: string, id: string, body: unknown) {
    const source = objectValue(body);
    const input = objectValue(source.note) as NoteInput;
    const noteId = stringValue(id);
    if (!ownerType || !ownerId || !noteId || (stringValue(input.id) && stringValue(input.id) !== noteId)) {
      throw new BadRequestException('Некорректный id заметки');
    }
    if (stringValue(input.ownerType) && stringValue(input.ownerType) !== ownerType) {
      throw new BadRequestException('Некорректный владелец заметки');
    }
    if (stringValue(input.ownerId) && stringValue(input.ownerId) !== ownerId) {
      throw new BadRequestException('Некорректный владелец заметки');
    }

    const existingById = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (existingById && (
      existingById.tenantId !== null
      || existingById.ownerType !== ownerType
      || existingById.ownerId !== ownerId
    )) {
      throw new NotFoundException('Заметка не найдена');
    }

    const date = dateValue(input.date);
    const from = optionalTime(input.from);
    const to = optionalTime(input.to);
    const targetType = stringValue(input.targetType);
    const targetId = stringValue(input.targetId);
    if ((targetType || targetId) && (!targetType || !targetId || (targetType !== 'record' && targetType !== 'event'))) {
      throw new BadRequestException('Некорректная связь заметки');
    }
    const title = stringValue(input.title);
    const noteText = stringValue(input.text);
    if (!title && !noteText) {
      throw new BadRequestException('Укажите наименование или текст заметки');
    }

    const context = {
      ...objectValue(input.context),
      scope: 'account',
    } as Prisma.InputJsonValue;
    const createdAtCandidate = stringValue(input.createdAt);
    const createdAt = existingById?.createdAt
      || (createdAtCandidate && !Number.isNaN(new Date(createdAtCandidate).getTime())
        ? new Date(createdAtCandidate)
        : new Date());
    const data = {
      tenantId: null,
      ownerType,
      ownerId,
      context,
      date,
      from,
      to,
      targetType: targetType === 'record' || targetType === 'event' ? targetType : '',
      targetId: targetType === 'record' || targetType === 'event' ? targetId : '',
      title,
      text: noteText,
      color: colorValue(input.color),
      createdAt,
    };

    const row = existingById
      ? await this.prisma.note.update({ where: { id: noteId }, data })
      : await this.prisma.note.create({ data: { id: noteId, ...data } });
    return notePayload(row);
  }

  async removeOwned(ownerType: string, ownerId: string, id: string) {
    const row = await this.prisma.note.findFirst({
      where: { id, ownerType, ownerId, tenantId: null },
      select: { id: true },
    });
    if (!row) return { ok: true };
    await this.prisma.note.delete({ where: { id: row.id } });
    return { ok: true };
  }
"""
marker = '\n}\n'
idx = service.rfind(marker)
if idx < 0:
    raise RuntimeError('NoteService class end not found')
write(service_path, service[:idx] + insert + service[idx:])

replace_once(
    'server/src/online-booking/online-booking.module.ts',
    "import { EventModule } from '../event/event.module';\n",
    "import { EventModule } from '../event/event.module';\nimport { NoteModule } from '../note/note.module';\n",
)
replace_once(
    'server/src/online-booking/online-booking.module.ts',
    "import { AccountEventController } from './account-event.controller';\n",
    "import { AccountEventController } from './account-event.controller';\nimport { AccountNoteController } from './account-note.controller';\n",
)
replace_once(
    'server/src/online-booking/online-booking.module.ts',
    'imports: [AuthModule, BusinessStateModule, CommunicationModule, DocumentRegistryModule, EventModule, TenantDocumentArchiveModule, NotificationModule, ProfileModule, TimeModule, RecordModule, ProcedureModule, FinanceModule, LoyaltyModule, SaasAccessModule],',
    'imports: [AuthModule, BusinessStateModule, CommunicationModule, DocumentRegistryModule, EventModule, NoteModule, TenantDocumentArchiveModule, NotificationModule, ProfileModule, TimeModule, RecordModule, ProcedureModule, FinanceModule, LoyaltyModule, SaasAccessModule],',
)
replace_once(
    'server/src/online-booking/online-booking.module.ts',
    'controllers: [OnlineBookingController, AccountEventController, AccountMessengerController, BookingConsentController, AccountSettingsController, AccountDepositController, AccountPersonalAccountController],',
    'controllers: [OnlineBookingController, AccountEventController, AccountNoteController, AccountMessengerController, BookingConsentController, AccountSettingsController, AccountDepositController, AccountPersonalAccountController],',
)

# Account Journal uses the same Shared Note creation/view/Y; only ownership and data source differ.
day_path = 'journal/день.js'
day = read(day_path)
day = day.replace(
    "import { getNotesForDay } from '../core/note/index.js';\n",
    "import { getNotesForDay } from '../core/note/index.js';\nimport {\n  accountNoteActions,\n  accountNotesLoaded,\n  getAccountNote,\n  getAccountNotesForDay,\n  loadAccountNotes,\n} from '../core/note/account-owner.js';\n",
    1,
)
day = day.replace(
    "  accountEventActions,\n  accountEventsLoaded,\n  getAccountEvents,\n  loadAccountEvents,\n} from '../core/event/account-owner.js';\nimport { createJournalEventFlow } from './event-create.js';\n",
    "  accountEventActions,\n  accountEventsLoaded,\n  getAccountEvent,\n  getAccountEvents,\n  loadAccountEvents,\n} from '../core/event/account-owner.js';\nimport { createJournalEventFlow } from './event-create.js';\nimport { createJournalNoteFlow } from './note-create.js';\n",
    1,
)
old_sig = "function openAccountDayAction({ root, date, from, onCreated = () => {} } = {}) {"
new_sig = "function openAccountDayAction({ root, date, from, noteActions = null, targetSource = null, onCreated = () => {} } = {}) {"
if day.count(old_sig) != 1:
    raise RuntimeError('Account Day action signature changed')
day = day.replace(old_sig, new_sig, 1)
old_note_handler = """  layer.querySelector('[data-account-day-note]')?.addEventListener('click', () => {
    layer.v2Close?.();
  });
"""
new_note_handler = """  layer.querySelector('[data-account-day-note]')?.addEventListener('click', () => {
    layer.v2Close?.();
    const owner = openRecordCreationOwner({
      surfaceRoot: root.closest('[data-v2-z],[data-v2-z-layer]'),
      bodyRoot: root,
    });
    if (!owner) return;
    owner.setShellHeader('<div class="record-creation-step-title">Заметка</div>');
    createJournalNoteFlow({
      owner,
      date,
      noteActions,
      targetSource,
      onCreated,
    });
  });
"""
if day.count(old_note_handler) != 1:
    raise RuntimeError('Account Note handler changed')
day = day.replace(old_note_handler, new_note_handler, 1)
start = day.index('  if (accountMode) {')
end = day.index('\n  const workplaces = getWorkplaces();', start)
account_block = """  if (accountMode) {
    clearV2Y(root);
    if (!accountEventsLoaded()) {
      void loadAccountEvents().then(() => {
        if (root.isConnected) rerender();
      }).catch(() => {});
    }
    if (!accountNotesLoaded()) {
      void loadAccountNotes().then(() => {
        if (root.isConnected) rerender();
      }).catch(() => {});
    }

    const allAccountRecords = readRecords(records);
    const accountRecords = allAccountRecords
      .filter((record) => String(record?.date || '').slice(0, 10) === dayDate)
      .filter((record) => String(record?.status || '').toLowerCase() !== 'cancelled');
    const accountEvents = getAccountEvents()
      .filter((event) => String(event?.date || '').slice(0, 10) === dayDate);
    const accountTargetSource = {
      readRecord: (id) => {
        const record = allAccountRecords.find((item) => recordId(item) === String(id || '')) || null;
        return record ? accountUsage(record, resolveRecordContext) : null;
      },
      recordsForDay: (targetDate) => allAccountRecords
        .filter((record) => String(record?.date || '').slice(0, 10) === String(targetDate || '').slice(0, 10))
        .map((record) => accountUsage(record, resolveRecordContext)),
      readEvent: (id) => getAccountEvent(id),
      eventsForDay: (targetDate) => getAccountEvents()
        .filter((event) => String(event?.date || '').slice(0, 10) === String(targetDate || '').slice(0, 10))
        .map(accountEventUsage),
    };
    const accountNotes = getAccountNotesForDay(dayDate);
    const renderAccountY = () => {
      const yRoot = setV2Y(root, noteReels(accountNotes, {
        activeTime,
        targetLabel: (note) => noteTargetLabel(note, { source: accountTargetSource }),
      }));
      if (!yRoot || yRoot.hidden) return;
      initNoteReels(yRoot, {
        onOpen: async ({ noteId }) => {
          const note = getAccountNote(noteId);
          if (!note) return;
          const { openNoteView } = await import('./note-view.js');
          openNoteView(note, {
            noteActions: accountNoteActions,
            targetSource: accountTargetSource,
            onSaved: rerender,
            onDeleted: rerender,
          });
        },
      });
    };
    renderAccountY();

    const usages = [
      ...accountRecords.map((record) => accountUsage(record, resolveRecordContext)),
      ...accountEvents.map(accountEventUsage),
    ];
    const recordById = new Map(accountRecords.map((record) => [recordId(record), record]).filter(([id]) => Boolean(id)));
    const eventById = new Map(accountEvents.map((event) => [String(event?.id || ''), event]).filter(([id]) => Boolean(id)));

    timelineRoot.innerHTML = journalDayTimeline({
      from: '09:00',
      to: '23:00',
      usages,
      day: dayDate,
    });
    initJournalDayTimeline(timelineRoot, {
      onUsageClick: ({ usageId }) => {
        const id = String(usageId || '');
        const event = eventById.get(id);
        if (event) {
          void openAccountEvent(event, rerender);
          return;
        }
        const record = recordById.get(id);
        if (record) void openAccountRecord(record, resolveRecordContext, rerender);
      },
      onSlotClick: ({ from }) => {
        openAccountDayAction({
          root,
          date: dayDate,
          from,
          noteActions: accountNoteActions,
          targetSource: accountTargetSource,
          onCreated: rerender,
        });
      },
    });
    return dispose;
  }
"""
day = day[:start] + account_block + day[end:]
write(day_path, day)

# Focused browser regression: Note action must open the existing Shared Note flow and persist into Y.
test_path = 'tests/journal-account-action-x-runtime-browser.html'
test = read(test_path)
test = test.replace(
    "let stage = 'boot';\n",
    "let stage = 'boot';\nlet accountNotes = [];\nlet accountNoteWrites = 0;\n",
    1,
)
old_fetch = """  if (url.includes('/online-booking/account/events')) {
    if (String(options.method || 'GET').toUpperCase() === 'GET') {
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
"""
new_fetch = old_fetch + """  if (url.includes('/online-booking/account/notes')) {
    const method = String(options.method || 'GET').toUpperCase();
    if (method === 'GET') {
      return new Response(JSON.stringify(accountNotes), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'PUT') {
      const note = JSON.parse(String(options.body || '{}')).note || {};
      const index = accountNotes.findIndex((item) => item.id === note.id);
      if (index >= 0) accountNotes[index] = note;
      else accountNotes.push(note);
      accountNoteWrites += 1;
      return new Response(JSON.stringify(note), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (method === 'DELETE') {
      const id = decodeURIComponent(url.split('/').pop() || '');
      accountNotes = accountNotes.filter((item) => item.id !== id);
      return new Response('{\"ok\":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  }
"""
if test.count(old_fetch) != 1:
    raise RuntimeError('Account action X fetch fixture changed')
test = test.replace(old_fetch, new_fetch, 1)
old_stage = """mark('note-idle');
clickSlot('12:00');
await wait();
x = currentX();
x?.querySelector('[data-account-day-note]')?.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
await wait();
ok(!currentX(), 'холостая «Заметка» не закрыла X');
ok(!root.querySelector('[data-record-creation-flow]'), 'холостая «Заметка» создала creation-flow');
"""
new_stage = """mark('note-shared-flow');
clickSlot('12:00');
await wait();
x = currentX();
x?.querySelector('[data-account-day-note]')?.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
await wait();
ok(!currentX(), 'X не закрылся перед Note');
const noteForm = root.querySelector('[data-note-create-form]');
ok(Boolean(noteForm), '«Заметка» не открыла Shared Note creation');
ok(root.dataset.recordCreationStep === 'note', 'Shared owner не находится на Note step');
ok(String(host.textContent || '').includes('Заметка'), 'Shared Note не имеет заголовка «Заметка»');
ok(Boolean(noteForm?.querySelector('[name="date"]')), 'Shared Note потеряла поле даты');
ok(Boolean(noteForm?.querySelector('[name="from"]')), 'Shared Note потеряла поле «С»');
ok(Boolean(noteForm?.querySelector('[name="to"]')), 'Shared Note потеряла поле «До»');
ok(Boolean(noteForm?.querySelector('[name="target"]')), 'Shared Note потеряла «Прикрепить к»');
ok(Boolean(noteForm?.querySelector('[name="title"]')), 'Shared Note потеряла «Наименование»');
ok(Boolean(noteForm?.querySelector('[name="text"]')), 'Shared Note потеряла «Текст»');
const noteTitle = noteForm?.querySelector('[name="title"]');
if (noteTitle) {
  noteTitle.value = 'Личная заметка';
  noteTitle.dispatchEvent(new Event('input', { bubbles:true }));
}
root.querySelector('[data-note-create]')?.dispatchEvent(new MouseEvent('click', { bubbles:true, cancelable:true }));
await wait(180);
ok(accountNoteWrites === 1, 'Shared Note не сохранилась через account owner');
const createdNote = host.querySelector('[data-note-reel]');
ok(Boolean(createdNote), 'созданная Account Note не появилась в Shared Y');
ok(String(createdNote?.textContent || '').includes('Личная заметка'), 'Shared Y показывает не созданную Account Note');
"""
if test.count(old_stage) != 1:
    raise RuntimeError('Account Note idle fixture changed')
test = test.replace(old_stage, new_stage, 1)
write(test_path, test)

# Static regression coverage stays inside the canonical Note/Y test.
note_test = 'tests/note-y.test.mjs'
nt = read(note_test)
nt = nt.replace(
    "const eventView = read('journal/event-view.js');\n",
    "const eventView = read('journal/event-view.js');\nconst accountNoteOwner = read('core/note/account-owner.js');\nconst accountNoteController = read('server/src/online-booking/account-note.controller.ts');\nconst onlineBookingModule = read('server/src/online-booking/online-booking.module.ts');\n",
    1,
)
nt = nt.replace(
    "assert.match(noteCreate, /noteContextWithTarget/);\n",
    "assert.match(noteCreate, /noteContextWithTarget/);\nassert.match(noteCreate, /noteActions/);\nassert.match(noteCreate, /targetSource/);\n",
    1,
)
nt = nt.replace(
    "assert.match(day, /journalDayTimeline/);\n",
    "assert.match(day, /journalDayTimeline/);\nassert.match(day, /accountNoteActions/);\nassert.match(day, /getAccountNotesForDay/);\nassert.match(day, /createJournalNoteFlow/);\n",
    1,
)
nt = nt.replace(
    "assert.match(serverNoteService, /preservesExistingTarget/);\n",
    "assert.match(serverNoteService, /preservesExistingTarget/);\nassert.match(serverNoteService, /listOwned/);\nassert.match(serverNoteService, /upsertOwned/);\nassert.match(accountNoteOwner, /online-booking\\/account\\/notes/);\nassert.match(accountNoteOwner, /accountNoteActions/);\nassert.match(accountNoteController, /Controller\\('online-booking\\/account\\/notes'\\)/);\nassert.match(onlineBookingModule, /NoteModule/);\nassert.match(onlineBookingModule, /AccountNoteController/);\n",
    1,
)
write(note_test, nt)

# The focused runtime is part of Check Book, so this exact account flow is exercised in CI.
check = '.github/workflows/check.yml'
replace_once(
    check,
    "          run_browser_case \"tests/account-shell-runtime-browser.html\" 'data-account-runtime=\"pass\"' 'data-account-runtime-stage' /tmp/account-runtime-dom.html\n",
    "          run_browser_case \"tests/account-shell-runtime-browser.html\" 'data-account-runtime=\"pass\"' 'data-account-runtime-stage' /tmp/account-runtime-dom.html\n          run_browser_case \"tests/journal-account-action-x-runtime-browser.html\" 'data-journal-account-action-x-runtime=\"pass\"' 'data-journal-account-action-x-runtime-stage' /tmp/journal-account-action-x-runtime-dom.html\n",
)

# Register the account Note module/controller.
# Remove bootstrap artifacts from the implementation commit.
for bootstrap in [Path('scripts/apply-account-note.py'), Path('.github/workflows/apply-account-note.yml')]:
    if bootstrap.exists():
        bootstrap.unlink()

print('Account Journal Shared Note patch applied')
