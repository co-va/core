import { mountV2ZLayer, setV2ZHeaderRows, v2ZLayer } from '../ui/v2/index.js';
import { actionBlock } from '../ui/page/page.js';
import {
  button,
  field,
  modal,
  mountModal,
  openColorPickerAction,
  openNotice,
  openTimeRangeAction,
  textareaField,
} from '../ui/ui.js';
import { checkTimeAvailability, timeToMinutes } from '../core/time/index.js';
import { createEvent, readEvent, removeEvent, updateEvent } from '../core/event/index.js';
import { getNotesForTarget, hasNotesForTarget } from '../core/note/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function surface() {
  return document.querySelector('[data-v2-workspace-surface]')
    || document.querySelector('[data-v2-app]')
    || document.body;
}

function host(layer) {
  return layer?.querySelector('[data-event-view-host]') || null;
}

function unavailable(reason = '') {
  if (reason === 'occupied') return 'Это время уже занято.';
  if (reason === 'day-not-working' || reason === 'outside-working-time') {
    return 'Время находится вне рабочего графика.';
  }
  return 'Проверьте время события.';
}

function timeRangeValid(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start;
}

function timeLabel(from, to) {
  return `Время · С ${String(from || '—')} — До ${String(to || '—')}`;
}

function descriptionHtml(value = '') {
  return esc(value).replace(/\n/g, '<br>');
}

