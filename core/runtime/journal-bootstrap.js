import { apiRequest } from '../auth.js';

const BOOTSTRAP_TIMEOUT_MS = 12000;
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
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), BOOTSTRAP_TIMEOUT_MS);
  try {
    return await payload(await apiRequest('/business-state/journal-bootstrap', { signal: controller.signal }));
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  } finally {
    window.clearTimeout(timer);
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
