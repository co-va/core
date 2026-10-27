import { API_BASE } from '../environment.js';
import { getAccountToken } from '../account/index.js';

let syncInFlight = null;
let lastSyncAt = 0;

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccountToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || 'Не удалось выполнить действие с календарём.'));
  return payload;
}

export function getAccountCalendarStatus() {
  return request('/online-booking/account/calendar');
}

export async function beginGoogleCalendarConnection() {
  const payload = await request('/online-booking/account/calendar/google/connect', { method: 'POST' });
  const url = String(payload?.url || '');
  if (!url) throw new Error('Google не вернул ссылку подключения.');
  window.location.assign(url);
}

export function connectYandexCalendar({ login = '', password = '' } = {}) {
  return request('/online-booking/account/calendar/yandex/connect', {
    method: 'POST',
    body: JSON.stringify({ login, password }),
  });
}

export function disconnectAccountCalendar(provider) {
  return request(`/online-booking/account/calendar/${encodeURIComponent(String(provider || ''))}`, { method: 'DELETE' });
}

export function setAccountCalendarExport(provider, calendarId) {
  return request(`/online-booking/account/calendar/${encodeURIComponent(String(provider || ''))}/export`, {
    method: 'PUT',
    body: JSON.stringify({ calendarId }),
  });
}

export function syncAccountCalendars({ force = false } = {}) {
  const token = getAccountToken();
  if (!token) return Promise.resolve({ connected: 0, synced: 0, skipped: true });
  if (syncInFlight) return syncInFlight;
  if (!force && Date.now() - lastSyncAt < 60_000) return Promise.resolve({ connected: 0, synced: 0, skipped: true });
  syncInFlight = request('/online-booking/account/calendar/sync', { method: 'POST' })
    .then((result) => {
      lastSyncAt = Date.now();
      if (Number(result?.connected || 0) > 0) {
        window.dispatchEvent(new CustomEvent('cova:account-calendar-synced', { detail: result }));
      }
      return result;
    })
    .finally(() => { syncInFlight = null; });
  return syncInFlight;
}