export function openEventView(eventOrId, { onClose = () => {}, eventActions = null } = {}) {
  const eventId = String(typeof eventOrId === 'object' ? eventOrId?.id : eventOrId || '');
  const customActions = eventActions && typeof eventActions.read === 'function' ? eventActions : null;
  const readCurrent = () => customActions ? customActions.read(eventId) : readEvent(eventId);
  let current = readCurrent();
  if (!current) return null;

  const layer = mountV2ZLayer(
    surface(),
    v2ZLayer('<div data-event-view-host></div>', { className: 'event-view-z' }),
    { stack: true, onClose },
  );
  if (!layer) return null;

  const openNotes = (source) => {
    if (customActions?.supportsNotes === false) return;
    const notes = getNotesForTarget('event', source.id);
    if (!notes.length) return;
    const noteDate = String(notes[0]?.date || source.date || '').slice(0, 10);
    layer.v2Close?.();
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent('book:journal-note-focus-request', {
        detail: {
          targetType: 'event',
          targetId: String(source.id || ''),
          date: noteDate,
          workplaceId: String(source.workplaceId || ''),
        },
      }));
    });
  };

  const renderRead = () => {
    current = readCurrent();
    const root = host(layer);
    if (!root || !current) return;
    const notesAvailable = customActions?.supportsNotes === false
      ? false
      : hasNotesForTarget('event', current.id);

    setV2ZHeaderRows(layer, [
      `<div class="record-creation-step-title">${esc(current.title || 'Событие')}</div>`,
    ]);

    root.innerHTML = `<section class="form-grid event-view">
      <div><strong>${esc(current.date)}</strong></div>
      <div><strong>С ${esc(current.from)} — До ${esc(current.to)}</strong></div>
      <div class="color-picker__swatch" style="background:${esc(current.color || '#777A7D')}" aria-label="Цвет события"></div>
      ${current.description ? `<div class="event-view__description">${descriptionHtml(current.description)}</div>` : ''}
      ${actionBlock([
        notesAvailable
          ? button('Заметки', { variant: 'secondary', data: 'data-event-notes' })
          : '',
        button('Изменить', { data: 'data-event-edit' }),
        button('Удалить событие', { data: 'data-event-delete', variant: 'danger' }),
      ].filter(Boolean).join(''))}
    </section>`;

    root.querySelector('[data-event-notes]')?.addEventListener('click', () => openNotes(current));
    root.querySelector('[data-event-edit]')?.addEventListener('click', openEdit);
    root.querySelector('[data-event-delete]')?.addEventListener('click', () => {
      const confirm = mountModal(document.body, modal(
        button('Удалить событие', { data: 'data-event-delete-confirm', variant: 'danger' }),
        { variant: 'x', title: 'Удалить событие' },
      ));
      confirm?.querySelector('[data-event-delete-confirm]')?.addEventListener('click', async (domEvent) => {
        const submit = domEvent.currentTarget;
        submit.disabled = true;
        if (customActions) {
          try {
            await customActions.remove?.(eventId);
            confirm.v2Close?.();
            layer.v2Close?.();
          } catch (error) {
            openNotice({
              title: 'Не удалось удалить событие',
              message: String(error?.message || 'Сервер не подтвердил удаление.'),
            });
            if (submit.isConnected) submit.disabled = false;
          }
          return;
        }

        const snapshot = { ...current };
        removeEvent(eventId);
        try {
          await flushBusinessPersistence();
          confirm.v2Close?.();
          layer.v2Close?.();
        } catch (error) {
          createEvent(snapshot);
          openNotice({
            title: 'Не удалось удалить событие',
            message: String(error?.message || 'Сервер не подтвердил удаление.'),
          });
          if (submit.isConnected) submit.disabled = false;
        }
      });
    });
  };

  const validateEditSelection = async (state, { from = state.from, to = state.to } = {}) => {
    if (!timeRangeValid(from, to)) {
      openNotice({ title: 'Событие', message: 'Проверьте время события.' });
      return false;
    }

    if (customActions) {
      if (typeof customActions.validate === 'function') {
        const availability = await customActions.validate({ ...state, from, to, excludeId: eventId });
        if (availability && availability.ok === false) {
          openNotice({ title: 'Событие', message: unavailable(availability.reason) });
          return false;
        }
      }
      return true;
    }

    const availability = checkTimeAvailability({
      date: state.date,
      workplaceId: state.workplaceId,
      from,
      to,
      excludeId: eventId,
    });
    if (!availability.ok) {
      openNotice({ title: 'Событие', message: unavailable(availability.reason) });
      return false;
    }
    return true;
  };

  function openEdit() {
    current = readCurrent();
    if (!current) return null;
    const before = { ...current };
    const state = { ...current };

    const editLayer = mountModal(document.body, modal(
      `<form class="form-grid" data-event-edit-form>
        ${field({ label: 'Наименование', name: 'title', value: state.title, required: true })}
        ${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 8 })}
        ${button(timeLabel(state.from, state.to), { variant: 'secondary', data: 'data-event-edit-time' })}
        <div class="color-picker__swatch" data-event-edit-color style="background:${esc(state.color || '#777A7D')}" aria-label="Цвет события"></div>
        ${actionBlock(`${button('Отмена', { data: 'data-event-edit-cancel', variant: 'secondary' })}${button('Сохранить', { type: 'submit' })}`)}
      </form>`,
      {
        variant: 'q',
        surface: 'app',
        title: current.title || 'Событие',
        className: 'event-edit-q',
      },
    ));
    if (!editLayer) return null;

    const form = editLayer.querySelector('[data-event-edit-form]');
    const timeButton = editLayer.querySelector('[data-event-edit-time]');
    const colorMark = editLayer.querySelector('[data-event-edit-color]');

    const capture = () => {
      if (!form) return;
      const data = new FormData(form);
      state.title = String(data.get('title') || '').trim();
      state.description = String(data.get('description') || '').trim();
    };

    form?.addEventListener('input', capture);
    form?.addEventListener('change', capture);

    timeButton?.addEventListener('click', () => {
      capture();
      openTimeRangeAction({
        from: state.from,
        to: state.to,
        title: 'Время события',
        validate: (range) => validateEditSelection(state, range),
        onSave: ({ from, to }) => {
          openColorPickerAction({
            value: state.color,
            title: 'Цвет события',
            confirm: true,
            onSelect: (color) => {
              state.from = from;
              state.to = to;
              state.color = color;
              if (timeButton) timeButton.textContent = timeLabel(state.from, state.to);
              if (colorMark) colorMark.style.background = state.color;
            },
          });
        },
      });
    });

    editLayer.querySelector('[data-event-edit-cancel]')?.addEventListener('click', () => editLayer.v2Close?.());

    form?.addEventListener('submit', async (domEvent) => {
      domEvent.preventDefault();
      capture();
      if (!state.title) {
        openNotice({ title: 'Событие', message: 'Укажите название события.' });
        return;
      }
      if (!(await validateEditSelection(state))) return;

      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      if (customActions) {
        try {
          await customActions.update?.(eventId, {
            title: state.title,
            description: state.description,
            color: state.color,
            from: state.from,
            to: state.to,
          });
          editLayer.v2Close?.();
          renderRead();
        } catch (error) {
          openNotice({
            title: 'Не удалось сохранить событие',
            message: String(error?.message || 'Сервер не подтвердил изменения.'),
          });
          if (submit?.isConnected) submit.disabled = false;
        }
        return;
      }

      updateEvent(eventId, {
        title: state.title,
        description: state.description,
        color: state.color,
        from: state.from,
        to: state.to,
      });
      try {
        await flushBusinessPersistence();
        editLayer.v2Close?.();
        renderRead();
      } catch (error) {
        updateEvent(eventId, before);
        openNotice({
          title: 'Не удалось сохранить событие',
          message: String(error?.message || 'Сервер не подтвердил изменения.'),
        });
        if (submit?.isConnected) submit.disabled = false;
      }
    });

    return editLayer;
  }

  renderRead();
  return layer;
}
