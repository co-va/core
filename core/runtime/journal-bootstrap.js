import { apiRequest } from '../auth.js';

let bootstrapRequest = null;
let consumed = new Set();

async function payload(response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message || 'Не удалось загрузить стартовые данные');
  return value;
}

function reset() {
  bootstrapRequest = null;
  consumed = new Set();
}

async function requestBootstrap() {
  try {
    return await payload(await apiRequest('/business-state/journal-bootstrap'));
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('book:auth-logout', reset);
}

export async function consumeJournalBootstrap(slice, { start = true } = {}) {
  const key = String(slice || '').trim();
  if (!key || consumed.has(key)) return null;
  if (!bootstrapRequest && !start) return null;
  consumed.add(key);
  try {
    if (!bootstrapRequest) {
      bootstrapRequest = requestBootstrap().catch((error) => {
        bootstrapRequest = null;
        consumed.clear();
        throw error;
      });
    }
    const value = await bootstrapRequest;
    return value?.[key] ?? null;
  } catch (error) {
    consumed.delete(key);
    throw error;
  }
}
