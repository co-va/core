import { API_BASE } from '../environment.js';
import { getAccountToken } from './index.js';

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccountToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось изменить email');
  return payload;
}

export function getAccountEmailVerification() {
  return request('/online-booking/account/email-verification/status');
}

export function requestAccountEmailVerification() {
  return request('/online-booking/account/email-verification/request', { method: 'POST' });
}

export function changeAccountEmail(email) {
  return request('/online-booking/account/email-verification/change', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}
