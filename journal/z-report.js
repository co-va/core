import { modal, mountModal } from '../ui/ui.js';
import { readOnlyReceipt } from '../ui/receipt/index.js';
import { getRecordPaymentState, recordAmountDue } from '../core/finance/index.js';
import { getWorkplaces } from '../core/workplace-time.js';
import { personDisplay } from '../core/people/presentation.js';
import { normalizeWorkplaceTimeZone, zonedDateTimeParts } from '../core/time/index.js';

function formatRubles(value = 0) {
  const amount = Math.max(0, Math.round(Number(value) || 0));
  return `${amount.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} р.`;
}

function workplaceForRecord(record = null) {
  return getWorkplaces().find((item) => String(item?.key ?? item?.id ?? '') === String(record?.workplaceId || '')) || null;
}

function recordDateLabel(record = null) {
  const value = String(record?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || '—';
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

function paymentMoment(payment = null, record = null) {
  const value = String(payment?.occurredAt || payment?.paidAt || '');
  if (!value) return { date: '—', time: '—' };
  const workplace = workplaceForRecord(record);
  const parts = zonedDateTimeParts(value, normalizeWorkplaceTimeZone(workplace?.timeZone || ''));
  const date = String(parts?.date || '');
  const [year, month, day] = date.split('-');
  return {
    date: year && month && day ? `${day}.${month}.${year}` : (date || '—'),
    time: String(parts?.time || '—'),
  };
}

export function openZReportSummary(groups = []) {
  return mountModal(document.body, modal(readOnlyReceipt({
    title: 'Z - Отчет',
    groups,
  }), { variant: 's', surface: 'app', title: 'Z - Отчет' }));
}

export function openRecordZReport(record = null) {
  if (!record?.id) return null;
  const state = getRecordPaymentState(record);
  const latestPayment = state?.latestPayment || null;
  const workplace = workplaceForRecord(record);
  const person = personDisplay(record?.person || {});
  const identity = [person?.uei, person?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  const procedures = Array.isArray(record?.procedures) ? record.procedures.length : 0;
  const paymentAt = paymentMoment(latestPayment, record);
  const status = state.fullyPaid ? 'оплачено' : state.partiallyPaid ? 'задолженность' : 'к оплате';
  const groups = [[
    { label: workplace?.name || workplace?.title || 'Рабочее пространство', value: recordDateLabel(record) },
    { label: 'Время:', value: `${String(record?.from || '—')} - ${String(record?.to || '—')}` },
    { label: 'Клиент:', value: identity || 'Без имени' },
    { label: 'Кол-во процедур:', value: String(procedures) },
    { label: 'Сумма:', value: formatRubles(recordAmountDue(record)) },
    { label: 'Оплачено:', value: formatRubles(state.paidTotal) },
    { label: 'Статус:', value: status },
    ...(latestPayment ? [
      { label: 'Дата оплаты:', value: paymentAt.date },
      { label: 'Время оплаты:', value: paymentAt.time },
      { label: 'Сумма оплаты:', value: formatRubles(latestPayment.total) },
    ] : []),
  ]];
  return openZReportSummary(groups);
}
