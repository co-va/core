import {
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

function normalizeTargetForDate(state) {
  const current = noteTargetValue(state);
  if (!current) return;
  const allowed = new Set(noteTargetOptions(state.date).map((option) => String(option.value || '')));
  if (allowed.has(current)) return;
  state.targetType = '';
  state.targetId = '';
}

export function createJournalNoteFlow({
  owner,
  date,
  onCreated = () => {},
} = {}) {
  if (!owner) return null;

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
    normalizeTargetForDate(state);
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
          options: noteTargetOptions(state.date),
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
        normalizeTargetForDate(state);
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

      const ownerId = String(getProfile()?.id || '');
      if (!ownerId) {
        openNotice({ title: 'Заметка', message: 'Профиль ещё не загружен.' });
        return;
      }

      const submit = event.currentTarget;
      submit.disabled = true;
      const created = createNote({
        ownerType: 'profile',
        ownerId,
        context: noteContextWithTarget({ scope: 'professional' }, state.targetType, state.targetId),
        date: state.date,
        from: state.from,
        to: state.to,
        targetType: state.targetType,
        targetId: state.targetId,
        title: state.title,
        text: state.text,
        color: state.color,
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
