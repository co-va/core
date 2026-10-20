import { loadHistoryFacts } from '../history/service.js';
import { getIdentityMemberKeys } from './data.js';

const text = (value) => String(value ?? '').trim();
const objectValue = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const arrayValue = (value) => Array.isArray(value) ? value : [];
const moneyNumber = (value) => Math.round((Number(value) || 0) * 100) / 100;

function factSnapshot(fact = {}) {
  const data = objectValue(fact.data);
  return objectValue(data.after ?? data.current ?? data.deleted);
}

function operationData(fact = {}) {
  return objectValue(factSnapshot(fact).data);
}

function latestBy(items = [], keyOf = (item) => item?.entityId) {
  const result = new Map();
  for (const item of items) {
    const key = text(keyOf(item));
    if (key && !result.has(key)) result.set(key, item);
  }
  return [...result.values()];
}

function appointmentMoment(record = {}) {
  const date = text(record.date);
  const from = text(record.from);
  return date ? `${date}T${from || '00:00'}:00` : text(record.createdAt);
}

function procedureNames(record = {}) {
  return arrayValue(record.procedures).map((item) => text(item?.name)).filter(Boolean);
}

function productNames(record = {}) {
  return arrayValue(record.products).map((item) => text(item?.name)).filter(Boolean);
}

