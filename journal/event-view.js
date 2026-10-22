import { workspaceHeaderContext } from '../ui/header/index.js';
import { mountV2ZLayer, v2ZLayer } from '../ui/v2/index.js';
import { actionBlock } from '../ui/page/page.js';
import { button, colorPicker, field, initColorPickers, modal, mountModal, openNotice, openTimeRangeAction, textareaField } from '../ui/ui.js';
import { checkTimeAvailability } from '../core/time/index.js';
import { readEvent, removeEvent, updateEvent } from '../core/event/index.js';

function esc(value = '') { return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char])); }
function surface() { return document.querySelector('[data-v2-workspace-surface]') || document.querySelector('[data-v2-app]') || document.body; }
function host(layer) { return layer?.querySelector('[data-event-view-host]') || null; }
function unavailable(reason = '') { if (reason === 'occupied') return 'Это время уже занято.'; if (reason === 'day-not-working' || reason === 'outside-working-time') return 'Время находится вне рабочего графика.'; return 'Проверьте время события.'; }

export function openEventView(eventOrId, { onClose = () => {} } = {}) {
  const eventId = String(typeof eventOrId === 'object' ? eventOrId?.id : eventOrId || '');
  let current = readEvent(eventId);
  if (!current) return null;
  const header = workspaceHeaderContext({ title: 'Событие', hideD: true, a: { kind: 'avatar', label: 'Событие', disabled: true, aria: 'Событие' } });
  const layer = mountV2ZLayer(surface(), v2ZLayer(`${header}<div data-event-view-host></div>`, { className: 'event-view-z' }), { stack: true, onClose });
  if (!layer) return null;

  const renderRead = () => {
    current = readEvent(eventId);
    const root = host(layer);
    if (!root || !current) return;
    root.innerHTML = `<section class="form-grid event-view"><h2>${esc(current.title || 'Событие')}</h2><div><strong>${esc(current.date)}</strong></div><div><strong>С ${esc(current.from)} — До ${esc(current.to)}</strong></div>${current.description ? `<div class="muted">${esc(current.description)}</div>` : ''}<div class="color-picker__swatch" style="background:${esc(current.color || '#777A7D')}" aria-label="Цвет события"></div>${actionBlock(`${button('Изменить', { data: 'data-event-edit' })}${button('Удалить', { data: 'data-event-delete', variant: 'danger' })}`)}</section>`;
    root.querySelector('[data-event-edit]')?.addEventListener('click', renderEdit);
    root.querySelector('[data-event-delete]')?.addEventListener('click', () => {
      const confirm = mountModal(document.body, modal(button('Удалить', { data: 'data-event-delete-confirm', variant: 'danger' }), { variant: 'x', title: 'Удалить событие' }));
      confirm?.querySelector('[data-event-delete-confirm]')?.addEventListener('click', () => { removeEvent(eventId); confirm.v2Close?.(); layer.v2Close?.(); });
    });
  };

  const renderEdit = () => {
    current = readEvent(eventId);
    const root = host(layer);
    if (!root || !current) return;
    const state = { ...current };
    root.innerHTML = `<form class="form-grid" data-event-edit-form>${field({ label: 'Название', name: 'title', value: state.title, required: true })}<button type="button" class="people-action-btn" data-event-edit-time>С ${esc(state.from)} — До ${esc(state.to)}</button>${textareaField({ label: 'Описание', name: 'description', value: state.description, rows: 5 })}${colorPicker({ name: 'color', value: state.color })}${actionBlock(`${button('Сохранить', { type: 'submit' })}${button('Отмена', { data: 'data-event-edit-cancel', variant: 'secondary' })}`)}</form>`;
    initColorPickers(root);
    const form = root.querySelector('[data-event-edit-form]');
    const capture = () => { const data = new FormData(form); state.title = String(data.get('title') || '').trim(); state.description = String(data.get('description') || '').trim(); state.color = String(data.get('color') || state.color || '#777A7D'); };
    form?.addEventListener('input', capture);
    form?.addEventListener('change', capture);
    root.querySelector('[data-event-edit-time]')?.addEventListener('click', () => { capture(); openTimeRangeAction({ from: state.from, to: state.to, title: 'Время события', onSave: ({ from, to }) => { state.from = from; state.to = to; renderEdit(); } }); });
    root.querySelector('[data-event-edit-cancel]')?.addEventListener('click', renderRead);
    form?.addEventListener('submit', (domEvent) => {
      domEvent.preventDefault(); capture();
      if (!state.title) { openNotice('Событие', 'Укажите название события.'); return; }
      const availability = checkTimeAvailability({ date: state.date, workplaceId: state.workplaceId, from: state.from, to: state.to, excludeId: eventId });
      if (!availability.ok) { openNotice('Событие', unavailable(availability.reason)); return; }
      updateEvent(eventId, { title: state.title, description: state.description, color: state.color, from: state.from, to: state.to });
      renderRead();
    });
  };

  renderRead();
  return layer;
}
