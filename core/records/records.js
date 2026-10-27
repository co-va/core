import {
  actionBlock,
  button,
  columnLayout,
  durationText,
  emptyState,
  field,
  initCalendar,
  initMultiSelect,
  modal,
  mountModal,
  openNotice,
  openRecordCreationOwner,
  recordConfirmationMiniCard,
  recordCreationTimeRows,
  recordPersonList,
  recordProcedureList,
  recordWorkplaceCards,
  select,
} from '../../ui/ui.js';
import { createRecord, getRecord, updateRecord } from '../record/index.js';
import { getPeople } from '../people/data.js';
import { openPersonCreate } from '../people/create.js';
import { personDisplay } from '../people/presentation.js';
import { getProcedures } from '../service/procedures/data.js';
import { openProcedureEditor } from '../service/procedures/procedures.js';
import { assignProceduresToWorkplace } from '../service/procedures/assignment.js';
import { procedureCostForWorkplace, proceduresForWorkplace } from '../service/procedures/selection.js';
import {
  buildNaturalBookingTimeRows,
  checkTimeAvailability,
  getAvailabilityGrid,
  getTimeAvailabilityAt,
  minutesToTime,
  timeToMinutes,
} from '../time/index.js';
import { getWorkplaces, getWorkplaceWorkingDates } from '../workplace-time.js';
import { getProfile } from '../profile/data.js';
import { workplaceCardAppearance, workplaceCardFields, workplaceCardPhoto } from '../profile/card-presentation.js';
import { getRecordPaymentState, resolveRecordSettlement } from '../finance/index.js';
import {
  deleteRecordProcedurePaymentAdjustment,
  getRecordProcedurePaymentAdjustment,
  saveRecordProcedurePaymentAdjustment,
} from '../payment/procedure-adjustment.js';

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '').slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function formatMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function inputNumber(value = 0) {
  const number = Number(value) || 0;
  return String(Math.round(number * 100) / 100);
}

function personSnapshot(person = {}) {
  return {
    key: String(person?.key || ''),
    id: String(person?.id || ''),
    name: String(person?.name || ''),
    surname: String(person?.surname || ''),
    phone: String(person?.phone || person?.phones?.[0] || ''),
  };
}

function groupCapacity(procedures = []) {
  if (!procedures.length) return 1;
  const capacities = procedures.map((entry) => {
    const source = entry.raw || entry.procedure || entry;
    if (source?.groupBooking?.enabled !== true) return 1;
    return Math.max(2, Math.min(999, Math.floor(Number(source.groupBooking.capacity) || 2)));
  });
  return capacities.every((value) => value >= 2) ? Math.min(...capacities) : 1;
}

function professionalProvider() {
  return {
    kind: 'professional',
    workplaces: () => getWorkplaces(),
    workplaceId: (item) => String(item?.id ?? item?.key ?? ''),
    workplaceName(id) {
      const item = getWorkplaces().find((entry) => String(entry?.id ?? entry?.key ?? '') === String(id || ''));
      return item?.name || item?.title || 'Рабочее пространство';
    },
    workplaceCards() {
      const profile = getProfile();
      return getWorkplaces().map((workplace) => ({
        ...workplace,
        appearance: workplaceCardAppearance(workplace),
        fields: workplaceCardFields(workplace, profile),
        image: workplaceCardPhoto(workplace),
        imagePosition: `${Number(workplace?.photoCropX ?? 50)}% ${Number(workplace?.photoCropY ?? 50)}%`,
      }));
    },
    procedures: (workplaceId) => proceduresForWorkplace(getProcedures(), workplaceId),
    procedureId: (item) => String(item?.id || ''),
    procedureName: (item) => String(item?.name || ''),
    procedureCost: (item, workplaceId) => procedureCostForWorkplace(item, workplaceId),
    procedureDuration: (item) => Math.max(0, Number(item?.duration) || 0),
    workingDates: (workplaceId) => getWorkplaceWorkingDates(workplaceId),
    timeRows({ workplaceId, date, procedures, state = {} }) {
      const duration = Math.max(5, procedures.reduce((sum, item) => sum + (Number(item.duration) || 0), 0));
      return buildNaturalBookingTimeRows(getAvailabilityGrid({ date, workplaceId }), duration, {
        excludeId: state.recordId || '',
      });
    },
    async create(state, actionContext = null) {
      const primary = state.people[0] || state.person;
      const capacity = groupCapacity(state.procedures);
      return createRecord({
        source: 'journal',
        actionContext,
        date: state.date,
        workplaceId: state.workplaceId,
        from: state.from,
        to: state.to,
        person: personSnapshot(primary),
        group: capacity > 1 ? {
          capacity,
          participants: state.people.map(personSnapshot),
        } : null,
        procedures: state.procedures.map((entry) => ({
          id: entry.id,
          name: entry.name,
          cost: entry.cost,
          duration: entry.duration,
          groupBooking: entry.raw?.groupBooking ? { ...entry.raw.groupBooking } : undefined,
        })),
      });
    },
  };
}

