import { getFinanceRevision, readFinanceState } from './data.js';
import { financialNumber } from './rules.js';

let cachedOperationRevision = -1;
let cachedOperationMovements = [];
let cachedActiveMovements = [];
let cachedActiveBySource = new Map();

function sourceKey(source = null) {
  return `${String(source?.type || '')}:${String(source?.id || '')}`;
}

function cloneRows(rows = []) {
  return JSON.parse(JSON.stringify(Array.isArray(rows) ? rows : []));
}

function isActiveMovement(item = null) {
  return item?.status !== 'cancelled';
}

function operationMovement(operation = null) {
  if (!operation || operation.kind === 'cancel' || operation.kind === 'transfer') return null;
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const source = operation?.source && typeof operation.source === 'object' ? { ...operation.source } : null;
  const total = Math.max(0, financialNumber(data.total));
  const serviceAmount = Math.max(0, financialNumber(data.serviceAmount));
  const tips = Math.max(0, financialNumber(data.tips));
  const base = {
    id: String(operation.operationId || ''),
    status: String(operation.status || 'completed'),
    source,
    workplace: String(data.workplace || ''),
    person: data.person && typeof data.person === 'object' ? { ...data.person } : null,
    financeEntityType: String(data.financeEntityType || ''),
    financeEntityId: String(data.financeEntityId || ''),
    financeEntityName: String(data.financeEntityName || ''),
    total,
    serviceAmount,
    tips,
    finance: data.settlement && typeof data.settlement === 'object' ? { ...data.settlement } : null,
    occurredAt: String(operation.occurredAt || ''),
    recordedAt: String(operation.recordedAt || ''),
    createdAt: String(operation.recordedAt || operation.occurredAt || ''),
  };

  if (operation.kind === 'payment') {
    const allocations = Array.isArray(data.allocations) ? data.allocations.map((entry) => ({ ...entry })) : [];
    return {
      ...base,
      movementType: 'income',
      incomeType: 'payment',
      allocations,
      walletId: allocations.length === 1 ? String(allocations[0]?.walletId || '') : '',
      walletName: allocations.length === 1 ? String(allocations[0]?.walletName || '') : '',
      paidAt: String(operation.occurredAt || ''),
    };
  }

  if (operation.kind === 'manual-income' || operation.kind === 'loan-received' || operation.kind === 'investment-received') {
    return {
      ...base,
      movementType: 'income',
      incomeType: operation.kind === 'manual-income' ? 'manual' : String(operation.kind || ''),
      walletId: String(data.walletId || ''),
      walletName: String(data.walletName || ''),
      articleId: String(data.articleId || ''),
      note: String(data.note || ''),
      paidAt: String(operation.occurredAt || ''),
    };
  }

  return {
    ...base,
    movementType: 'expense',
    expenseType: operation.kind === 'refund'
      ? 'refund'
      : (operation.kind === 'manual-expense' ? 'manual' : String(operation.kind || 'expense')),
    originalPaymentId: String(operation.originalOperationId || ''),
    walletId: String(data.walletId || ''),
    walletName: String(data.walletName || ''),
    reason: String(data.reason || ''),
    note: String(data.note || ''),
    refundedAt: String(operation.occurredAt || ''),
  };
}

function projectOperationMovements(state = {}) {
  return (Array.isArray(state.operations) ? state.operations : [])
    .map(operationMovement)
    .filter(Boolean)
    .sort((a, b) => String(a?.occurredAt || '').localeCompare(String(b?.occurredAt || '')));
}

function ensureOperationProjection() {
  const revision = getFinanceRevision();
  if (cachedOperationRevision === revision) return;

  cachedOperationMovements = projectOperationMovements(readFinanceState());
  cachedActiveMovements = cachedOperationMovements.filter(isActiveMovement);
  cachedActiveBySource = new Map();
  for (const movement of cachedActiveMovements) {
    const key = sourceKey(movement?.source);
    const bucket = cachedActiveBySource.get(key) || [];
    bucket.push(movement);
    cachedActiveBySource.set(key, bucket);
  }
  cachedOperationRevision = revision;
}

function operationMovements(state = null) {
  if (state) return projectOperationMovements(state);
  ensureOperationProjection();
  return cachedOperationMovements;
}

function refundsForPayment(state, paymentId) {
  return operationMovements(state).filter((item) => isActiveMovement(item)
    && item?.movementType === 'expense'
    && item?.expenseType === 'refund'
    && String(item?.originalPaymentId || '') === String(paymentId || ''));
}

export function getDDSIncome() {
  return cloneRows(operationMovements().filter((item) => item.movementType === 'income'));
}

