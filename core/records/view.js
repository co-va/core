import {
  actionBlock,
  bindRecordSettings,
  button,
  durationText,
  modal,
  mountModal,
  mountRecordZ,
  openNotice,
  recordConfirmationMiniCard,
  recordZHost,
  select,
} from '../../ui/ui.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';
import { setV2ZHeaderRows } from '../../ui/v2/z-layout.js';
import { getWorkplaces } from '../workplace-time.js';
import { getAllPeople } from '../people/data.js';
import { openPersonHistoryQ } from '../people/people.js';
import { personDisplay } from '../people/presentation.js';
import { getRecordPaymentState, resolveRecordSettlement } from '../finance/index.js';
import { getRecordProgramOptions, recordProgramSelection } from '../loyalty/record-program.js';
import { normalizeWorkplaceTimeZone, zonedDateTimeParts } from '../time/index.js';
import { openRecordPayment } from '../payment/record-payment.js';
import { openRecordPaymentActions } from '../payment/record-payment.js';
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
import { getNotesForTarget, hasNotesForTarget } from '../note/index.js';
import { openProcedureAdjustment, openRecords } from './records.js';
import { setRecordLoyaltyProgram } from './program-selection.js';

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function workplaceForId(id) {
  return getWorkplaces().find((item) => String(item?.key ?? item?.id ?? '') === String(id || '')) || null;
}

function workplaceName(id) {
  const workplace = workplaceForId(id);
  return workplace?.name || workplace?.title || 'Рабочее пространство';
}

function formatReportRubles(value = 0) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `${amount.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} р.`;
}

function formatReportNumber(value = 0) {
  const number = Math.max(0, Number(value) || 0);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(number).replaceAll('\u00a0', ' ');
}

function timeMinutes(value = '') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function recordDurationHours(record = null) {
  const from = timeMinutes(record?.from);
  const to = timeMinutes(record?.to);
  if (from == null || to == null || to <= from) return 0;
  return (to - from) / 60;
}

function recordWorkplaceTimeZone(record = null) {
  const workplace = workplaceForId(record?.workplaceId);
  return normalizeWorkplaceTimeZone(workplace?.timeZone || '');
}

function recordHasEnded(record = null, now = new Date()) {
  const date = String(record?.date || '').slice(0, 10);
  const to = String(record?.to || record?.from || '').slice(0, 5);
  if (!date || !/^\d{2}:\d{2}$/.test(to)) return false;
  const current = zonedDateTimeParts(now, recordWorkplaceTimeZone(record));
  if (!current?.date || !/^\d{2}:\d{2}$/.test(current?.time || '')) return false;
  return `${current.date}T${current.time}` >= `${date}T${to}`;
}

function recordReportStatusRows(record, state) {
  const paidTotal = Math.max(0, Number(state?.paidTotal) || 0);
  const remaining = Math.max(0, Number(state?.remaining) || 0);
  if (remaining <= 0.009) return [{ label: 'Статус', value: 'Оплачено' }];
  const outstandingLabel = recordHasEnded(record) ? 'Задолженность' : 'К оплате';
  if (paidTotal > 0.009) {
    return [
      { label: 'Оплачено', value: formatReportRubles(paidTotal) },
      { label: outstandingLabel, value: formatReportRubles(remaining) },
    ];
  }
  return [{ label: 'Статус', value: outstandingLabel }];
}

