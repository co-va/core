import { getAccountToken } from '../account/index.js';
import { API_BASE } from '../environment.js';

async function pushRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccountToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}/online-booking/account/push${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(payload?.message) ? payload.message[0] : payload?.message;
    throw new Error(String(message || 'Не удалось выполнить настройку Push'));
  }
  return payload;
}

export function getGlobalWebPushConfiguration() {
  return pushRequest('/config');
}

export function saveGlobalWebPushSubscription(subscription) {
  return pushRequest('/subscription', {
    method: 'PUT',
    body: JSON.stringify({ subscription }),
  });
}

export function deleteGlobalWebPushSubscription(endpoint) {
  return pushRequest('/subscription', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}