export function getDDSExpenses() {
  return cloneRows(operationMovements().filter((item) => item.movementType === 'expense'));
}

export function getDDSMovements() {
  return cloneRows(operationMovements());
}

export function getDDSMovementsForSource(type, id) {
  const key = `${String(type || '')}:${String(id || '')}`;
  return cloneRows(operationMovements().filter((item) => sourceKey(item?.source) === key));
}

export function getActiveDDSMovements() {
  ensureOperationProjection();
  return cloneRows(cachedActiveMovements);
}

export function getActiveDDSMovementsForSource(type, id) {
  ensureOperationProjection();
  const key = `${String(type || '')}:${String(id || '')}`;
  return cloneRows(cachedActiveBySource.get(key) || []);
}

function projectLedgerEntry(state, entry) {
  const operation = state.operations.find((item) => String(item?.operationId || '') === String(entry?.operationId || '')) || null;
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const settlement = data?.settlement && typeof data.settlement === 'object' ? data.settlement : null;
  const sourceDetails = (Array.isArray(settlement?.items) ? settlement.items : [])
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean)
    .join(', ');
  const amount = Math.max(0, financialNumber(entry?.amount));
  return {
    ...entry,
    operationKind: operation?.kind || '',
    operationStatus: operation?.status || 'completed',
    ledgerType: entry?.economicType || operation?.kind || 'ledger',
    movementType: entry?.direction === 'OUT' ? 'expense' : 'income',
    total: entry?.direction === 'OUT' ? -amount : amount,
    occurredAt: entry?.occurredAt || operation?.occurredAt || '',
    recordedAt: entry?.recordedAt || operation?.recordedAt || '',
    person: data?.person || null,
    workplace: data?.workplace || '',
    source: entry?.source || operation?.source || null,
    sourceDetails,
    operationTotal: Math.max(0, financialNumber(data?.total)),
    allocations: (Array.isArray(data?.allocations) ? data.allocations : []).map((item) => ({ ...item })),
    settlementItems: (Array.isArray(settlement?.items) ? settlement.items : []).map((item) => ({ ...item })),
    financeEntityType: String(data?.financeEntityType || ''),
    financeEntityId: String(data?.financeEntityId || ''),
    financeEntityName: String(data?.financeEntityName || ''),
    note: entry?.note || data?.note || '',
    counterparty: data?.counterparty || '',
  };
}

export function getLedgerEntries() {
  const state = readFinanceState();
  return state.ledger
    .map((entry) => projectLedgerEntry(state, entry))
    .sort((a, b) => String(a?.occurredAt || '').localeCompare(String(b?.occurredAt || '')));
}

export function getLedgerEntriesForSource(type, id) {
  const key = `${String(type || '')}:${String(id || '')}`;
  return getLedgerEntries().filter((entry) => sourceKey(entry?.source) === key);
}

export function getWalletDDSMovements(walletId) {
  const id = String(walletId || '');
  return getLedgerEntries().filter((entry) => String(entry?.walletId || '') === id);
}

export function getFinanceEntityMovements(type, id) {
  const entityType = String(type || '');
  const entityId = String(id || '');
  return getLedgerEntries().filter((entry) => String(entry?.financeEntityType || '') === entityType
    && String(entry?.financeEntityId || '') === entityId);
}

export function getFinanceEntityBalance(type, id) {
  const total = getFinanceEntityMovements(type, id)
    .filter((entry) => entry?.operationStatus !== 'cancelled' && entry?.economicType !== 'REVERSAL')
    .reduce((sum, entry) => {
      const amount = Math.max(0, financialNumber(entry?.amount));
      return sum + (entry?.direction === 'OUT' ? -amount : amount);
    }, 0);
  return Math.round(total * 100) / 100;
}

export function getRefundsForPayment(paymentId) {
  return refundsForPayment(readFinanceState(), paymentId).map((item) => ({ ...item }));
}

export function getPaymentRemaining(paymentId) {
  const state = readFinanceState();
  const payment = operationMovements(state).find((item) => item?.movementType === 'income'
    && item?.incomeType === 'payment'
    && String(item?.id || '') === String(paymentId || ''));
  if (!payment || !isActiveMovement(payment)) return 0;
  const refunded = refundsForPayment(state, payment.id)
    .reduce((sum, item) => sum + Math.max(0, financialNumber(item?.total)), 0);
  return Math.max(0, financialNumber(payment.total) - refunded);
}