function durationMinutes(record = {}) {
  const fromProcedures = arrayValue(record.procedures)
    .reduce((sum, item) => sum + Math.max(0, Number(item?.duration) || 0), 0);
  if (fromProcedures > 0) return fromProcedures;
  const parse = (value) => {
    const match = text(value).match(/^(\d{1,2}):(\d{2})$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = parse(record.from);
  const to = parse(record.to);
  return from != null && to != null && to >= from ? to - from : 0;
}

function lifecycle(recordFact, eventFacts = []) {
  const deleted = recordFact?.status === 'deleted' || recordFact?.eventType === 'delete';
  let status = deleted ? 'deleted' : 'active';
  let confirmed = false;
  let attendance = '';
  let statusAt = text(recordFact?.occurredAt);
  const ordered = [...eventFacts].sort((left, right) => text(left.occurredAt).localeCompare(text(right.occurredAt)));
  for (const fact of ordered) {
    const event = factSnapshot(fact);
    const type = text(event.type || fact.eventType);
    const at = text(event.at || fact.occurredAt);
    if (type === 'confirmed') {
      confirmed = true;
      statusAt = at;
    } else if (type === 'unconfirmed') {
      confirmed = false;
      statusAt = at;
    } else if (type === 'arrived') {
      attendance = 'arrived';
      statusAt = at;
    } else if (type === 'no-show') {
      attendance = 'no-show';
      statusAt = at;
    } else if (type === 'attendance-cleared') {
      attendance = '';
      statusAt = at;
    } else if (type === 'completed') {
      status = 'completed';
      statusAt = at;
    } else if (type === 'cancelled') {
      status = 'cancelled';
      statusAt = at;
    }
  }
  if (deleted) status = 'deleted';
  return { status, confirmed, attendance, statusAt };
}

function statusLabel(state = {}) {
  if (state.status === 'deleted') return 'Запись удалена';
  if (state.status === 'cancelled') return 'Запись отменена';
  if (state.attendance === 'no-show') return 'Не пришёл';
  if (state.attendance === 'arrived') return 'Пришёл';
  if (state.status === 'completed') return 'Завершена';
  if (state.confirmed) return 'Подтверждена';
  return 'Запись';
}

function financeOperation(fact = {}) {
  const row = factSnapshot(fact);
  const data = operationData(fact);
  return {
    id: text(row.operationId || fact.entityId),
    kind: text(row.kind || fact.eventType),
    status: text(row.status || fact.status || 'completed'),
    originalOperationId: text(row.originalOperationId),
    occurredAt: text(row.occurredAt || fact.occurredAt),
    data,
    total: moneyNumber(data.total),
    serviceAmount: moneyNumber(data.serviceAmount ?? data.total),
    tips: moneyNumber(data.tips),
  };
}

function recordFinance(facts = [], recordId = '') {
  const operations = latestBy(facts.filter((fact) => fact.entityType === 'finance-operation'
    && text(fact.recordId) === recordId), (fact) => fact.entityId)
    .map(financeOperation)
    .filter((operation) => operation.id && operation.status !== 'deleted' && operation.kind !== 'cancel');
  const payments = operations.filter((operation) => operation.kind === 'payment' && operation.status !== 'cancelled');
  const refunds = operations.filter((operation) => operation.kind === 'refund' && operation.status !== 'cancelled');
  const paidService = moneyNumber(payments.reduce((sum, operation) => sum + operation.serviceAmount, 0));
  const refundedService = moneyNumber(refunds.reduce((sum, operation) => sum + operation.serviceAmount, 0));
  const paidTotal = moneyNumber(payments.reduce((sum, operation) => sum + operation.total, 0));
  const refundedTotal = moneyNumber(refunds.reduce((sum, operation) => sum + operation.total, 0));

  const settlementFact = facts.find((fact) => fact.entityType === 'finance-settlement'
    && text(fact.recordId || fact.source?.id) === recordId);
  const settlement = settlementFact ? factSnapshot(settlementFact) : {};
  const planTotal = settlementFact ? moneyNumber(settlement.planTotal) : null;
  const netService = moneyNumber(Math.max(0, paidService - refundedService));
  const due = planTotal == null ? null : moneyNumber(Math.max(0, planTotal - netService));
  const paymentState = !settlementFact ? '' : netService <= 0
    ? (planTotal > 0 ? 'unpaid' : '')
    : due > 0.009 ? 'partial' : 'paid';

  return {
    payments,
    refunds,
    planTotal,
    paidAmount: moneyNumber(Math.max(0, paidTotal - refundedTotal)),
    due,
    paymentState,
  };
}

function recordItem(facts = [], recordId = '') {
  const recordFact = facts.find((fact) => fact.entityType === 'record' && text(fact.entityId) === recordId);
  if (!recordFact) return null;
  const record = factSnapshot(recordFact);
  if (!Object.keys(record).length) return null;
  const events = facts.filter((fact) => fact.entityType === 'record-event' && text(fact.recordId) === recordId);
  const state = lifecycle(recordFact, events);
  const finance = recordFinance(facts, recordId);
  const procedures = procedureNames(record);
  const products = productNames(record);
  const title = [...procedures, ...products].join(', ') || 'Запись';
  return {
    id: `record:${recordId}`,
    kind: 'record',
    recordId,
    occurredAt: appointmentMoment(record),
    createdAt: record.historicalTransfer ? text(record.createdAt) : text(record.createdAt) || text(recordFact.recordedAt || recordFact.occurredAt),
    provenance: recordFact.provenance || {},
    recordedAt: text(recordFact.recordedAt),
    appointmentDate: text(record.date),
    from: text(record.from),
    to: text(record.to),
    durationMinutes: durationMinutes(record),
    procedures,
    products,
    title,
    subtitle: statusLabel(state),
    amount: null,
    status: state.status,
    attendance: state.attendance,
    confirmed: state.confirmed,
    statusAt: state.statusAt,
    ...finance,
  };
}

function standaloneFinanceItem(fact = {}) {
  const operation = financeOperation(fact);
  if (!operation.id || operation.status === 'cancelled' || operation.status === 'deleted' || operation.kind === 'cancel') return null;
  const data = operation.data;
  let title = 'Финансовая операция';
  if (operation.kind === 'payment') title = 'Оплата';
  else if (operation.kind === 'refund') title = 'Возврат';
  else if (operation.kind === 'manual-income') title = 'Доход';
  else if (operation.kind === 'manual-expense') title = 'Расход';
  else if (operation.kind === 'deposit-funding') title = 'Депозит';
  else if (operation.kind === 'deposit-withdrawal') title = 'Возврат депозита';
  const negative = ['refund', 'manual-expense', 'deposit-withdrawal'].includes(operation.kind);
  const amount = negative ? -operation.total : operation.total;
  const lines = arrayValue(data.lines).map((item) => text(item?.lineName || item?.name)).filter(Boolean);
  return {
    id: `finance:${operation.id}`,
    kind: 'finance',
    occurredAt: operation.occurredAt,
    title,
    subtitle: lines.join(', ') || text(data.financeEntityName || data.workplace || data.note),
    amount,
    operationId: operation.id,
    provenance: fact.provenance || {},
    recordedAt: text(fact.recordedAt),
  };
}

export function projectPersonHistoryFacts(facts = []) {
  const rows = Array.isArray(facts) ? facts : [];
  const recordIds = [...new Set(rows.map((fact) => text(fact.recordId || (fact.entityType === 'record' ? fact.entityId : ''))).filter(Boolean))];
  const records = recordIds.map((recordId) => recordItem(rows, recordId)).filter(Boolean);
  const standaloneFinance = latestBy(rows.filter((fact) => fact.entityType === 'finance-operation' && !text(fact.recordId)), (fact) => fact.entityId)
    .map(standaloneFinanceItem)
    .filter(Boolean);

  return [...records, ...standaloneFinance]
    .sort((left, right) => text(right.occurredAt).localeCompare(text(left.occurredAt)));
}

export async function getPersonHistory(key = '') {
  const identityKeys = [...new Set(getIdentityMemberKeys(key).map(text).filter(Boolean))];
  if (!identityKeys.length && text(key)) identityKeys.push(text(key));
  if (!identityKeys.length) return [];
  const facts = await loadHistoryFacts({ personKeys: identityKeys, limit: 2000 });
  return projectPersonHistoryFacts(facts);
}
