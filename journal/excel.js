import {
  ALL_WORKPLACES_ID,
  button,
  datePicker,
  initDatePickers,
  modal,
  mountModal,
  openNotice,
  select,
} from '../ui/ui.js';
import { canUseRealPersonalData } from '../core/access.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { loadHistoryFacts } from '../core/history/service.js';
import { createPerson, getAllPeople, savePeople } from '../core/people/data.js';
import {
  cancelRecord,
  completeRecord,
  createRecord,
  getRecords,
  refreshRecordsFromServer,
  setRecordAttendance,
} from '../core/record/index.js';
import { getWorkplaces } from '../core/workplace-time.js';

const EXPORT_HEADERS = [
  'ID записи',
  'Дата',
  'С',
  'До',
  'Рабочее пространство',
  'Имя',
  'Фамилия',
  'Телефон',
  'Процедуры',
  'Товары',
  'Сумма',
  'Статус',
  'Оплата',
];
const TEMPLATE_HEADERS = EXPORT_HEADERS.filter((header) => !['ID записи', 'Оплата'].includes(header));

const text = (value) => String(value ?? '').trim();
const moneyNumber = (value) => {
  const number = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
};

function dateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(value, days) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function periodRange(mode, anchor = new Date()) {
  const date = anchor instanceof Date && !Number.isNaN(anchor.getTime()) ? new Date(anchor) : new Date();
  if (mode === 'day') {
    const day = dateKey(date);
    return { from: day, to: day };
  }
  if (mode === 'week') {
    const weekday = date.getDay() || 7;
    const from = addDays(date, 1 - weekday);
    return { from: dateKey(from), to: dateKey(addDays(from, 6)) };
  }
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: dateKey(from), to: dateKey(to) };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadRows(headers, rows, filename) {
  const csv = '\uFEFF' + [headers, ...rows]
    .map((row) => row.map(csvCell).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseCsvLine(line = '') {
  const cells = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (char === ';' && !quoted) {
      cells.push(value);
      value = '';
    } else value += char;
  }
  cells.push(value);
  return cells.map((cell) => cell.trim());
}

function parseCsv(value = '') {
  const lines = String(value).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    return {
      rowNumber: index + 2,
      values: Object.fromEntries(headers.map((header, position) => [text(header), text(cells[position])])),
    };
  });
}

function serializeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => [text(item?.name), moneyNumber(item?.price ?? item?.cost), Math.max(0, Number(item?.duration) || 0)].join('|'))
    .join(' || ');
}

function parseItems(value = '', total = 0) {
  const items = text(value)
    .split(/\s*\|\|\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, price, duration] = part.split('|').map((cell) => text(cell));
      return {
        id: crypto.randomUUID(),
        name: name || 'Импорт',
        price: moneyNumber(price),
        duration: Math.max(0, Number(duration) || 0),
      };
    });
  if (!items.length && total > 0) return [{ id: crypto.randomUUID(), name: 'Импорт', price: total, duration: 0 }];
  if (items.length && total > 0 && items.every((item) => item.price <= 0)) items[0].price = total;
  return items;
}

function personPhone(person = {}) {
  return text(person.phone || person.phones?.[0]);
}

function phoneKey(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function recordStatusLabel(record = {}, deleted = false) {
  if (deleted || record?.status === 'deleted') return 'Удалена';
  if (record?.status === 'cancelled') return 'Отменена';
  if (record?.attendance === 'no-show') return 'Не пришёл';
  if (record?.completed === true || record?.status === 'completed') return 'Завершена';
  if (record?.attendance === 'arrived') return 'Пришёл';
  if (record?.confirmed) return 'Подтверждена';
  return 'Запись';
}

function paymentStatusLabel(record = {}) {
  const state = getRecordPaymentState(record);
  if (state?.fullyPaid) return 'Оплачено';
  if (state?.partiallyPaid) return 'Частично оплачено';
  if (Number(state?.remaining || 0) > 0.009) return 'Не оплачено';
  return '—';
}

function factSnapshot(fact = {}) {
  const data = fact?.data && typeof fact.data === 'object' && !Array.isArray(fact.data) ? fact.data : {};
  const snapshot = data.deleted ?? data.after ?? data.current;
  return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot) ? snapshot : {};
}