function reportBoundary(value, fallback) {
  if (value instanceof Date) return value.getTime();
  if (value == null || value === '') return fallback;
  const time = new Date(String(value)).getTime();
  return Number.isFinite(time) ? time : fallback;
}

function addBreakdown(map, key, label, direction, amount) {
  const id = String(key || 'unknown');
  const current = map.get(id) || { id, label: String(label || key || 'Без значения'), incoming: 0, outgoing: 0, net: 0 };
  if (direction === 'OUT') current.outgoing += amount;
  else current.incoming += amount;
  current.net = current.incoming - current.outgoing;
  map.set(id, current);
}

export function getZReport({ from = null, to = null } = {}) {
  const fromMs = reportBoundary(from, Number.NEGATIVE_INFINITY);
  const toMs = reportBoundary(to, Number.POSITIVE_INFINITY);
  const entries = getLedgerEntries().filter((entry) => {
    const time = new Date(String(entry?.occurredAt || '')).getTime();
    if (!Number.isFinite(time) || time < fromMs || time > toMs) return false;
    if (entry?.operationStatus === 'cancelled') return false;
    if (entry?.economicType === 'REVERSAL') return false;
    return true;
  });

  const walletMap = new Map();
  const articleMap = new Map();
  const economicMap = new Map();
  const totals = {
    incoming: 0,
    outgoing: 0,
    netCash: 0,
    serviceRevenue: 0,
    operatingRevenue: 0,
    productRevenue: 0,
    operatingExpense: 0,
    tax: 0,
    tips: 0,
    refunds: 0,
    loanReceived: 0,
    loanRepaid: 0,
    investmentReceived: 0,
    investmentReturned: 0,
    transferIn: 0,
    transferOut: 0,
    reversalsIn: 0,
    reversalsOut: 0,
  };

  for (const entry of entries) {
    const amount = Math.max(0, financialNumber(entry?.amount));
    const direction = String(entry?.direction || '');
    const economicType = String(entry?.economicType || '');
    if (direction === 'OUT') totals.outgoing += amount;
    else totals.incoming += amount;

    addBreakdown(walletMap, entry?.walletId, entry?.walletName || entry?.walletId, direction, amount);
    addBreakdown(articleMap, entry?.articleId || economicType, entry?.articleName || economicType, direction, amount);
    addBreakdown(economicMap, economicType, economicType, direction, amount);

    if (economicType === 'SERVICE_REVENUE') totals.serviceRevenue += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'OPERATING_REVENUE') totals.operatingRevenue += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'PRODUCT_REVENUE') totals.productRevenue += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'OPERATING_EXPENSE') totals.operatingExpense += direction === 'IN' ? -amount : amount;
    else if (economicType === 'TAX') totals.tax += direction === 'IN' ? -amount : amount;
    else if (economicType === 'TIPS') totals.tips += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'SERVICE_REFUND' || economicType === 'TIPS_REFUND' || economicType === 'REFUND') totals.refunds += direction === 'IN' ? -amount : amount;
    else if (economicType === 'LOAN_RECEIVED') totals.loanReceived += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'LOAN_REPAYMENT') totals.loanRepaid += direction === 'IN' ? -amount : amount;
    else if (economicType === 'INVESTMENT_RECEIVED') totals.investmentReceived += direction === 'OUT' ? -amount : amount;
    else if (economicType === 'INVESTMENT_RETURN') totals.investmentReturned += direction === 'IN' ? -amount : amount;
    else if (economicType === 'TRANSFER') {
      if (direction === 'OUT') totals.transferOut += amount;
      else totals.transferIn += amount;
    } else if (economicType === 'REVERSAL') {
      if (direction === 'OUT') totals.reversalsOut += amount;
      else totals.reversalsIn += amount;
    }
  }

  totals.incoming = Math.round(totals.incoming * 100) / 100;
  totals.outgoing = Math.round(totals.outgoing * 100) / 100;
  totals.netCash = Math.round((totals.incoming - totals.outgoing) * 100) / 100;

  const normalizeRows = (map) => [...map.values()]
    .map((row) => ({
      ...row,
      incoming: Math.round(row.incoming * 100) / 100,
      outgoing: Math.round(row.outgoing * 100) / 100,
      net: Math.round(row.net * 100) / 100,
    }))
    .sort((a, b) => String(a.label).localeCompare(String(b.label), 'ru'));

  return {
    from: Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : '',
    to: Number.isFinite(toMs) ? new Date(toMs).toISOString() : '',
    entries,
    totals,
    byWallet: normalizeRows(walletMap),
    byArticle: normalizeRows(articleMap),
    byEconomicType: normalizeRows(economicMap),
  };
}
