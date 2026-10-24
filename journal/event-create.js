import { button, field, openColorPickerAction, openNotice, openTimeRangeAction, textareaField } from '../ui/ui.js';
import { checkTimeAvailability, minutesToTime, timeToMinutes } from '../core/time/index.js';
import { createEvent, removeEvent } from '../core/event/index.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';

function initialTo(from) {
  const minute = timeToMinutes(from);
  if (minute == null) return '09:30';
  const next = minute + 30;
  return minutesToTime(next < 24 * 60 ? next : next - 24 * 60) || '09:30';
}

function availabilityMessage(reason = '') {
  if (reason === 'occupied') return 'Это время уже занято.';
  if (reason === 'day-not-working' || reason === 'outside-working-time') return 'Время находится вне рабочего графика.';
  return 'Проверьте время события.';
}

function timeRangeValid(from, to) {
  const start = timeToMinutes(from);
  const end = timeToMinutes(to);
  return start != null && end != null && end > start;
}

function growDescription(form) {
  const textarea = form?.elements?.namedItem?.('description');
  if (!(textarea instanceof HTMLTextAreaElement)) return;
  textarea.style.overflowY = 'hidden';
  textarea.style.resize = 'none';
  textarea.style.minHeight = '220px';
  const resize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.max(220, textarea.scrollHeight)}px`;
  };
  textarea.addEventListener('input', resize);
  resize();
}

function timeLabel(from, to) {
  return `Время · С ${String(from || '—')} — До ${String(to || '—')}`;
}

function colorSwatch(color) {
  return `<div class="color-picker__swatch" style="background:${String(color || '#777A7D')}" aria-label="Цвет события"></div>`;
}

export function createJournalEventFlow({ owner, date, workplaceId, timeHint = '', eventActions = null, onCreated = () => {} } = {}) {
  if (!owner) return null;
  const customActions = eventActions && typeof eventActions.create === 'function' ? eventActions : null;
  const initialFrom = String(timeHint || '09:00');
  const state = {
    date: String(date || '').slice(0, 10),
    workplaceId: String(workplaceId || ''),
    from: initialFrom,
    to: initialTo(initialFrom),
    title: '',
    description: '',
    color: '#777A7D',
  };

  const capture = (root) => {
    const form = root?.querySelector('[data-event-create-form]');
    if (!form) return;
    const data = new FormData(form);
    state.title = String(data.get('title') || '').trim();
    state.description = String(data.get('description') || '').trim();
  };

  const validateSelection = async ({ from = state.from, to = state.to } = {}) => {
    if (!timeRangeValid(from, to)) {
      openNotice({ title: 'Событие', message: 'Проверьте время события.' });
      return false;
    }
    if (!customActions) {
      const availability = checkTimeAvailability({
        date: state.date,
        workplaceId: state.workplaceId,
        from,
        to,
      });
      if (!availability.ok) {
        openNotice({ title: 'Событие', message: availabilityMessage(availability.reason) });
        return false;
      }
      return true;
    }
    if (typeof customActions.validate === 'function') {
      const availability = await customActions.validate({ ...state, from, to });
      if (availability && availability.ok === false) {
        openNotice({ title: 'Событие', message: availabilityMessage(availability.reason) });
        return false;
      }
    }
    return true;
  };

  const render = () => {
    const view = owner.render({
      step: 'event',
      title: false,
      body: `<form class="form-grid" data-event-create-form>
        ${field({ label: 'Наименование', name: 'title', value: state.title, required: true, placeholder: 'Перерыв, встреча, дорога…' })}
        ${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 12, placeholder: 'Подробности события' })}
        ${button(timeLabel(state.from, state.to), { variant: 'secondary', data: 'data-event-create-time' })}
        ${colorSwatch(state.color)}
      </form>`,
      action: { label: 'Создать', data: 'data-event-create' },
    });
    if (!view) return;

    const form = view.body.querySelector('[data-event-create-form]');
    growDescription(form);
    form?.addEventListener('input', () => capture(view.body));
    form?.addEventListener('change', () => capture(view.body));

    view.body.querySelector('[data-event-create-time]')?.addEventListener('click', () => {
      capture(view.body);
      openTimeRangeAction({
        from: state.from,
        to: state.to,
        title: 'Время события',
        validate: validateSelection,
        onSave: ({ from, to }) => {
          openColorPickerAction({
            value: state.color,
            title: 'Цвет события',
            confirm: true,
            onSelect: (color) => {
              state.from = from;
              state.to = to;
              state.color = color;
              render();
            },
          });
        },
      });
    });

    view.action?.addEventListener('click', async (domEvent) => {
      capture(view.body);
      if (!state.title) {
        openNotice({ title: 'Событие', message: 'Укажите название события.' });
        return;
      }
      if (!(await validateSelection())) return;

      const submit = domEvent.currentTarget;
      submit.disabled = true;
      if (customActions) {
        try {
          const created = await customActions.create({
            date: state.date,
            from: state.from,
            to: state.to,
            title: state.title,
            description: state.description,
            color: state.color,
          });
          owner.commit?.();
          onCreated?.(created);
        } catch (error) {
          openNotice({ title: 'Не удалось создать событие', message: String(error?.message || 'Сервер не подтвердил сохранение.') });
          if (submit.isConnected) submit.disabled = false;
        }
        return;
      }

      const created = createEvent({
        ownerType: 'tenant',
        context: { scope: 'professional' },
        date: state.date,
        workplaceId: state.workplaceId,
        from: state.from,
        to: state.to,
        title: state.title,
        description: state.description,
        color: state.color,
      });
      try {
        await flushBusinessPersistence();
        owner.commit?.();
        onCreated?.(created);
      } catch (error) {
        removeEvent(created.id);
        openNotice({ title: 'Не удалось создать событие', message: String(error?.message || 'Сервер не подтвердил сохранение.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  render();
  return { resume: render, getState: () => ({ ...state }) };
}
