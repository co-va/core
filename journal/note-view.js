import {
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