function normalizeProvider(provider = {}) {
  return { ...professionalProvider(), ...provider };
}

function defaultJournalTimeRows({ date, workplaceId, hint }) {
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

function selectionEntry(provider, raw, workplaceId) {
  return {
    id: provider.procedureId(raw),
    name: provider.procedureName(raw),
    cost: provider.procedureCost(raw, workplaceId),
    duration: provider.procedureDuration(raw),
    raw,
  };
}

function totalDuration(items = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item?.duration) || 0), 0);
}

export function openProcedureAdjustment(record, procedureId, { onSaved = () => {} } = {}) {
  const source = getRecord(record?.id) || record;
  if (!source?.id || getRecordPaymentState(source).hasPayments) return null;
  const procedure = (Array.isArray(source.procedures) ? source.procedures : [])
    .find((item) => String(item?.id || '') === String(procedureId || ''));
  const adjustment = getRecordProcedurePaymentAdjustment(source, procedureId);
  if (!procedure || !adjustment) return null;

  const priceFields = columnLayout([
    field({ label: 'Цена', name: 'recordProcedurePrice', type: 'number', value: inputNumber(adjustment.price), inputmode: 'decimal', min: 0, step: '0.01', data: 'data-record-procedure-price' }),
    field({ label: 'Скидка %', name: 'recordProcedureDiscountPercent', type: 'number', value: inputNumber(adjustment.discountPercent), inputmode: 'decimal', min: 0, max: 100, step: '0.01', disabled: adjustment.programDiscount, data: 'data-record-procedure-discount-percent' }),
    field({ label: 'Скидка ₽', name: 'recordProcedureDiscountMoney', type: 'number', value: inputNumber(adjustment.discountMoney), inputmode: 'decimal', min: 0, step: '0.01', disabled: adjustment.programDiscount, data: 'data-record-procedure-discount-money' }),
  ], { columns: 3, ariaLabel: 'Цена и скидка процедуры' });
  const editor = mountModal(document.body, modal(
    `<div class="compact-form">
      ${field({ label: 'Длительность, мин', name: 'recordProcedureDuration', type: 'number', value: String(Math.max(1, Number(procedure.duration) || 0)), inputmode: 'numeric', min: 1, step: 1, data: 'data-record-procedure-duration' })}
      ${priceFields}
      ${actionBlock([
        button('Сохранить', { data: 'data-record-procedure-adjustment-save' }),
        button('Удалить процедуру', { variant: 'critical', data: 'data-record-procedure-delete' }),
      ].join(''))}
    </div>`,
    { variant: 'x', surface: 'app', title: procedure.name || 'Процедура', className: 'modal--form-sheet' },
  ));
  if (!editor) return null;

  const priceInput = editor.querySelector('[data-record-procedure-price]');
  const percentInput = editor.querySelector('[data-record-procedure-discount-percent]');
  const moneyInput = editor.querySelector('[data-record-procedure-discount-money]');
  let correctionMode = adjustment.correctionMode;
  const numeric = (input) => Math.max(0, Number(String(input?.value || '0').replace(',', '.')) || 0);
  const syncDiscount = (origin = '') => {
    const price = numeric(priceInput);
    if (adjustment.programDiscount) {
      if (percentInput) percentInput.value = inputNumber(adjustment.programPercent);
      if (moneyInput) moneyInput.value = inputNumber(price * adjustment.programPercent / 100);
      return;
    }
    if (origin === 'percent') correctionMode = numeric(percentInput) > 0 ? 'percent' : 'none';
    if (origin === 'money') correctionMode = numeric(moneyInput) > 0 ? 'money' : 'none';
    if (correctionMode === 'percent') {
      if (moneyInput) moneyInput.value = inputNumber(Math.min(price, price * Math.min(100, numeric(percentInput)) / 100));
    } else if (correctionMode === 'money') {
      const money = Math.min(price, numeric(moneyInput));
      if (moneyInput) moneyInput.value = inputNumber(money);
      if (percentInput) percentInput.value = price > 0 ? inputNumber(Math.min(100, money / price * 100)) : '0';
    }
  };
  priceInput?.addEventListener('input', () => syncDiscount('price'));
  percentInput?.addEventListener('input', () => syncDiscount('percent'));
  moneyInput?.addEventListener('input', () => syncDiscount('money'));
  syncDiscount();

  editor.querySelector('[data-record-procedure-adjustment-save]')?.addEventListener('click', async (event) => {
    const submit = event.currentTarget;
    const latest = getRecord(source.id) || source;
    if (getRecordPaymentState(latest).hasPayments) {
      editor.v2Close?.();
      openNotice({ message: 'Оплата уже проведена. Используйте корректировку оплаты.' });
      return;
    }
    const duration = Math.max(1, Math.round(numeric(editor.querySelector('[data-record-procedure-duration]'))));
    const nextProcedures = (Array.isArray(latest.procedures) ? latest.procedures : []).map((item) =>
      String(item?.id || '') === String(procedureId || '') ? { ...item, duration } : { ...item });
    const start = timeToMinutes(latest.from);
    const nextTo = start == null ? '' : minutesToTime(start + totalDuration(nextProcedures));
    if (!nextTo || !checkTimeAvailability({
      date: latest.date,
      workplaceId: latest.workplaceId,
      from: latest.from,
      to: nextTo,
      excludeId: latest.id,
    }).ok) {
      openNotice({ title: 'Время процедуры', message: 'Новая длительность пересекается с занятым или недоступным временем.' });
      return;
    }

    submit.disabled = true;
    try {
      await saveRecordProcedurePaymentAdjustment(latest, procedureId, {
        price: numeric(priceInput),
        correctionMode,
        discountPercent: numeric(percentInput),
        discountMoney: numeric(moneyInput),
      });
      const updated = updateRecord(latest.id, { procedures: nextProcedures, to: nextTo });
      if (!updated) throw new Error('Не удалось сохранить длительность процедуры.');
      await onSaved(updated);
      editor.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: String(error?.message || 'Не удалось скорректировать процедуру.') });
      if (submit.isConnected) submit.disabled = false;
    }
  });

  editor.querySelector('[data-record-procedure-delete]')?.addEventListener('click', async (event) => {
    const submit = event.currentTarget;
    const latest = getRecord(source.id) || source;
    if (getRecordPaymentState(latest).hasPayments) {
      editor.v2Close?.();
      openNotice({ message: 'Оплата уже проведена. Используйте корректировку оплаты.' });
      return;
    }

    const nextProcedures = (Array.isArray(latest.procedures) ? latest.procedures : [])
      .filter((item) => String(item?.id || '') !== String(procedureId || ''))
      .map((item) => ({ ...item }));
    const start = timeToMinutes(latest.from);
    const minutes = totalDuration(nextProcedures);
    const calculatedTo = start == null ? '' : minutesToTime(start + minutes);
    const nextTo = minutes > 0 ? calculatedTo : String(latest.to || '');
    if (!nextTo || !checkTimeAvailability({
      date: latest.date,
      workplaceId: latest.workplaceId,
      from: latest.from,
      to: nextTo,
      excludeId: latest.id,
    }).ok) {
      openNotice({ title: 'Удаление процедуры', message: 'После удаления не удалось сохранить время записи.' });
      return;
    }

    submit.disabled = true;
    try {
      await deleteRecordProcedurePaymentAdjustment(latest, procedureId);
      const updated = updateRecord(latest.id, { procedures: nextProcedures, to: nextTo });
      if (!updated) throw new Error('Не удалось удалить процедуру из записи.');
      await onSaved(updated);
      editor.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Не удалось удалить', message: String(error?.message || 'Не удалось удалить процедуру.') });
      if (submit.isConnected) submit.disabled = false;
    }
  });

  return editor;
}

