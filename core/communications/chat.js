import '../chat/unread-runtime.js';
import { apiRequest } from '../auth.js';

async function jsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

export async function getCommunicationThreads(limit = 200) {
  const query = new URLSearchParams({ limit: String(limit) });
  return jsonResponse(await apiRequest(`/communications/chat/threads?${query}`), 'Не удалось загрузить чаты');
}

export async function getCommunicationThread({ phone = '', uei = '', externalThreadId = '', limit = 300 } = {}) {
  const query = new URLSearchParams({
    phone: String(phone || ''),
    uei: String(uei || ''),
    externalThreadId: String(externalThreadId || ''),
    limit: String(limit),
  });
  return jsonResponse(await apiRequest(`/communications/chat/thread?${query}`), 'Не удалось загрузить переписку');
}

export async function getCommunicationChannels({ phone = '', uei = '', externalThreadId = '' } = {}) {
  const query = new URLSearchParams({
    phone: String(phone || ''),
    uei: String(uei || ''),
    externalThreadId: String(externalThreadId || ''),
  });
  return jsonResponse(await apiRequest(`/communications/chat/channels?${query}`), 'Не удалось загрузить доступные каналы');
}

export async function getCommunicationPreferences({ phone = '', uei = '' } = {}) {
  const query = new URLSearchParams({ phone: String(phone || ''), uei: String(uei || '') });
  return jsonResponse(await apiRequest(`/communications/chat/preferences?${query}`), 'Не удалось загрузить настройки каналов');
}

export async function saveCommunicationPreferences({ phone = '', uei = '', preferredChannels = [] } = {}) {
  return jsonResponse(await apiRequest('/communications/chat/preferences', {
    method: 'PUT', body: JSON.stringify({ phone, uei, preferredChannels }),
  }), 'Не удалось сохранить настройки каналов');
}

export async function sendCommunicationMessage({ channel = '', phone = '', uei = '', externalThreadId = '', body = '', attachments = [] } = {}) {
  return jsonResponse(await apiRequest('/communications/chat/messages', {
    method: 'POST', body: JSON.stringify({ channel, phone, uei, externalThreadId, body, attachments }),
  }), 'Не удалось отправить сообщение');
}
