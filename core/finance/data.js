// Browser Finance read cache only.
// Canonical persistence is server FinanceSettlement + FinanceOperation + FinanceLedgerEntry.
const VERSION = 7;
let financeState = emptyState();
let financeRevision = 0;

function numberValue(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
}

function sourceKey(source = null) {
  return `${String(source?.type || '')}:${String(source?.id || '')}`;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function emptyState() {
  return { version: VERSION, articles: [], settlements: [], operations: [], ledger: [] };
}

function bumpRevision() {
  financeRevision += 1;
}

function normalizeSettlementSnapshot(value = null) {
  if (!value || typeof value !== 'object') return null;
  return {
    items: Array.isArray(value.items) ? value.items.map((item) => ({ ...item })) : [],
    serviceTotal: Math.max(0, numberValue(value.serviceTotal)),
    discountPercent: value.discountPercent == null ? null : Math.max(0, Math.min(100, numberValue(value.discountPercent))),
    discountTotal: Math.max(0, numberValue(value.discountTotal)),
    planTotal: Math.max(0, numberValue(value.planTotal)),
  };
}

function normalizeSettlementRow(row = {}) {
  const source = row?.source && typeof row.source === 'object' ? row.source : {};
  const settlement = normalizeSettlementSnapshot(row?.settlement ?? row?.data);
  if (!source?.type || !source?.id || !settlement) return null;
  return {
    source: { type: String(source.type), id: String(source.id) },
    settlement,
    recordedAt: String(row?.recordedAt || ''),
    updatedAt: String(row?.updatedAt || ''),
  };
}

function normalizeOperation(row = {}) {
  return {
    operationId: String(row?.operationId || row?.id || ''),
    kind: String(row?.kind || ''),
    status: String(row?.status || 'completed'),
    source: row?.source && typeof row.source === 'object' ? { ...row.source } : null,
    originalOperationId: String(row?.originalOperationId || ''),
    occurredAt: String(row?.occurredAt || ''),
    recordedAt: String(row?.recordedAt || row?.createdAt || ''),
    data: row?.data && typeof row.data === 'object' ? clone(row.data) : {},
  };
}

function normalizeLedgerEntry(row = {}) {
  return {
    entryId: String(row?.entryId || row?.id || ''),
    operationId: String(row?.operationId || ''),
    walletId: String(row?.walletId || ''),
    walletName: String(row?.walletName || ''),
    direction: String(row?.direction || ''),
    economicType: String(row?.economicType || ''),
    amount: Math.max(0, numberValue(row?.amount)),
    occurredAt: String(row?.occurredAt || ''),
    recordedAt: String(row?.recordedAt || row?.createdAt || ''),
    source: row?.source && typeof row.source === 'object' ? { ...row.source } : null,
    component: String(row?.component || ''),
    relatedOperationId: String(row?.relatedOperationId || ''),
    articleId: String(row?.articleId || ''),
    articleName: String(row?.articleName || ''),
    lineName: String(row?.lineName || ''),
    quantity: row?.quantity == null ? null : numberValue(row.quantity),
    unitPrice: row?.unitPrice == null ? null : Math.max(0, numberValue(row.unitPrice)),
    note: String(row?.note || ''),
  };
}

function normalizedState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    version: VERSION,
    articles: (Array.isArray(value.articles) ? value.articles : []).map((row) => ({
      articleId: String(row?.articleId || ''),
      parentArticleId: String(row?.parentArticleId || ''),
      name: String(row?.name || ''),
      direction: String(row?.direction || ''),
      economicType: String(row?.economicType || ''),
      systemKey: String(row?.systemKey || ''),
      position: Number(row?.position) || 0,
      archivedAt: String(row?.archivedAt || ''),
    })).filter((row) => row.articleId && row.name),
    settlements: (Array.isArray(value.settlements) ? value.settlements : []).map(normalizeSettlementRow).filter(Boolean),
    operations: (Array.isArray(value.operations) ? value.operations : []).map(normalizeOperation),
    ledger: (Array.isArray(value.ledger) ? value.ledger : []).map(normalizeLedgerEntry),
  };
}

export function hydrateFinanceFromServer(value = null) {
  financeState = normalizedState(value) || emptyState();
  bumpRevision();
  return clone(financeState);
}

export function applyFinancePatch(value = null) {
  const patch = value && typeof value === 'object' ? value : {};
  const settlement = normalizeSettlementRow(patch.settlement);
  const operation = patch.operation ? normalizeOperation(patch.operation) : null;
  let changed = false;
  if (settlement) {
    const key = sourceKey(settlement.source);
    financeState.settlements = [
      ...financeState.settlements.filter((row) => sourceKey(row?.source) !== key),
      settlement,
    ];
    changed = true;
  }
  if (operation?.operationId) {
    financeState.operations = [
      ...financeState.operations.filter((row) => String(row?.operationId || '') !== operation.operationId),
      operation,
    ];
    changed = true;
  }
  if (changed) bumpRevision();
  return clone({ settlement, operation });
}

export function replaceFinanceState(value = null) {
  financeState = normalizedState(value) || emptyState();
  bumpRevision();
  return clone(financeState);
}

export function getFinanceRevision() {
  return financeRevision;
}

export function readFinanceState() {
  return clone(financeState);
}

export function getStoredSettlement(type, id) {
  const key = `${String(type || '')}:${String(id || '')}`;
  const row = financeState.settlements.find((item) => sourceKey(item?.source) === key);
  return row?.settlement ? clone(row.settlement) : null;
}

export function getFinanceArticles() {
  return clone(financeState.articles || []);
}

export function getFinanceOperation(operationId) {
  const id = String(operationId || '');
  const row = financeState.operations.find((item) => String(item?.operationId || '') === id);
  return row ? clone(row) : null;
}
