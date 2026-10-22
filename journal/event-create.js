import { colorPicker, field, initColorPickers, openNotice, openTimeRangeAction, textareaField } from '../ui/ui.js';
import { checkTimeAvailability, minutesToTime, timeToMinutes } from '../core/time/index.js';
import { createEvent } from '../core/event/index.js';

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

export function createJournalEventFlow({ owner, date, workplaceId, timeHint = '', onCreated = () => {} } = {}) {
  if (!owner) return null;
  const state = {
    date: String(date || '').slice(0, 10),
    workplaceId: String(workplaceId || ''),
    from: String(timeHint || ''),
    to: initialTo(timeHint),
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
    state.color = String(data.get('color') || state.color || '#777A7D');
  };

  const render = () => {
    const view = owner.render({
      step: 'event',
      title: 'Событие',
      body: `<form class="form-grid" data-event-create-form>
        ${field({ label: 'Название', name: 'title', value: state.title, required: true, placeholder: 'Перерыв, встреча, дорога…' })}
        <button type="button" class="people-action-btn" data-event-time>С ${state.from || '—'} — До ${state.to || '—'}</button>
        ${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 5, placeholder: 'Подробности события' })}
        ${colorPicker({ name: 'color', value: state.color })}
      </form>`,
      action: { label: 'Создать', data: 'data-event-create' },
    });
    if (!view) return;
    initColorPickers(view.body);
    const form = view.body.querySelector('[data-event-create-form]');
    form?.addEventListener('input', () => capture(view.body));
    form?.addEventListener('change', () => capture(view.body));
    view.body.querySelector('[data-event-time]')?.addEventListener('click', () => {
      capture(view.body);
      openTimeRangeAction({
        from: state.from || timeHint || '09:00',
        to: state.to || initialTo(state.from || timeHint),
        title: 'Время события',
        onSave: ({ from, to }) => { state.from = from; state.to = to; render(); },
      });
    });
    view.action?.addEventListener('click', () => {
      capture(view.body);
      if (!state.title) { openNotice('Событие', 'Укажите название события.'); return; }
      const availability = checkTimeAvailability({ date: state.date, workplaceId: state.workplaceId, from: state.from, to: state.to });
      if (!availability.ok) { openNotice('Событие', availabilityMessage(availability.reason)); return; }
      const created = createEvent({ ownerType: 'tenant', context: { scope: 'professional' }, date: state.date, workplaceId: state.workplaceId, from: state.from, to: state.to, title: state.title, description: state.description, color: state.color });
      owner.commit?.();
      onCreated?.(created);
    });
  };

  render();
  return { resume: render, getState: () => ({ ...state }) };
}
