import { apiRequest } from '../auth.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { applyFinancePatch, hydrateFinanceFromServer } from './data.js';
import { financialNumber } from './rules.js';
import { getDDSExpenses, getDDSIncome } from './read.js';

function notifyFinanceChanged(detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('book:dds-changed', { detail }));
}

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallback);
  return payload;
}

async function applyServerState(response, fallback) {
  const payload = await responseJson(response, fallback);
  return hydrateFinanceFromServer(payload);
}

function sourceMatch(item, source) {
  return String(item?.source?.type || '') === String(source?.type || '')
    && String(item?.source?.id || '') === String(source?.id || '');
}

function operationProjection(operation = null) {
  if (!operation) return null;
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  return {
    id: String(operation?.operationId || ''),
    kind: String(operation?.kind || ''),
    status: String(operation?.status || 'completed'),
    source: operation?.source && typeof operation.source === 'object' ? { ...operation.source } : null,
    originalPaymentId: String(operation?.originalOperationId || ''),
    workplace: String(data?.workplace || ''),
    person: data?.person && typeof data.person === 'object' ? { ...data.person } : null,
    allocations: Array.isArray(data?.allocations) ? data.allocations.map((item) => ({ ...item })) : [],
    depositAllocations: Array.isArray(data?.depositAllocations) ? data.depositAllocations.map((item) => ({ ...item })) : [],
    personalAccountAmount: Math.max(0, financialNumber(data?.personalAccountAmount)),
    personalAccountRestored: Math.max(0, financialNumber(data?.personalAccountRestored)),
    total: Math.max(0, financialNumber(data?.total)),
    cashTotal: Math.max(0, financialNumber(data?.cashTotal)),
    serviceAmount: Math.max(0, financialNumber(data?.serviceAmount)),
    cashServiceAmount: Math.max(0, financialNumber(data?.cashServiceAmount)),
    tips: Math.max(0, financialNumber(data?.tips)),
    finance: data?.settlement && typeof data.settlement === 'object' ? { ...data.settlement } : null,
    walletId: String(data?.walletId || ''),
    walletName: String(data?.walletName || ''),
    reason: String(data?.reason || ''),
    occurredAt: String(operation?.occurredAt || ''),
    recordedAt: String(operation?.recordedAt || ''),
    createdAt: String(operation?.recordedAt || operation?.occurredAt || ''),
  };
}

function newestOperation(state, predicate) {
  const values = Array.isArray(state?.operations) ? state.operations : [];
  return [...values].reverse().find(predicate) || null;
}

export async function canPermanentlyDeleteFinanceData() {
  const response = await apiRequest('/saas-admin/me');
  return response.ok;
}

export async function hardDeleteFinanceWallet(walletId) {
  const id = String(walletId || '').trim();
  if (!id) return null;
  const response = await apiRequest(`/finance/wallets/${encodeURIComponent(id)}/hard`, { method: 'DELETE' });
  const state = await applyServerState(response, 'Не удалось полностью удалить кассу');
  notifyFinanceChanged({ action: 'wallet-hard-delete', walletId: id });
  return state;
}

export async function refreshFinanceState() {
  const response = await apiRequest('/finance');
  return applyServerState(response, 'Не удалось обновить Финансы');
}