function openRecordZReport(record) {
  const current = getRecord(record?.id) || record;
  if (!current?.id) return null;
  const settlement = resolveRecordSettlement(current);
  const state = getRecordPaymentState(current);
  const procedures = Array.isArray(current?.procedures) ? current.procedures : [];
  const procedureCount = procedures.length;
  const hours = recordDurationHours(current);
  const total = Math.max(0, Number(settlement?.planTotal) || 0);
  const averageProcedure = procedureCount ? total / procedureCount : 0;
  const averageHour = hours ? total / hours : 0;
  const date = String(current?.date || '').slice(0, 10);
  const dateLabel = date ? new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU') : '';
  const groups = [
    [
      { label: workplaceName(current?.workplaceId), value: dateLabel },
      { label: 'Кол-во процедур', value: String(procedureCount) },
      { label: 'Кол-во часов', value: formatReportNumber(hours) },
      { label: 'Средний чек процедуры', value: formatReportRubles(averageProcedure) },
      { label: 'Средний чек часа', value: formatReportRubles(averageHour) },
    ],
    recordReportStatusRows(current, state),
    [{ label: 'Сумма', value: formatReportRubles(total), strong: true }],
  ];
  return mountModal(document.body, modal(readOnlyReceipt({
    title: 'Z - Отчет',
    groups,
  }), { variant: 's', surface: 'app', title: 'Z - Отчет' }));
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

const RECORD_VIEW_CAPABILITIES = Object.freeze({
  professional: Object.freeze({
    settings: true,
    personHistory: true,
    contactIdentity: true,
    loyaltyProgram: true,
    procedureSettings: true,
    zReport: true,
    sale: true,
    payment: true,
    confirmation: true,
    attendance: true,
    notes: true,
  }),
  account: Object.freeze({
    settings: false,
    personHistory: false,
    contactIdentity: false,
    loyaltyProgram: false,
    procedureSettings: false,
    zReport: false,
    sale: false,
    payment: false,
    confirmation: false,
    attendance: false,
    notes: false,
  }),
});

function recordViewCapabilities(context = 'professional') {
  return String(context || '').trim().toLowerCase() === 'account'
    ? RECORD_VIEW_CAPABILITIES.account
    : RECORD_VIEW_CAPABILITIES.professional;
}

function accountProfessionalDisplay(professional = null) {
  if (!professional || typeof professional !== 'object' || Array.isArray(professional)) {
    return { name: '', phone: '', uei: '', photo: '', initials: '' };
  }
  const display = personDisplay(professional);
  const name = [professional?.name, professional?.surname].filter(Boolean).join(' ').trim();
  const initials = [professional?.name, professional?.surname]
    .filter(Boolean)
    .map((value) => String(value).trim().slice(0, 1))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    name,
    phone: display.phone || '',
    uei: String(professional?.uei || ''),
    photo: String(professional?.photo || ''),
    initials,
  };
}

function actionSheet({ cancelled = false } = {}) {
  return actionBlock([
    !cancelled ? button('Корректировка', { variant: 'secondary', data: 'data-record-view-correct' }) : '',
    !cancelled ? button('Отмена', { variant: 'danger', data: 'data-record-view-cancel' }) : '',
    button('Удалить', { variant: 'critical', data: 'data-record-view-delete' }),
    button('История', { variant: 'secondary', data: 'data-record-view-history' }),
  ].filter(Boolean).join(''));
}

