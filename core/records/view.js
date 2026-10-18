import {
  actionBlock,
  button,
  durationText,
  modal,
  mountModal,
  mountRecordZ,
  openNotice,
  recordConfirmationMiniCard,
  recordZHost,
} from '../../ui/ui.js';
import { setV2ZHeaderRows } from '../../ui/v2/z-layout.js';
import { getWorkplaces } from '../workplace-time.js';
import { personDisplay } from '../people/presentation.js';
import { getRecordPaymentState, recordAmountDue } from '../finance/index.js';
import { openRecordPayment } from '../payment/record-payment.js';
import { openRecordSale } from '../sale/sale.js';
import {
  cancelRecord,
  deleteRecord,
  getRecord,
  refreshRecordsFromServer,
  setRecordAttendance,
  setRecordConfirmed,
} from '../record/index.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { openRecords } from './records.js';

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function workplaceName(id) {
  const workplace = getWorkplaces().find((item) => String(item?.key ?? item?.id ?? '') === String(id || ''));
  return workplace?.name || workplace?.title || 'Рабочее пространство';
}

function normalizedAttendance(value) {
  return value === 'arrived' || value === 'no-show' ? value : '';
}

function appointmentStart(record = {}) {
  const date = String(record?.date || '').slice(0, 10);
  const time = String(record?.from || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

function hasAppointmentStarted(record = {}) {
  const start = appointmentStart(record);
  return Boolean(start && Date.now() >= start.getTime());
}

function actionSheet({ cancelled = false } = {}) {
  return actionBlock([
    !cancelled ? button('Корректировка', { variant: 'secondary', data: 'data-record-view-correct' }) : '',
    !cancelled ? button('Отмена', { variant: 'danger', data: 'data-record-view-cancel' }) : '',
    button('Удалить', { variant: 'critical', data: 'data-record-view-delete' }),
  ].filter(Boolean).join(''));
}

export function openRecordView(record, { onClose = () => {} } = {}) {
  if (!record?.id) return null;

  let currentRecord = getRecord(record.id) || record;
  let startTimer = null;
  const layer = mountRecordZ({
    settings: false,
    title: personDisplay(currentRecord.person || {}).name || 'Запись',
    className: 'record-view-z journal-view-z',
    onClose: () => {
      if (startTimer) clearTimeout(startTimer);
      startTimer = null;
      onClose();
    },
  });
  if (!layer) return null;

  const root = recordZHost(layer);

  const syncCurrent = () => {
    currentRecord = getRecord(currentRecord.id) || currentRecord;
    return currentRecord;
  };

  const persistAndRefresh = async () => {
    await flushBusinessPersistence();
    await refreshRecordsFromServer();
    syncCurrent();
  };

  const persistStatus = async (mutate, message) => {
    const updated = mutate();
    if (!updated) return;
    currentRecord = updated;
    render();
    try {
      await persistAndRefresh();
      render();
    } catch (error) {
      await refreshRecordsFromServer().catch(() => null);
      syncCurrent();
      render();
      openNotice({ title: 'Не удалось сохранить', message: String(error?.message || message) });
    }
  };

  const confirmCancel = (source) => {
    const confirm = mountModal(document.body, modal(
      `<div class="modal-title"><h2>Отменить?</h2><p>Запись останется в истории, время освободится.</p></div>${actionBlock([
        button('Нет', { variant: 'secondary', data: 'data-record-view-cancel-no' }),
        button('Отмена', { variant: 'danger', data: 'data-record-view-cancel-yes' }),
      ].join(''))}`,
      { variant: 'x', surface: 'app', title: 'Отмена' },
    ));
    if (!confirm) return;
    confirm.querySelector('[data-record-view-cancel-no]')?.addEventListener('click', () => confirm.v2Close?.());
    confirm.querySelector('[data-record-view-cancel-yes]')?.addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      submit.disabled = true;
      if (!cancelRecord(source.id)) {
        submit.disabled = false;
        return;
      }
      try {
        await persistAndRefresh();
        confirm.v2Close?.();
        layer.v2Close?.();
      } catch (error) {
        await refreshRecordsFromServer().catch(() => null);
        openNotice({ title: 'Не удалось отменить', message: String(error?.message || 'Сервер не подтвердил отмену.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  const confirmDelete = (source) => {
    const confirm = mountModal(document.body, modal(
      `<div class="modal-title"><h2>Удалить?</h2><p>Запись и её история будут удалены без восстановления.</p></div>${actionBlock(
        button('Удалить', { variant: 'critical', data: 'data-record-view-delete-confirm' }),
      )}`,
      { variant: 'x', surface: 'app', title: 'Удалить' },
    ));
    if (!confirm) return;
    confirm.querySelector('[data-record-view-delete-confirm]')?.addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      submit.disabled = true;
      if (!deleteRecord(source.id)) {
        submit.disabled = false;
        return;
      }
      try {
        await flushBusinessPersistence();
        await refreshRecordsFromServer();
        confirm.v2Close?.();
        layer.v2Close?.();
      } catch (error) {
        await refreshRecordsFromServer().catch(() => null);
        openNotice({ title: 'Не удалось удалить', message: String(error?.message || 'Сервер не подтвердил удаление.') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  const openActions = () => {
    const source = syncCurrent();
    const actions = mountModal(document.body, modal(
      actionSheet({ cancelled: source.status === 'cancelled' }),
      { variant: 'x', surface: 'app' },
    ));
    if (!actions) return;

    actions.querySelector('[data-record-view-correct]')?.addEventListener('click', () => {
      actions.v2Close?.();
      const latest = syncCurrent();
      openRecords({
        context: 'professional',
        record: latest,
        professionalActions: true,
        onSaved: async (saved) => {
          currentRecord = saved;
          render();
          try {
            await persistAndRefresh();
            render();
          } catch (error) {
            await refreshRecordsFromServer().catch(() => null);
            syncCurrent();
            render();
            openNotice({ title: 'Не удалось сохранить', message: String(error?.message || 'Сервер не подтвердил изменения.') });
          }
        },
      });
    });

    actions.querySelector('[data-record-view-cancel]')?.addEventListener('click', () => {
      actions.v2Close?.();
      confirmCancel(source);
    });

    actions.querySelector('[data-record-view-delete]')?.addEventListener('click', () => {
      actions.v2Close?.();
      confirmDelete(source);
    });
  };

  const scheduleStartRender = (source) => {
    if (startTimer) clearTimeout(startTimer);
    startTimer = null;
    const start = appointmentStart(source);
    if (!start) return;
    const delay = start.getTime() - Date.now();
    if (delay <= 0) return;
    startTimer = setTimeout(() => {
      startTimer = null;
      if (layer.isConnected) render();
    }, Math.min(delay + 50, 2147483647));
  };

  const render = () => {
    const source = syncCurrent();
    scheduleStartRender(source);
    const person = personDisplay(source.person || {});
    const procedures = Array.isArray(source.procedures) ? source.procedures : [];
    const products = Array.isArray(source.products) ? source.products : [];
    const totalDuration = procedures.reduce((sum, item) => sum + (Number(item?.duration) || 0), 0);
    const payment = getRecordPaymentState(source);
    const discountPercent = Number(source?.finance?.discountPercent || 0);
    const card = recordConfirmationMiniCard({
      workplace: workplaceName(source.workplaceId),
      date: formatDate(source.date),
      period: `${source.from || ''} - ${source.to || ''}`,
      uei: person.uei || '',
      name: person.name || 'Запись',
      phone: person.phone || '',
      groupText: source.group ? `Участники: ${Array.isArray(source.group?.participants) ? source.group.participants.length : 0} / ${Math.max(2, Math.floor(Number(source.group?.capacity) || 2))}` : '',
      duration: durationText(totalDuration || 30),
      discount: discountPercent > 0 ? `${discountPercent}%` : '0%',
      total: formatMoney(recordAmountDue(source)),
      procedures: [
        ...procedures.map((item) => ({
          name: item?.name || '',
          durationText: durationText(Number(item?.duration) || 0),
          right: item?.cost === '' || item?.cost == null ? '' : formatMoney(item.cost),
        })),
        ...products.map((item) => ({
          name: item?.name || '',
          right: item?.cost === '' || item?.cost == null ? '' : formatMoney(item.cost),
        })),
      ],
    });

    const started = hasAppointmentStarted(source);
    const effectiveAttendance = normalizedAttendance(source.attendance) || (started ? 'arrived' : '');
    const confirmedControl = `<div class="segment-control segment-control--one" role="group" aria-label="Подтверждение записи">
      <button type="button" class="${payment.fullyPaid || source.confirmed ? 'is-active' : ''}" aria-pressed="${payment.fullyPaid || Boolean(source.confirmed)}" data-record-view-confirmed${payment.fullyPaid ? ' disabled' : ''}>Подтвердил</button>
    </div>`;
    const attendanceControl = `<div class="segment-control segment-control--two-equal" role="group" aria-label="Посещение записи">
      <button type="button" class="${effectiveAttendance === 'arrived' ? 'is-active' : ''}" aria-pressed="${effectiveAttendance === 'arrived'}" data-record-view-attendance="arrived"${!started ? ' disabled' : ''}>Пришел</button>
      <button type="button" class="${effectiveAttendance === 'no-show' ? 'is-active' : ''}" aria-pressed="${effectiveAttendance === 'no-show'}" data-record-view-attendance="no-show"${!started ? ' disabled' : ''}>Не пришел</button>
    </div>`;
    setV2ZHeaderRows(layer, [confirmedControl, attendanceControl]);

    root.innerHTML = `<div class="record-screen record-screen--state-view record-screen--record-view">
      <div role="button" tabindex="0" data-record-view-actions>${card}</div>
      <div class="record-view-actions">
        ${payment.fullyPaid ? '' : button('Продажа', { variant: 'secondary', data: 'data-record-view-sale' })}
        ${button(payment.fullyPaid ? 'Оплачено' : `К оплате: ${formatMoney(payment.remaining)}`, { variant: payment.fullyPaid ? 'secondary' : '', data: 'data-record-view-payment' })}
      </div>
    </div>`;
    const cardButton = root.querySelector('[data-record-view-actions]');
    cardButton?.addEventListener('click', openActions);
    cardButton?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openActions();
    });
    root.querySelector('[data-record-view-sale]')?.addEventListener('click', () => {
      openRecordSale(syncCurrent(), {
        onSaved: (saved) => {
          currentRecord = saved;
          render();
        },
      });
    });
    root.querySelector('[data-record-view-payment]')?.addEventListener('click', () => {
      openRecordPayment(syncCurrent());
    });

    layer.querySelector('[data-record-view-confirmed]')?.addEventListener('click', () => {
      if (payment.fullyPaid) return;
      persistStatus(
        () => setRecordConfirmed(source.id, !Boolean(source.confirmed)),
        'Сервер не подтвердил изменение статуса.',
      );
    });
    layer.querySelectorAll('[data-record-view-attendance]').forEach((node) => node.addEventListener('click', () => {
      if (!hasAppointmentStarted(source)) return;
      const next = normalizedAttendance(node.dataset.recordViewAttendance);
      const current = normalizedAttendance(source.attendance) || 'arrived';
      if (!next || next === current) return;
      persistStatus(
        () => setRecordAttendance(source.id, next),
        'Сервер не подтвердил изменение посещения.',
      );
    }));

    layer.dataset.recordViewPaymentState = payment.fullyPaid ? 'paid' : payment.partiallyPaid ? 'partial' : 'unpaid';
  };

  render();
  return layer;
}
