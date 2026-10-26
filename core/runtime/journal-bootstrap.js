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

if (typeof window !== 'undefined') {
  window.addEventListener('book:auth-logout', reset);
}

export async function consumeJournalBootstrap(slice) {
  const key = String(slice || '').trim();
  if (!key || consumed.has(key)) return null;
  consumed.add(key);
  try {
    if (!bootstrapRequest) {
      bootstrapRequest = apiRequest('/business-state/journal-bootstrap').then(payload).catch((error) => {
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