async function deletedHistoryRecords() {
  const facts = await loadHistoryFacts({ entityType: 'record', limit: 2000 });
  const deleted = new Map();
  for (const fact of facts) {
    const isDeleted = fact?.status === 'deleted' || fact?.eventType === 'delete' || fact?.eventType === 'deleted';
    const id = text(fact?.entityId || fact?.recordId);
    if (!isDeleted || !id || deleted.has(id)) continue;
    const snapshot = factSnapshot(fact);
    if (!Object.keys(snapshot).length) continue;
    deleted.set(id, { ...snapshot, id, status: 'deleted', __deleted: true });
  }
  return [...deleted.values()];
}

function workplaceName(workplaces, record = {}) {
  const id = text(record?.workplaceId);
  return workplaces.find((item) => text(item?.key || item?.id) === id)?.name || id;
}

function rowForRecord(record, workplaces, { deleted = false } = {}) {
  const person = record?.person && typeof record.person === 'object' ? record.person : {};
  const amount = recordAmountDue(record);
  return [
    text(record?.id),
    text(record?.date).slice(0, 10),
    text(record?.from).slice(0, 5),
    text(record?.to).slice(0, 5),
    workplaceName(workplaces, record),
    text(person?.name),
    text(person?.surname),
    personPhone(person),
    serializeItems(record?.procedures),
    serializeItems(record?.products),
    amount,
    recordStatusLabel(record, deleted),
    deleted ? '—' : paymentStatusLabel(record),
  ];
}

