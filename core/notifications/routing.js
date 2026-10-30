import { apiRequest } from '../auth.js';

export const NOTIFICATION_DELIVERY_POLICY_TYPE = '__delivery__';

async function payload(response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message || 'Не удалось сохранить настройки уведомлений');
  return value;
}

export async function getNotificationCatalog() {
  return payload(await apiRequest('/notifications/catalog'));
}

export async function getNotificationRouting() {
  return payload(await apiRequest('/notifications/routing'));
}

export async function getNotificationDeliveryRouting() {
  return payload(await apiRequest(`/notifications/routing/${encodeURIComponent(NOTIFICATION_DELIVERY_POLICY_TYPE)}`));
}

export async function saveNotificationRouting(eventType, input = {}) {
  const body = {};
  if (input.enabled !== undefined) body.enabled = Boolean(input.enabled);
  if (input.mode !== undefined) body.mode = input.mode;
  if (input.channels !== undefined) {
    body.channels = [...new Set((Array.isArray(input.channels) ? input.channels : [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter((value) => ['PUSH', 'TELEGRAM', 'EMAIL'].includes(value)))];
  }
  if (input.titleTemplate !== undefined) body.titleTemplate = input.titleTemplate;
  if (input.bodyTemplate !== undefined) body.bodyTemplate = input.bodyTemplate;

  return payload(await apiRequest(`/notifications/routing/${encodeURIComponent(eventType)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  }));
}

export async function setNotificationEnabled(eventType, enabled) {
  return saveNotificationRouting(eventType, { enabled });
}

export async function setAllNotificationsEnabled(enabled) {
  return payload(await apiRequest('/notifications/routing', {
    method: 'PUT',
    body: JSON.stringify({ enabled: Boolean(enabled) }),
  }));
}

export async function saveNotificationDeliveryRouting(input = {}) {
  return saveNotificationRouting(NOTIFICATION_DELIVERY_POLICY_TYPE, input);
}