export async function saveSettlementSnapshot({ source = null, settlement = null } = {}) {
  if (!source?.type || !source?.id || !settlement) return null;
  const response = await apiRequest(`/finance/settlements/${encodeURIComponent(source.type)}/${encodeURIComponent(source.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ settlement }),
  });
  const state = await applyServerState(response, 'Не удалось сохранить расчёт');
  notifyFinanceChanged({ action: 'settlement', source: { ...source } });
  return state.settlements?.find((item) => sourceMatch(item, source))?.settlement || settlement;
}

export async function createFinanceArticle(payload = {}) {
  const response = await apiRequest('/finance/articles', { method: 'POST', body: JSON.stringify(payload) });
  const state = await applyServerState(response, 'Не удалось создать статью');
  notifyFinanceChanged({ action: 'article-created' });
  return state;
}

export async function updateFinanceArticle(articleId, payload = {}) {
  const id = String(articleId || '');
  if (!id) return null;
  const response = await apiRequest(`/finance/articles/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  const state = await applyServerState(response, 'Не удалось изменить статью');
  notifyFinanceChanged({ action: 'article-updated', articleId: id });
  return state;
}

export async function archiveFinanceArticle(articleId) {
  const id = String(articleId || '');
  if (!id) return null;
  const response = await apiRequest(`/finance/articles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const state = await applyServerState(response, 'Не удалось удалить статью');
  notifyFinanceChanged({ action: 'article-archived', articleId: id });
  return state;
}

export async function recordManualFinanceOperation({ direction = '', articleId = '', walletId = '', walletName = '', amount = null, lines = [], note = '', occurredAt = null } = {}) {
  if (!occurredAt) return null;
  const response = await apiRequest('/finance/operations/manual', {
    method: 'POST',
    body: JSON.stringify({ direction, articleId, walletId, walletName, amount, lines, note, occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt }),
  });
  const state = await applyServerState(response, 'Не удалось сохранить доход или расход');
  notifyFinanceChanged({ action: 'manual-operation', direction });
  return state;
}

export async function recordSpecialFinanceOperation(payload = {}) {
  if (!payload?.occurredAt) return null;
  if (payload?.financeEntityId) await flushBusinessPersistence();
  const response = await apiRequest('/finance/operations/special', {
    method: 'POST',
    body: JSON.stringify({ ...payload, occurredAt: payload?.occurredAt instanceof Date ? payload.occurredAt.toISOString() : payload?.occurredAt }),
  });
  const state = await applyServerState(response, 'Не удалось сохранить финансовую операцию');
  notifyFinanceChanged({ action: 'special-operation', kind: String(payload?.kind || '') });
  return state;
}

export async function recordPaymentIncome({
  source = null,
  workplace = '',
  person = null,
  settlement = null,
  allocations = [],
  depositAllocations = [],
  personalAccountAmount = 0,
  finalizeDebt = false,
  maxAmount = null,
  serviceAmount = null,
  tips = 0,
  occurredAt = null,
} = {}) {
  if (!source?.type || !source?.id || !settlement || !occurredAt) return null;
  const preparedAllocations = (Array.isArray(allocations) ? allocations : [])
    .map((item) => ({ walletId: String(item?.walletId || ''), walletName: String(item?.walletName || ''), amount: Math.max(0, financialNumber(item?.amount)) }))
    .filter((item) => item.walletId && item.amount > 0);
  const preparedDeposits = (Array.isArray(depositAllocations) ? depositAllocations : [])
    .map((item) => ({ depositId: String(item?.depositId || item?.id || ''), name: String(item?.name || item?.programName || ''), amount: Math.max(0, financialNumber(item?.amount)) }))
    .filter((item) => item.depositId && item.amount > 0);
  const personalAccountTotal = Math.max(0, financialNumber(personalAccountAmount));
  const cashAllocated = preparedAllocations.reduce((sum, item) => sum + item.amount, 0);
  const depositAllocated = preparedDeposits.reduce((sum, item) => sum + item.amount, 0);
  const tipsTotal = Math.max(0, financialNumber(tips));
  const applied = Math.max(0, financialNumber(serviceAmount == null ? cashAllocated - tipsTotal + depositAllocated + personalAccountTotal : serviceAmount));
  const received = cashAllocated + depositAllocated + personalAccountTotal;
  if (!preparedAllocations.length && !preparedDeposits.length && personalAccountTotal <= 0) return null;
  if (received <= 0 || applied < 0 || (applied <= 0 && tipsTotal <= 0)) return null;
  if (maxAmount != null && applied > Math.max(0, financialNumber(maxAmount)) + 0.009) return null;
  if (Math.abs(received - applied - tipsTotal) > 0.009) return null;

  const response = await apiRequest('/finance/operations/payment', {
    method: 'POST',
    body: JSON.stringify({
      source,
      workplace,
      person,
      settlement,
      allocations: preparedAllocations,
      depositAllocations: preparedDeposits,
      personalAccountAmount: personalAccountTotal,
      finalizeDebt: finalizeDebt === true,
      serviceAmount: applied,
      tips: tipsTotal,
      occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt,
    }),
  });
  const envelope = await responseJson(response, 'Не удалось провести оплату');
  const patch = applyFinancePatch(envelope?.financePatch);
  const payment = operationProjection(patch?.operation);
  if (!payment) return null;
  payment.due = Math.max(0, financialNumber(envelope?.payment?.due));
  payment.paymentState = String(envelope?.payment?.state || '');
  notifyFinanceChanged({
    action: 'payment',
    paymentId: payment.id,
    total: payment.total,
    serviceAmount: payment.serviceAmount,
    personalAccountAmount: payment.personalAccountAmount,
    due: payment.due,
    source: payment.source,
  });
  return payment;
}

export async function correctFinanceOperation(operationId, payload = {}) {
  const id = String(operationId || '').trim();
  if (!id) return null;
  const response = await apiRequest(`/finance/operations/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...payload, occurredAt: payload?.occurredAt instanceof Date ? payload.occurredAt.toISOString() : payload?.occurredAt }),
  });
  const state = await applyServerState(response, 'Не удалось скорректировать операцию');
  const operation = state.operations.find((item) => String(item?.operationId || '') === id) || null;
  notifyFinanceChanged({ action: 'operation-corrected', operationId: id, source: operation?.source || null });
  return operationProjection(operation);
}