function withinRange(record = {}, from = '', to = '') {
  const date = text(record?.date).slice(0, 10);
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function matchesWorkplace(record = {}, workplaceId = ALL_WORKPLACES_ID) {
  return workplaceId === ALL_WORKPLACES_ID || text(record?.workplaceId) === text(workplaceId);
}

function matchesStatus(record = {}, status = 'all', { deleted = false } = {}) {
  if (status === 'all') return true;
  if (status === 'deleted') return deleted;
  if (deleted) return false;
  if (status === 'cancelled') return record?.status === 'cancelled';
  if (status === 'completed') return record?.completed === true || record?.status === 'completed';
  const payment = getRecordPaymentState(record);
  if (status === 'paid') return Boolean(payment?.fullyPaid);
  if (status === 'unpaid') return !payment?.fullyPaid && Number(payment?.remaining || 0) > 0.009;
  return record?.status !== 'cancelled' && record?.completed !== true;
}

async function exportRecords({ from, to, workplaceId, status }) {
  const workplaces = getWorkplaces();
  const current = getRecords()
    .filter((record) => withinRange(record, from, to))
    .filter((record) => matchesWorkplace(record, workplaceId))
    .filter((record) => matchesStatus(record, status));
  const deleted = status === 'deleted' || status === 'all'
    ? (await deletedHistoryRecords())
      .filter((record) => withinRange(record, from, to))
      .filter((record) => matchesWorkplace(record, workplaceId))
      .filter((record) => matchesStatus(record, status, { deleted: true }))
    : [];
  const rows = [
    ...current.map((record) => rowForRecord(record, workplaces)),
    ...deleted.map((record) => rowForRecord(record, workplaces, { deleted: true })),
  ].sort((left, right) => `${left[1]}T${left[2]}`.localeCompare(`${right[1]}T${right[2]}`));
  if (!rows.length) {
    openNotice({ title: 'Excel', message: 'За выбранный период записей нет.' });
    return false;
  }
  downloadRows(EXPORT_HEADERS, rows, `записи-${from || 'все'}-${to || 'все'}.csv`);
  return true;
}

function resolveWorkplace(value, workplaces, fallbackId = ALL_WORKPLACES_ID) {
  const target = text(value).toLocaleLowerCase('ru');
  const found = workplaces.find((item) => {
    const id = text(item?.key || item?.id);
    return id.toLocaleLowerCase('ru') === target || text(item?.name).toLocaleLowerCase('ru') === target;
  });
  if (found) return text(found?.key || found?.id);
  if (fallbackId && fallbackId !== ALL_WORKPLACES_ID) return text(fallbackId);
  return workplaces.length === 1 ? text(workplaces[0]?.key || workplaces[0]?.id) : '';
}

function resolvePerson(values, people) {
  const firstName = text(values['Имя']);
  const surname = text(values['Фамилия']);
  const phone = text(values['Телефон']);
  const phoneId = phoneKey(phone);
  let person = phoneId
    ? people.find((item) => (item?.phones || []).some((value) => phoneKey(value) === phoneId))
    : null;
  if (!person && (firstName || surname)) {
    person = people.find((item) => text(item?.name).toLocaleLowerCase('ru') === firstName.toLocaleLowerCase('ru')
      && text(item?.surname).toLocaleLowerCase('ru') === surname.toLocaleLowerCase('ru')) || null;
  }
  if (person) return person;
  const created = createPerson(firstName, surname, phone);
  people.push(created);
  return created;
}

function applyImportedStatus(record, value = '') {
  const status = text(value).toLocaleLowerCase('ru');
  if (!record?.id || !status) return;
  if (status.includes('удален')) return;
  if (status.includes('отмен')) {
    cancelRecord(record.id, { actionContext: { source: 'import' } });
    return;
  }
  if (status.includes('не приш')) {
    setRecordAttendance(record.id, 'no-show', { actionContext: { source: 'import' } });
    return;
  }
  if (status.includes('приш')) setRecordAttendance(record.id, 'arrived', { actionContext: { source: 'import' } });
  if (status.includes('заверш') || status.includes('выполн') || status.includes('состоя')) {
    completeRecord(record.id, { actionContext: { source: 'import' } });
  }
}

async function importRecords(file, { workplaceId = ALL_WORKPLACES_ID, onDone = () => {} } = {}) {
  if (!file) return;
  const source = await file.text();
  const rows = parseCsv(source);
  if (!rows.length) {
    openNotice({ title: 'Excel', message: 'В файле нет записей для загрузки.' });
    return;
  }
  const workplaces = getWorkplaces();
  const people = getAllPeople();
  const initialPeopleCount = people.length;
  let imported = 0;
  const skipped = [];
  for (const row of rows) {
    const values = row.values;
    if (text(values['Статус']).toLocaleLowerCase('ru').includes('удален')) {
      skipped.push(row.rowNumber);
      continue;
    }
    const date = text(values['Дата']).slice(0, 10);
    const from = text(values['С']).slice(0, 5);
    const to = text(values['До']).slice(0, 5);
    const resolvedWorkplaceId = resolveWorkplace(values['Рабочее пространство'], workplaces, workplaceId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || !resolvedWorkplaceId) {
      skipped.push(row.rowNumber);
      continue;
    }
    const person = resolvePerson(values, people);
    const total = moneyNumber(values['Сумма']);
    const procedures = parseItems(values['Процедуры'], total);
    const products = parseItems(values['Товары'], procedures.length ? 0 : total);
    const record = createRecord({
      date,
      workplaceId: resolvedWorkplaceId,
      from,
      to,
      person,
      procedures,
      products,
      source: 'import',
      actionContext: { source: 'import' },
    });
    if (!record) {
      skipped.push(row.rowNumber);
      continue;
    }
    applyImportedStatus(record, values['Статус']);
    imported += 1;
  }
  if (people.length !== initialPeopleCount) savePeople(people);
  await flushBusinessPersistence();
  await refreshRecordsFromServer();
  onDone?.();
  const skippedText = skipped.length ? ` Пропущены строки: ${skipped.join(', ')}.` : '';
  openNotice({ title: 'Excel', message: `Загружено записей: ${imported}.${skippedText}` });
}

function openExportSettings(root, { selectedDate = new Date(), workplaceId = ALL_WORKPLACES_ID } = {}) {
  const range = periodRange('month', selectedDate);
  const workplaces = getWorkplaces();
  const workplaceOptions = [
    { value: ALL_WORKPLACES_ID, label: 'Все рабочие пространства' },
    ...workplaces.map((item) => ({ value: text(item?.key || item?.id), label: item?.name || 'Рабочее пространство' })),
  ];
  const layer = mountModal(root, modal(`<div class="compact-form" data-journal-excel-export>
    ${select({ label: 'Период', name: 'journalExcelPeriod', value: 'month', options: [
      { value: 'day', label: 'День' },
      { value: 'week', label: 'Неделя' },
      { value: 'month', label: 'Месяц' },
      { value: 'custom', label: 'С — По' },
    ] })}
    ${datePicker({ label: 'С', name: 'journalExcelFrom', value: range.from, modalVariant: 'bottom', modalSurface: 'app', allowClear: false })}
    ${datePicker({ label: 'По', name: 'journalExcelTo', value: range.to, modalVariant: 'bottom', modalSurface: 'app', allowClear: false })}
    ${select({ label: 'Рабочее пространство', name: 'journalExcelWorkplace', value: workplaceId || ALL_WORKPLACES_ID, options: workplaceOptions })}
    ${select({ label: 'Записи', name: 'journalExcelStatus', value: 'all', options: [
      { value: 'all', label: 'Все' },
      { value: 'active', label: 'Текущие' },
      { value: 'completed', label: 'Состоявшиеся' },
      { value: 'cancelled', label: 'Отменённые' },
      { value: 'paid', label: 'Оплаченные' },
      { value: 'unpaid', label: 'Неоплаченные' },
      { value: 'deleted', label: 'Удалённые' },
    ] })}
    <div class="modal-actions">${button('Выгрузить', { data: 'data-journal-excel-export-submit' })}</div>
  </div>`, { title: 'Выгрузка записей', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  initDatePickers(layer);
  const period = layer.querySelector('[name="journalExcelPeriod"]');
  period?.addEventListener('change', () => {
    if (period.value === 'custom') return;
    const next = periodRange(period.value, selectedDate);
    const from = layer.querySelector('input[name="journalExcelFrom"]');
    const to = layer.querySelector('input[name="journalExcelTo"]');
    if (from) from.value = next.from;
    if (to) to.value = next.to;
  });
  layer.querySelector('[data-journal-excel-export-submit]')?.addEventListener('click', async (event) => {
    const submit = event.currentTarget;
    submit.disabled = true;
    try {
      const exported = await exportRecords({
        from: text(layer.querySelector('input[name="journalExcelFrom"]')?.value),
        to: text(layer.querySelector('input[name="journalExcelTo"]')?.value),
        workplaceId: text(layer.querySelector('[name="journalExcelWorkplace"]')?.value) || ALL_WORKPLACES_ID,
        status: text(layer.querySelector('[name="journalExcelStatus"]')?.value) || 'all',
      });
      if (exported) layer.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Excel', message: String(error?.message || 'Не удалось выгрузить записи.') });
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  });
  return layer;
}

function downloadTemplate() {
  downloadRows(TEMPLATE_HEADERS, [], 'шаблон-записи.csv');
}

export function openJournalExcel(root, {
  selectedDate = new Date(),
  workplaceId = ALL_WORKPLACES_ID,
  onImported = () => {},
} = {}) {
  const allowReal = canUseRealPersonalData();
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Выгрузить', { variant: 'secondary', data: 'data-journal-excel-export' })}
    ${button('Загрузить', { variant: 'secondary', data: 'data-journal-excel-import', disabled: !allowReal })}
    ${button('Шаблон', { variant: 'secondary', data: 'data-journal-excel-template' })}
    <input class="file-input" type="file" accept=".csv,text/csv" data-journal-excel-file>
    ${allowReal ? '' : '<p class="muted">Импорт реальных персональных данных недоступен в текущем режиме.</p>'}
  </div>`, { title: 'Excel', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  layer.querySelector('[data-journal-excel-export]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openExportSettings(root, { selectedDate, workplaceId });
  });
  layer.querySelector('[data-journal-excel-template]')?.addEventListener('click', downloadTemplate);
  layer.querySelector('[data-journal-excel-import]')?.addEventListener('click', () => layer.querySelector('[data-journal-excel-file]')?.click());
  layer.querySelector('[data-journal-excel-file]')?.addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0] || null;
    if (!file) return;
    try {
      await importRecords(file, { workplaceId, onDone: onImported });
      layer.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Excel', message: String(error?.message || 'Не удалось загрузить записи.') });
    }
  });
  return layer;
}
