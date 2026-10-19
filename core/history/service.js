import { apiRequest } from '../auth.js';

const text = (value) => String(value ?? '').trim();

export async function loadHistoryFacts({
  personKeys = [],
  recordId = '',
  workplaceKey = '',
  procedureId = '',
  documentId = '',
  inventoryItemId = '',
  financeOperationId = '',
  entityType = '',
  entityId = '',
  from = '',
  to = '',
  limit = 2000,
} = {}) {
  const params = new URLSearchParams();
  const keys = [...new Set((Array.isArray(personKeys) ? personKeys : [personKeys]).map(text).filter(Boolean))];
  if (keys.length) params.set('personKeys', keys.join(','));
  if (text(recordId)) params.set('recordId', text(recordId));
  if (text(workplaceKey)) params.set('workplaceKey', text(workplaceKey));
  if (text(procedureId)) params.set('procedureId', text(procedureId));
  if (text(documentId)) params.set('documentId', text(documentId));
  if (text(inventoryItemId)) params.set('inventoryItemId', text(inventoryItemId));
  if (text(financeOperationId)) params.set('financeOperationId', text(financeOperationId));
  if (text(entityType)) params.set('entityType', text(entityType));
  if (text(entityId)) params.set('entityId', text(entityId));
  if (text(from)) params.set('from', text(from));
  if (text(to)) params.set('to', text(to));
  params.set('limit', String(Math.max(1, Math.min(2000, Number(limit) || 2000))));

  const response = await apiRequest(`/history?${params.toString()}`);
  if (!response.ok) {
    let message = 'Не удалось загрузить историю';
    try {
      const body = await response.json();
      message = text(body?.message) || message;
    } catch {
      // Keep the stable user-facing message when the server returned no JSON.
    }
    throw new Error(message);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

export async function loadHistoryStateAt({ entityType, entityId, at } = {}) {
  const params = new URLSearchParams({
    entityType: text(entityType),
    entityId: text(entityId),
    at: text(at),
  });
  const response = await apiRequest(`/history/as-of?${params.toString()}`);
  if (!response.ok) throw new Error('Не удалось получить состояние на выбранную дату');
  return response.json();
}