export async function hardDeleteFinanceOperation(operationId) {
  const id = String(operationId || '').trim();
  if (!id) return null;
  const response = await apiRequest(`/finance/operations/${encodeURIComponent(id)}/hard`, { method: 'DELETE' });
  const state = await applyServerState(response, 'Не удалось полностью удалить операцию');
  notifyFinanceChanged({ action: 'operation-hard-delete', operationId: id });
  return state;
}

export async function cancelFinanceOperation(operationId, { reason = 'incorrect-entry', occurredAt = null } = {}) {
  const id = String(operationId || '');
  if (!id || !occurredAt) return null;
  const response = await apiRequest(`/finance/operations/${encodeURIComponent(id)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason, occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt }),
  });
  const state = await applyServerState(response, 'Не удалось отменить операцию');
  const operation = state.operations.find((item) => String(item?.operationId || '') === id) || null;
  if (!operation) return null;
  notifyFinanceChanged({ action: 'operation-cancelled', operationId: id, source: operation.source || null });
  return operationProjection(operation);
}

export async function cancelPaymentOperation(paymentId, options = {}) {
  return cancelFinanceOperation(paymentId, options);
}

export async function recordRefundExpense(paymentId, { reason = '', amount = null, walletId = '', walletName = '', occurredAt = null } = {}) {
  const id = String(paymentId || '');
  if (!id || !occurredAt) return null;
  const response = await apiRequest(`/finance/operations/${encodeURIComponent(id)}/refund`, {
    method: 'POST',
    body: JSON.stringify({ reason, amount, walletId, walletName, occurredAt: occurredAt instanceof Date ? occurredAt.toISOString() : occurredAt }),
  });
  const state = await applyServerState(response, 'Не удалось выполнить возврат');
  const operation = newestOperation(state, (item) => String(item?.kind || '') === 'refund' && String(item?.originalOperationId || '') === id);
  const refund = operationProjection(operation);
  if (!refund) return null;
  notifyFinanceChanged({ action: 'refund', paymentId: refund.id, originalPaymentId: id, total: refund.total, serviceAmount: refund.serviceAmount, tips: refund.tips, source: refund.source || null });
  return refund;
}