export function openRecords({
  context = 'professional',
  record = null,
  person = null,
  workplaceId = '',
  date = '',
  timeHint = '',
  procedures = [],
  professionalActions = context !== 'online',
  actionContext = null,
  provider = {},
  creationOwner = null,
  onCreated = () => {},
  onSaved = null,
  onCancel = () => {},
  stepBack = false,
  onBackFromStart = null,
} = {}) {
  const source = normalizeProvider(provider);
  const existing = record?.id ? record : null;
  const initialPerson = existing?.person || person;
  const initialPeople = Array.isArray(existing?.group?.participants) && existing.group.participants.length
    ? existing.group.participants
    : initialPerson ? [initialPerson] : [];
  const initialProcedures = existing ? existing.procedures : procedures;
  const state = {
    recordId: String(existing?.id || ''),
    workplaceId: String(existing?.workplaceId ?? workplaceId ?? ''),
    date: existing?.date ? dateKey(existing.date) : date ? dateKey(date) : '',
    timeHint: String(timeHint || ''),
    from: String(existing?.from || ''),
    to: String(existing?.to || ''),
    procedures: Array.isArray(initialProcedures) ? initialProcedures.map((entry) => ({ ...entry })) : [],
    person: initialPerson ? { ...initialPerson } : null,
    people: initialPeople.map((item) => ({ ...item })),
    correcting: false,
  };

  const owner = creationOwner || openRecordCreationOwner({ onCancel });
  if (!owner) return null;
  let currentRenderer = null;

  const renderFooter = (view, handlers = {}) => {
    for (const [selector, handler] of Object.entries(handlers)) {
      view?.layer?.querySelector(selector)?.addEventListener('click', handler);
    }
  };

  const nextAfterTime = () => {
    if (!state.procedures.length) return renderProcedures();
    if (!state.person && source.kind === 'professional') return renderPerson();
    return renderConfirmation();
  };

  const nextAfterDate = () => {
    state.from = '';
    state.to = '';
    renderTimes();
  };

  const nextAfterProcedures = () => {
    if (state.from) {
      const start = timeToMinutes(state.from);
      const end = start == null ? '' : minutesToTime(start + totalDuration(state.procedures));
      if (end && checkTimeAvailability({
        date: state.date,
        workplaceId: state.workplaceId,
        from: state.from,
        to: end,
        excludeId: state.recordId,
      }).ok) {
        state.to = end;
        if (!state.person && source.kind === 'professional') renderPerson();
        else renderConfirmation();
        return;
      }
      state.from = '';
      state.to = '';
    }
    if (!state.date) renderDates();
    else renderTimes();
  };

  const renderWorkplaces = () => {
    currentRenderer = renderWorkplaces;
    const items = source.workplaceCards ? source.workplaceCards() : source.workplaces();
    const body = items.length
      ? recordWorkplaceCards(items, { data: 'data-records-workplace' })
      : emptyState('Нет рабочих пространств', 'Рабочие пространства не настроены.');
    const view = owner.render({ step: 'workplace', body });
    view?.body?.querySelectorAll('[data-records-workplace]').forEach((node) => node.addEventListener('click', () => {
      state.workplaceId = String(node.dataset.recordsWorkplace || '');
      state.procedures = [];
      state.date = '';
      state.from = '';
      state.to = '';
      renderProcedures();
    }));
  };

  const openFromPrice = () => {
    const all = getProcedures();
    const available = all.filter((item) => !source.procedures(state.workplaceId).some((entry) => source.procedureId(entry) === String(item.id || '')));
    const selected = new Set();
    const layer = mountModal(document.body, modal(recordProcedureList(available.map((item) => ({
      id: String(item.id || ''),
      name: item.name || '',
      durationText: durationText(item.duration),
      costText: procedureCostForWorkplace(item, '') !== '' ? `${procedureCostForWorkplace(item, '')} ₽` : '',
    })), { data: 'data-records-price', selected: [], empty: 'Процедур нет.' })
      + actionBlock(button('Добавить', { data: 'data-records-price-add' })), {
      title: 'Из прайса', variant: 'x', surface: 'app', className: 'modal--form-sheet',
    }));
    if (!layer) return;
    const listRoot = layer.querySelector('[data-records-price]')?.parentElement || layer;
    const controller = initMultiSelect(listRoot, {
      selectedValues: [],
      selector: '[data-records-price]',
      valueAttribute: 'recordsPrice',
      onChange: (values) => {
        selected.clear();
        values.forEach((value) => selected.add(String(value)));
      },
    });
    layer.querySelector('[data-records-price-add]')?.addEventListener('click', () => {
      if (!selected.size) return;
      const workplace = source.workplaces().find((item) => source.workplaceId(item) === state.workplaceId);
      assignProceduresToWorkplace({
        procedureIds: [...selected],
        workplaceId: state.workplaceId,
        workplaceName: workplace?.name || workplace?.title || '',
      });
      controller?.destroy?.();
      layer.v2Close?.();
      renderProcedures();
    });
  };

  const openAddProcedure = () => {
    openProcedureEditor(document.querySelector('[data-v2-app]') || document.body, null, {
      onSaved: (created) => {
        const workplace = source.workplaces().find((item) => source.workplaceId(item) === state.workplaceId);
        assignProceduresToWorkplace({
          procedureIds: [created.id],
          workplaceId: state.workplaceId,
          workplaceName: workplace?.name || workplace?.title || '',
        });
        renderProcedures();
      },
    });
  };

  const renderProcedures = () => {
    currentRenderer = renderProcedures;
    const available = source.procedures(state.workplaceId);
    const selected = new Map(state.procedures.map((entry) => [String(entry.id || ''), entry]));
    let controller = null;

    const render = () => {
      const body = recordProcedureList(available.map((item) => ({
        id: source.procedureId(item),
        name: source.procedureName(item),
        durationText: durationText(source.procedureDuration(item)),
        costText: source.procedureCost(item, state.workplaceId) !== '' ? `${source.procedureCost(item, state.workplaceId)} ₽` : '',
      })), {
        data: 'data-records-procedure',
        selected: [...selected.keys()],
        empty: 'Для этого рабочего пространства процедуры не настроены.',
      });
      const secondaryActions = professionalActions ? [
        { label: 'Добавить из прайса', data: 'data-records-from-price', variant: 'secondary' },
        { label: '+ Добавить процедуру', data: 'data-records-add-procedure', variant: 'secondary' },
      ] : [];
      const view = owner.render({
        step: 'procedures',
        body,
        secondaryActions,
        action: { label: 'Далее', data: 'data-records-procedures-next', disabled: selected.size === 0 },
      });
      controller?.destroy?.();
      controller = initMultiSelect(view?.body, {
        selectedValues: [...selected.keys()],
        selector: '[data-records-procedure]',
        valueAttribute: 'recordsProcedure',
        onChange: (values) => {
          const next = new Map();
          values.forEach((id) => {
            const raw = available.find((item) => source.procedureId(item) === String(id));
            if (raw) next.set(String(id), selected.get(String(id)) || selectionEntry(source, raw, state.workplaceId));
          });
          selected.clear();
          next.forEach((value, key) => selected.set(key, value));
          state.procedures = [...selected.values()];
          render();
        },
      });
      renderFooter(view, {
        '[data-records-from-price]': openFromPrice,
        '[data-records-add-procedure]': openAddProcedure,
        '[data-records-procedures-next]': () => {
          if (!selected.size) return;
          state.procedures = [...selected.values()];
          nextAfterProcedures();
        },
      });
    };
    render();
  };

  const renderDates = () => {
    currentRenderer = renderDates;
    const dates = source.workingDates(state.workplaceId);
    const now = new Date();
    const selectedDate = state.date ? new Date(`${state.date}T00:00:00`) : now;
    let displayedMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    const workingYears = dates
      .map((value) => Number(String(value || '').slice(0, 4)))
      .filter((value) => Number.isInteger(value));
    const minYear = workingYears.length ? Math.min(now.getFullYear(), ...workingYears) : now.getFullYear();
    const maxYear = workingYears.length ? Math.max(now.getFullYear(), ...workingYears) : now.getFullYear();
    const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, index) => {
      const year = maxYear - index;
      return { value: String(year), label: String(year) };
    });
    const yearHeader = () => select({
      label: 'Год',
      name: 'recordsCalendarYear',
      value: String(displayedMonth.getFullYear()),
      options: yearOptions,
      aria: 'Год',
      className: 'ui-select--center',
      data: 'data-records-calendar-year',
    });
    const view = owner.render({
      step: 'date',
      header: dates.length ? yearHeader() : '',
      body: dates.length ? '<div data-records-calendar></div>' : emptyState('Свободных дат нет', 'В графике пока нет доступных дат.'),
    });
    const calendar = view?.body?.querySelector('[data-records-calendar]');
    if (!calendar) return;

    const syncYearHeader = () => {
      const input = view?.header?.querySelector('[name="recordsCalendarYear"]');
      if (!input) return;
      const year = String(displayedMonth.getFullYear());
      input.value = year;
      const visible = input.closest('.ui-select')?.querySelector('.ui-select__value');
      if (visible) visible.textContent = year;
    };

    const mountCalendar = () => {
      initCalendar(calendar, {
        month: displayedMonth,
        selectedValue: state.date || '',
        workingDates: dates,
        onMonthChange: (month) => {
          displayedMonth = month;
          syncYearHeader();
        },
        onDateSelect: (value) => {
          if (!dates.includes(value)) return;
          state.date = value;
          nextAfterDate();
        },
      });
    };

    view?.header?.querySelector('[name="recordsCalendarYear"]')?.addEventListener('change', (event) => {
      const year = Number(event.target.value);
      if (!Number.isInteger(year)) return;
      displayedMonth = new Date(year, displayedMonth.getMonth(), 1);
      mountCalendar();
    });

    mountCalendar();
  };

  const renderTimes = () => {
    currentRenderer = renderTimes;
    let rows;
    if (context === 'journal' && state.timeHint && !state.correcting) {
      rows = defaultJournalTimeRows({ date: state.date, workplaceId: state.workplaceId, hint: state.timeHint });
    } else {
      rows = source.timeRows({ workplaceId: state.workplaceId, date: state.date, procedures: state.procedures, state });
    }
    const view = owner.render({
      step: 'time',
      body: `<div class="record-screen record-screen--time">${rows.length
        ? recordCreationTimeRows(rows, { data: 'data-records-time', selected: state.from })
        : emptyState('Свободного времени нет', 'На эту дату нет доступного времени.')}</div>`,
    });
    view?.body?.querySelectorAll('[data-records-time]:not(:disabled)').forEach((node) => node.addEventListener('click', () => {
      const value = String(node.dataset.recordsTime || '');
      if (!value) return;
      state.from = value;
      const row = rows.find((item) => String(item.value ?? item.from ?? '') === value);
      state.to = String(row?.to || '');
      state.timeHint = '';
      state.correcting = false;
      nextAfterTime();
    }));
  };

  const renderPerson = () => {
    currentRenderer = renderPerson;
    const all = getPeople();
    const capacity = groupCapacity(state.procedures);
    const groupMode = capacity > 1;
    let filtered = all;
    const selected = new Map(state.people.map((item) => [String(item?.key || item?.id || ''), item]));

    const openAddPerson = () => {
      openPersonCreate({
        root: document.body,
        variant: 'x',
        surface: 'app',
        className: 'modal--form-sheet',
        onCreated: (created) => {
          const item = getPeople().find((entry) => entry.key === created.key) || created;
          if (groupMode) selected.set(String(item.key || item.id || ''), item);
          else {
            state.person = item;
            state.people = [item];
            renderConfirmation();
          }
          render();
        },
      });
    };

    const render = () => {
      const body = `<div class="record-screen record-screen--people">
        ${groupMode ? `<div class="muted">Участники: ${selected.size} / ${capacity}</div>` : ''}
        <div class="ui-search-field">${field({ name: 'recordsPersonSearch', type: 'search', placeholder: 'Поиск по имени или UEI', autocomplete: 'off', data: 'data-records-person-search' })}</div>
        <div class="ui-search-divider" aria-hidden="true"></div>
        <div class="record-person-list">${recordPersonList(filtered.map((item) => {
          const display = personDisplay(item);
          return { key: item.key, name: display.name, uei: display.uei, phone: display.phone, aria: `Выбрать ${display.name}` };
        }), { data: 'data-records-person', selected: [...selected.keys()], empty: 'Люди не найдены.' })}</div>
      </div>`;
      const view = owner.render({
        step: 'person',
        body,
        secondaryActions: professionalActions ? [{ label: '+ Добавить клиента', data: 'data-records-add-person', variant: 'secondary' }] : [],
        action: groupMode ? { label: 'Далее', data: 'data-records-person-next', disabled: selected.size === 0 } : null,
      });
      view?.body?.querySelector('[data-records-person-search]')?.addEventListener('input', (event) => {
        const query = event.target.value.trim().toLocaleLowerCase('ru');
        filtered = all.filter((item) => {
          const display = personDisplay(item);
          return display.name.toLocaleLowerCase('ru').includes(query)
            || display.phone.includes(query)
            || display.uei.toLocaleLowerCase('ru').includes(query);
        });
        render();
      });
      view?.body?.querySelectorAll('[data-records-person]').forEach((node) => node.addEventListener('click', () => {
        const item = all.find((entry) => String(entry.key) === String(node.dataset.recordsPerson));
        if (!item) return;
        if (!groupMode) {
          state.person = item;
          state.people = [item];
          renderConfirmation();
          return;
        }
        const key = String(item.key || item.id || '');
        if (selected.has(key)) selected.delete(key);
        else if (selected.size < capacity) selected.set(key, item);
        else {
          openNotice({ title: 'Групповая запись', message: `Для выбранных процедур максимум ${capacity} человек.` });
          return;
        }
        state.people = [...selected.values()];
        render();
      }));
      renderFooter(view, {
        '[data-records-add-person]': openAddPerson,
        '[data-records-person-next]': () => {
          if (!selected.size) return;
          state.people = [...selected.values()];
          state.person = state.people[0] || null;
          renderConfirmation();
        },
      });
    };
    render();
  };

  const renderCorrectionMenu = () => {
    currentRenderer = renderCorrectionMenu;
    const actions = [
      ['Пространство', 'workplace'],
      ['Процедуры', 'procedures'],
      ['Дата', 'date'],
      ['Время', 'time'],
      ...(source.kind === 'professional' ? [['Клиент / участники', 'person']] : []),
    ];
    const body = actionBlock(actions.map(([label, step]) => button(label, {
      variant: 'secondary', data: `data-records-correct-${step}`,
    })).join(''));
    const view = owner.render({ step: 'confirmation', title: 'Что изменить', body });
    actions.forEach(([, step]) => {
      view?.body?.querySelector(`[data-records-correct-${step}]`)?.addEventListener('click', () => {
        state.correcting = true;
        if (step === 'workplace') {
          state.workplaceId = '';
          state.procedures = [];
          state.date = '';
          state.from = '';
          state.to = '';
          renderWorkplaces();
        } else if (step === 'procedures') {
          state.procedures = [];
          state.from = '';
          state.to = '';
          renderProcedures();
        } else if (step === 'date') {
          state.date = '';
          state.from = '';
          state.to = '';
          renderDates();
        } else if (step === 'time') {
          state.from = '';
          state.to = '';
          renderTimes();
        } else if (step === 'person') {
          state.person = null;
          state.people = [];
          renderPerson();
        }
      });
    });
  };

  const confirmationPerson = () => state.people[0] || state.person || {};
  const confirmationDisplay = () => source.personDisplay
    ? source.personDisplay(confirmationPerson())
    : personDisplay(confirmationPerson());

  const renderConfirmation = () => {
    currentRenderer = renderConfirmation;
    const contact = confirmationPerson();
    const personInfo = confirmationDisplay();
    const settlement = source.settlement
      ? source.settlement(state)
      : resolveRecordSettlement({
        person: contact,
        procedures: state.procedures.map((entry) => ({
          id: entry.id,
          name: entry.name,
          cost: entry.cost,
          duration: entry.duration,
        })),
      });
    const contactDiscountPercent = Math.max(0, Math.min(100, Number(contact?.discountPercent) || 0));
    const discountMoney = Math.max(0, (Number(settlement?.serviceTotal) || 0) - (Number(settlement?.planTotal) || 0));
    const grossTotal = Number(settlement?.serviceTotal ?? (source.total ? source.total(state) : 0)) || 0;
    const identityNameParts = [contact?.name, contact?.surname].map((value) => String(value || '').trim()).filter(Boolean);
    const identity = [
      String(personInfo.uei || '').trim(),
      ...(identityNameParts.length
        ? identityNameParts
        : [String(personInfo.name || '').trim()].filter((value) => value && value !== 'Без имени')),
    ].filter(Boolean).join('; ');
    const card = recordConfirmationMiniCard({
      workplace: source.workplaceName(state.workplaceId),
      contactDiscount: contactDiscountPercent > 0 ? `${contactDiscountPercent}%` : '',
      date: formatDate(state.date),
      period: `${state.from} - ${state.to}`,
      identity,
      phone: personInfo.phone || '',
      duration: durationText(totalDuration(state.procedures)),
      discountMoney: discountMoney > 0.009 ? formatMoney(discountMoney) : '',
      total: formatMoney(grossTotal),
      procedures: state.procedures.map((entry) => ({
        name: entry.name,
        durationText: durationText(entry.duration),
        right: entry.cost === '' || entry.cost == null ? '' : formatMoney(entry.cost),
      })),
    });
    const view = owner.render({
      step: 'confirmation',
      body: `<div class="record-screen record-screen--state-view"><div role="button" tabindex="0" data-records-correction>${card}</div></div>`,
      action: { label: state.recordId ? 'Сохранить' : 'Подтвердить', data: 'data-records-confirm' },
    });
    const correction = view?.body?.querySelector('[data-records-correction]');
    correction?.addEventListener('click', renderCorrectionMenu);
    correction?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        renderCorrectionMenu();
      }
    });
    renderFooter(view, {
      '[data-records-confirm]': async () => {
        if (source.kind === 'professional' && !checkTimeAvailability({
          date: state.date,
          workplaceId: state.workplaceId,
          from: state.from,
          to: state.to,
          excludeId: state.recordId,
        }).ok) {
          openNotice({ title: 'Запись недоступна', message: 'Выбранное время уже занято или недоступно.' });
          return;
        }
        try {
          let saved;
          if (state.recordId) {
            const primary = state.people[0] || state.person;
            const editCapacity = groupCapacity(state.procedures);
            saved = updateRecord(state.recordId, {
              date: state.date,
              workplaceId: state.workplaceId,
              from: state.from,
              to: state.to,
              person: personSnapshot(primary),
              group: editCapacity > 1 ? {
                capacity: editCapacity,
                participants: state.people.map(personSnapshot),
              } : null,
              procedures: state.procedures.map((entry) => ({
                id: entry.id,
                name: entry.name,
                cost: entry.cost,
                duration: entry.duration,
                groupBooking: entry.raw?.groupBooking
                  ? { ...entry.raw.groupBooking }
                  : entry.groupBooking ? { ...entry.groupBooking } : undefined,
              })),
            }, { actionContext });
          } else {
            saved = await source.create(state, actionContext);
          }
          if (!saved) return;
          owner.commit();
          const callback = typeof onSaved === 'function' ? onSaved : onCreated;
          callback(saved, { ...state });
        } catch (error) {
          if (source.onCreateError) source.onCreateError(error, state, { renderTimes, renderConfirmation });
          else openNotice({
            title: 'Запись недоступна',
            message: state.recordId ? 'Не удалось сохранить.' : 'Не удалось создать.',
          });
        }
      },
    });
  };

  const backFromCurrentStep = () => {
    if (!stepBack || state.recordId) return false;
    const step = String(owner.layer?.dataset?.recordCreationStep || '');
    if (step === 'confirmation') {
      state.from = '';
      state.to = '';
      renderTimes();
      return true;
    }
    if (step === 'person') {
      state.from = '';
      state.to = '';
      renderTimes();
      return true;
    }
    if (step === 'time') {
      state.date = '';
      state.from = '';
      state.to = '';
      renderDates();
      return true;
    }
    if (step === 'date') {
      state.date = '';
      state.from = '';
      state.to = '';
      renderProcedures();
      return true;
    }
    if (step === 'procedures' && typeof onBackFromStart === 'function') {
      return onBackFromStart({
        ...state,
        procedures: state.procedures.map((item) => ({ ...item })),
        person: state.person ? { ...state.person } : null,
        people: state.people.map((item) => ({ ...item })),
      }) !== false;
    }
    return false;
  };

  const start = () => {
    const workplaces = source.workplaces();
    if (!workplaces.length) {
      openNotice({ title: 'Запись недоступна', message: 'Рабочие пространства не настроены.' });
      owner.close();
      return;
    }
    if (!state.workplaceId && workplaces.length === 1) state.workplaceId = source.workplaceId(workplaces[0]);

    if (state.recordId) {
      state.correcting = true;
      renderCorrectionMenu();
      return;
    }

    if (context === 'journal') {
      if (!state.workplaceId || !state.date || timeToMinutes(state.timeHint) == null) {
        openNotice({ title: 'Запись недоступна', message: 'Не определены дата, рабочее пространство или время.' });
        owner.close();
        return;
      }
      renderTimes();
      return;
    }

    if (!state.workplaceId) renderWorkplaces();
    else if (!state.procedures.length) renderProcedures();
    else if (!state.date) renderDates();
    else if (!state.from) renderTimes();
    else if (!state.person && source.kind === 'professional') renderPerson();
    else renderConfirmation();
  };

  owner.resumeRecord = () => {
    currentRenderer?.();
  };
  owner.getRecordState = () => ({
    ...state,
    procedures: state.procedures.map((item) => ({ ...item })),
    person: state.person ? { ...state.person } : null,
    people: state.people.map((item) => ({ ...item })),
  });

  owner.setBackHandler?.(stepBack ? backFromCurrentStep : null);
  start();
  return owner;
}
