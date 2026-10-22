import { emptyState, openNotice, recordCreationTimeRows } from '../ui/ui.js';
import {
  checkTimeAvailability,
  getTimeAvailabilityAt,
  listAvailableEndTimes,
  minutesToTime,
  timeToMinutes,
} from '../core/time/index.js';
import { createJournalBreak } from './break-service.js';

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function startRows({ date, workplaceId, hint }) {
  const anchor = timeToMinutes(hint);
  if (anchor == null) return [];
  const hour = Math.floor(anchor / 60) * 60;
  return [hour, hour + 30]
    .map((minute) => minutesToTime(minute))
    .filter(Boolean)
    .map((value) => {
      const availability = getTimeAvailabilityAt({ date, workplaceId, time: value });
      return {
        value,
        label: value,
        from: value,
        available: availability?.state === 'free',
        occupied: availability?.state === 'occupied',
        state: availability?.state || 'unavailable',
      };
    });
}

export function createJournalBreakFlow({
  owner,
  date = '',
  workplaceId = '',
  timeHint = '',
  onCreated = () => {},
} = {}) {
  if (!owner) return null;
  const state = {
    date: dateKey(date),
    workplaceId: String(workplaceId || ''),
    timeHint: String(timeHint || ''),
    from: '',
    to: '',
  };
  let currentRenderer = null;

  const renderStart = () => {
    currentRenderer = renderStart;
    const rows = startRows(state);
    const view = owner.render({
      step: 'time',
      body: `<div class="record-screen record-screen--time">${rows.length
        ? recordCreationTimeRows(rows, { data: 'data-journal-break-start', selected: state.from })
        : emptyState('Свободного времени нет', 'На эту дату нет доступного времени.')}</div>`,
    });
    view?.body?.querySelectorAll('[data-journal-break-start]:not(:disabled)').forEach((node) => node.addEventListener('click', () => {
      const value = String(node.dataset.journalBreakStart || '');
      if (!value) return;
      state.from = value;
      state.to = '';
      renderEnd();
    }));
  };

  const renderEnd = () => {
    currentRenderer = renderEnd;
    const values = listAvailableEndTimes({
      date: state.date,
      workplaceId: state.workplaceId,
      from: state.from,
      step: 5,
    });
    const view = owner.render({
      step: 'break-end',
      body: recordCreationTimeRows(values, { data: 'data-journal-break-end', empty: 'Свободного времени нет.' }),
    });
    view?.body?.querySelectorAll('[data-journal-break-end]:not(:disabled)').forEach((node) => node.addEventListener('click', () => {
      state.to = String(node.dataset.journalBreakEnd || '');
      renderConfirmation();
    }));
  };

  const renderConfirmation = () => {
    currentRenderer = renderConfirmation;
    const view = owner.render({
      step: 'break-confirmation',
      body: `<div class="record-screen record-screen--state-view">
        <div class="mini-card record-break-mini-card">
          <strong>Перерыв</strong><span>${formatDate(state.date)}</span><span>${state.from} - ${state.to}</span>
        </div>
      </div>`,
      action: { label: 'Подтвердить', data: 'data-journal-break-confirm' },
    });
    view?.layer?.querySelector('[data-journal-break-confirm]')?.addEventListener('click', () => {
      const available = checkTimeAvailability({
        date: state.date,
        workplaceId: state.workplaceId,
        from: state.from,
        to: state.to,
      });
      if (!available.ok) {
        openNotice({ title: 'Перерыв', message: available.reason === 'occupied' ? 'Это время уже занято.' : 'Это время находится вне рабочего периода.' });
        return;
      }
      const created = createJournalBreak({
        workplaceId: state.workplaceId,
        date: state.date,
        from: state.from,
        to: state.to,
      });
      if (!created) return;
      owner.commit();
      onCreated(created);
    });
  };

  renderStart();
  return {
    resume() {
      currentRenderer?.();
    },
    getState() {
      return { ...state };
    },
  };
}
