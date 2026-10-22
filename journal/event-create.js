import { colorPicker, field, initColorPickers, initTimePickers, openNotice, textareaField, timePicker } from '../ui/ui.js';
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
    state.from = String(data.get('from') || state.from || '');
    state.to = String(data.get('to') || state.to || '');
    state.color = String(data.get('color') || state.color || '#777A7D');
    state.title = String(data.get('title') || '').trim();
    state.description = String(data.get('description') || '').trim();
  };

  const render = () => {
    const view = owner.render({
      step: 'event',
      title: false,
      body: `<form class="form-grid" data-event-create-form>
        <div class="time-range-fields">
          ${timePicker({ label: 'С', name: 'from', value: state.from || timeHint || '09:00' })}
          ${timePicker({ label: 'До', name: 'to', value: state.to || initialTo(state.from || timeHint) })}
        </div>
        ${colorPicker({ name: 'color', value: state.color })}
        ${field({ label: 'Наименование', name: 'title', value: state.title, required: true, placeholder: 'Перерыв, встреча, дорога…' })}
        ${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 12, placeholder: 'Подробности события' })}
      </form>`,
      action: { label: 'Создать', data: 'data-event-create' },
    });
    if (!view) return;
    initTimePickers(view.body);
    initColorPickers(view.body);
    const form = view.body.querySelector('[data-event-create-form]');
    growDescription(form);
    form?.addEventListener('input', () => capture(view.body));
    form?.addEventListener('change', () => capture(view.body));
    view.action?.addEventListener('click', async (domEvent) => {
      capture(view.body);
      if (!state.title) { openNotice({ title: 'Событие', message: 'Укажите название события.' }); return; }
      const availability = checkTimeAvailability({ date: state.date, workplaceId: state.workplaceId, from: state.from, to: state.to });
      if (!availability.ok) { openNotice({ title: 'Событие', message: availabilityMessage(availability.reason) }); return; }
      const submit = domEvent.currentTarget;
      submit.disabled = true;
      const created = createEvent({ ownerType: 'tenant', context: { scope: 'professional' }, date: state.date, workplaceId: state.workplaceId, from: state.from, to: state.to, title: state.title, description: state.description, color: state.color });
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