export function openRecordView(record, {
  onClose = () => {},
  context = 'professional',
  professional = null,
} = {}) {
  if (!record?.id) return null;

  const capabilities = recordViewCapabilities(context);
  const professionalDisplay = accountProfessionalDisplay(professional);
  let currentRecord = getRecord(record.id) || record;
  let startTimer = null;
  const layer = mountRecordZ({
    settings: capabilities.settings,
    title: capabilities.contactIdentity
      ? (personDisplay(currentRecord.person || {}).name || 'Запись')
      : (professionalDisplay.name || 'Запись'),
    className: 'record-view-z journal-view-z',
    ...(capabilities.contactIdentity ? {} : {
      aImage: professionalDisplay.photo,
      aInitials: professionalDisplay.initials,
    }),
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

  const historyPerson = (source) => {
    const personKey = String(source?.person?.key || source?.person?.id || '').trim();
    const person = getAllPeople().find((item) => String(item?.key || item?.id || '').trim() === personKey)
      || source?.person
      || {};
    return person?.key ? person : { ...person, key: personKey };
  };

  const openHistory = (source = syncCurrent()) => {
    if (!capabilities.personHistory) return null;
    const person = historyPerson(source);
    if (!String(person?.key || '').trim()) return null;
    return openPersonHistoryQ(document.body, person);
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
    if (!capabilities.settings) return;
    const source = syncCurrent();
    const paymentState = getRecordPaymentState(source);
    if (paymentState.hasPayments) {
      const actions = openRecordPaymentActions(source, {
        onSaved: () => {
          syncCurrent();
          render();
        },
        extraActions: capabilities.personHistory
          ? button('История', { variant: 'secondary', data: 'data-record-view-history' })
          : '',
      });
      actions?.querySelector('[data-record-view-history]')?.addEventListener('click', () => {
        actions.v2Close?.();
        void openHistory(source);
      });
      return;
    }
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

    actions.querySelector('[data-record-view-history]')?.addEventListener('click', () => {
      actions.v2Close?.();
      void openHistory(source);
    });
  };

  if (capabilities.settings) bindRecordSettings(layer, openActions);

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
    const payment = getRecordPaymentState(source);
    const settlement = resolveRecordSettlement(source);
    const settlementByProcedure = new Map((Array.isArray(settlement?.items) ? settlement.items : [])
      .filter((item) => String(item?.sourceType || 'procedure') === 'procedure')
      .map((item) => [String(item?.sourceId || ''), item]));
    const personKey = String(source?.person?.key || source?.person?.id || '').trim();
    const contact = capabilities.contactIdentity
      ? (getAllPeople().find((item) => String(item?.key || item?.id || '').trim() === personKey) || source.person || {})
      : (source.person || {});
    const programOptions = capabilities.loyaltyProgram ? getRecordProgramOptions(personKey) : [];
    const selectedProgramKey = String(source?.loyaltyProgram?.key || '');
    const programControl = capabilities.loyaltyProgram && programOptions.length ? select({
      label: 'Программа',
      name: 'recordLoyaltyProgram',
      value: selectedProgramKey,
      options: [
        { value: '', label: 'Не выбрано' },
        ...programOptions.map((item) => ({ value: item.key, label: item.name, meta: item.typeLabel })),
      ],
      data: 'data-record-view-program',
      aria: 'Выбрать программу записи',
    }) : '';
    const contactDiscountPercent = Math.max(0, Math.min(100, Number(contact?.discountPercent) || 0));
    const discountMoney = Math.max(0, (Number(settlement?.serviceTotal) || 0) - (Number(settlement?.planTotal) || 0));
    const grossTotal = Math.max(0, Number(settlement?.serviceTotal) || 0);
    const fromMinutes = timeMinutes(source.from);
    const toMinutes = timeMinutes(source.to);
    const appointmentMinutes = fromMinutes != null && toMinutes != null && toMinutes > fromMinutes
      ? toMinutes - fromMinutes
      : procedures.reduce((sum, item) => sum + (Number(item?.duration) || 0), 0);
    const identity = capabilities.contactIdentity
      ? [
        String(person.uei || '').trim(),
        String(source?.person?.name || '').trim(),
        String(source?.person?.surname || '').trim(),
      ].filter(Boolean).join('; ')
      : [String(professionalDisplay.uei || '').trim(), professionalDisplay.name].filter(Boolean).join('; ');
    const card = recordConfirmationMiniCard({
      workplace: workplaceName(source.workplaceId),
      contactDiscount: contactDiscountPercent > 0 ? `${contactDiscountPercent}%` : '',
      date: formatDate(source.date),
      period: `${source.from || ''} - ${source.to || ''}`,
      identity,
      phone: capabilities.contactIdentity ? (person.phone || '') : professionalDisplay.phone,
      duration: durationText(appointmentMinutes),
      discountMoney: discountMoney > 0.009 ? formatMoney(discountMoney) : '',
      total: formatMoney(grossTotal),
      programControl,
      procedures: [
        ...procedures.map((item) => {
          const financeItem = settlementByProcedure.get(String(item?.id || ''));
          return {
            name: item?.name || 'Процедура',
            durationText: durationText(Number(item?.duration) || 0),
            right: formatMoney(financeItem?.planAmount ?? item?.cost ?? 0),
            ...(capabilities.procedureSettings && !payment.hasPayments ? {
              action: {
                data: 'data-record-view-procedure-settings',
                aria: `Настроить ${item?.name || 'процедуру'}`,
                label: '⚙',
              },
            } : {}),
          };
        }),
        ...products.map((item) => ({
          name: item?.name || 'Товар',
          secondary: 'Товар',
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
    setV2ZHeaderRows(layer, [
      capabilities.confirmation ? confirmedControl : '',
      capabilities.attendance ? attendanceControl : '',
    ].filter(Boolean));

    const paymentStateLabel = payment.fullyPaid
      ? 'Оплачено'
      : `${recordHasEnded(source) ? 'Задолженность' : 'К оплате'}: ${formatMoney(payment.remaining)}`;
    root.innerHTML = `<div class="record-screen record-screen--state-view record-screen--record-view">
      ${card}
      ${actionBlock([
        capabilities.sale && !payment.hasPayments ? button('Продажа', { variant: 'secondary', data: 'data-record-view-sale' }) : '',
        capabilities.notes && hasNotesForTarget('record', source.id)
          ? button('Заметки', { variant: 'secondary', data: 'data-record-view-notes' })
          : '',
        payment.fullyPaid
          ? button('Оплачено', { disabled: true })
          : capabilities.payment
            ? button(`К оплате: ${formatMoney(payment.remaining)}`, { data: 'data-record-view-payment' })
            : button(paymentStateLabel, { disabled: true }),
      ].filter(Boolean).join(''))}
    </div>`;

    root.querySelector('[data-record-view-program]')?.addEventListener('change', async (event) => {
      if (!capabilities.loyaltyProgram) return;
      if (payment.hasPayments) {
        render();
        openNotice({ message: 'После оплаты программа записи не изменяется.' });
        return;
      }
      const nextKey = String(event.currentTarget?.value || '');
      const nextProgram = programOptions.find((item) => item.key === nextKey) || null;
      const updated = setRecordLoyaltyProgram(source, recordProgramSelection(nextProgram));
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
        openNotice({ title: 'Не удалось сохранить', message: String(error?.message || 'Сервер не подтвердил выбор программы.') });
      }
    });

    root.querySelectorAll('[data-record-view-procedure-settings]').forEach((node, index) => {
      if (!capabilities.procedureSettings) return;
      const procedure = procedures[index];
      if (!procedure) return;
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProcedureAdjustment(syncCurrent(), procedure.id, {
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
      };
      node.addEventListener('click', open);
      node.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        open(event);
      });
    });

    const reportCard = root.querySelector('.record-confirmation-view__card');
    if (capabilities.zReport) {
      reportCard?.setAttribute('role', 'button');
      reportCard?.setAttribute('tabindex', '0');
      reportCard?.setAttribute('aria-label', 'Z-отчёт записи');
      reportCard?.addEventListener('click', () => openRecordZReport(syncCurrent()));
      reportCard?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openRecordZReport(syncCurrent());
      });
    }
    root.querySelector('[data-record-view-notes]')?.addEventListener('click', () => {
      if (!capabilities.notes) return;
      const notes = getNotesForTarget('record', source.id);
      if (!notes.length) return;
      const noteDate = String(notes[0]?.date || source.date || '').slice(0, 10);
      layer.v2Close?.();
      queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent('book:journal-note-focus-request', {
          detail: {
            targetType: 'record',
            targetId: String(source.id || ''),
            date: noteDate,
            workplaceId: String(source.workplaceId || ''),
          },
        }));
      });
    });
    root.querySelector('[data-record-view-sale]')?.addEventListener('click', () => {
      if (!capabilities.sale) return;
      openRecordSale(syncCurrent(), {
        onSaved: (saved) => {
          currentRecord = saved;
          render();
        },
      });
    });
    root.querySelector('[data-record-view-payment]')?.addEventListener('click', () => {
      if (!capabilities.payment) return;
      openRecordPayment(syncCurrent(), {
        onCompleted: () => {
          syncCurrent();
          render();
        },
      });
    });

    layer.querySelector('[data-record-view-confirmed]')?.addEventListener('click', () => {
      if (!capabilities.confirmation || payment.fullyPaid) return;
      persistStatus(
        () => setRecordConfirmed(source.id, !Boolean(source.confirmed)),
        'Сервер не подтвердил изменение статуса.',
      );
    });
    layer.querySelectorAll('[data-record-view-attendance]').forEach((node) => node.addEventListener('click', () => {
      if (!capabilities.attendance || !hasAppointmentStarted(source)) return;
      const next = normalizedAttendance(node.dataset.recordViewAttendance);
      const current = normalizedAttendance(source.attendance) || 'arrived';
      if (!next || next === current) return;
      persistStatus(
        () => setRecordAttendance(source.id, next),
        'Сервер не подтвердил изменение посещения.',
      );
    }));

    layer.dataset.recordViewContext = capabilities === RECORD_VIEW_CAPABILITIES.account ? 'account' : 'professional';
    layer.dataset.recordViewPaymentState = payment.fullyPaid ? 'paid' : payment.partiallyPaid ? 'partial' : 'unpaid';
  };

  render();
  return layer;
}
