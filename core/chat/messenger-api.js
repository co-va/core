import { apiRequest } from '../auth.js';
import { API_BASE } from '../environment.js';
import { getAccountToken } from '../account/index.js';

async function jsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

async function accountRequest(tenantId, path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = getAccountToken(tenantId);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}/online-booking/${encodeURIComponent(String(tenantId || ''))}/account/messenger${path}`, {
    ...options,
    headers,
  });
}

export async function getProfessionalMessengerConversations() {
  return jsonResponse(await apiRequest('/communications/messenger/conversations'), 'Не удалось загрузить Messenger');
}

export async function ensureProfessionalDirectConversation({ phone = '', uei = '' } = {}) {
  return jsonResponse(await apiRequest('/communications/messenger/direct', {
    method: 'POST',
    body: JSON.stringify({ phone, uei }),
  }), 'Не удалось открыть диалог');
}

export async function createProfessionalMessengerGroup({ title = '', participants = [] } = {}) {
  return jsonResponse(await apiRequest('/communications/messenger/groups', {
    method: 'POST',
    body: JSON.stringify({ title, participants }),
  }), 'Не удалось создать группу');
}

export async function getProfessionalMessengerMessages(conversationId, limit = 500) {
  const query = new URLSearchParams({ limit: String(limit) });
  return jsonResponse(
    await apiRequest(`/communications/messenger/conversations/${encodeURIComponent(String(conversationId || ''))}/messages?${query}`),
    'Не удалось загрузить переписку',
  );
}

export async function markProfessionalMessengerConversationRead(conversationId) {
  return jsonResponse(await apiRequest(`/communications/messenger/conversations/${encodeURIComponent(String(conversationId || ''))}/read`, {
    method: 'POST',
  }), 'Не удалось отметить переписку прочитанной');
}

export async function sendProfessionalMessengerMessage(conversationId, { body = '', attachments = [], replyToId = '' } = {}) {
  return jsonResponse(await apiRequest(`/communications/messenger/conversations/${encodeURIComponent(String(conversationId || ''))}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, attachments, replyToId }),
  }), 'Не удалось отправить сообщение');
}

export async function editProfessionalMessengerMessage(messageId, body) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  }), 'Не удалось изменить сообщение');
}

export async function deleteProfessionalMessengerMessage(messageId) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}`, {
    method: 'DELETE',
  }), 'Не удалось удалить сообщение');
}

export async function reactProfessionalMessengerMessage(messageId, emoji) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  }), 'Не удалось изменить реакцию');
}

export async function pinProfessionalMessengerMessage(messageId) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}/pin`, {
    method: 'POST',
  }), 'Не удалось закрепить сообщение');
}

export async function forwardProfessionalMessengerMessage(messageId, conversationId) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}/forward`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  }), 'Не удалось переслать сообщение');
}

export async function createProfessionalMessengerPoll(conversationId, { question = '', options = [] } = {}) {
  return jsonResponse(await apiRequest(`/communications/messenger/conversations/${encodeURIComponent(String(conversationId || ''))}/polls`, {
    method: 'POST',
    body: JSON.stringify({ question, options }),
  }), 'Не удалось создать опрос');
}

export async function voteProfessionalMessengerPoll(messageId, optionId) {
  return jsonResponse(await apiRequest(`/communications/messenger/messages/${encodeURIComponent(String(messageId || ''))}/vote`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  }), 'Не удалось сохранить голос');
}

export async function searchProfessionalMessenger({ query = '', conversationId = '' } = {}) {
  const params = new URLSearchParams({ q: String(query || '') });
  if (conversationId) params.set('conversationId', String(conversationId));
  return jsonResponse(await apiRequest(`/communications/messenger/search?${params}`), 'Не удалось выполнить поиск');
}

export async function setProfessionalMessengerConversationState(conversationId, { archived = false, muted = false } = {}) {
  return jsonResponse(await apiRequest(`/communications/messenger/conversations/${encodeURIComponent(String(conversationId || ''))}/state`, {
    method: 'PUT',
    body: JSON.stringify({ archived, muted }),
  }), 'Не удалось изменить настройки диалога');
}

export async function getEndUserMessengerConversations(tenantId) {
  return jsonResponse(await accountRequest(tenantId, '/conversations'), 'Не удалось загрузить Messenger');
}

export async function getEndUserMessengerMessages(tenantId, conversationId, limit = 500) {
  const query = new URLSearchParams({ limit: String(limit) });
  return jsonResponse(
    await accountRequest(tenantId, `/conversations/${encodeURIComponent(String(conversationId || ''))}/messages?${query}`),
    'Не удалось загрузить переписку',
  );
}

export async function markEndUserMessengerConversationRead(tenantId, conversationId) {
  return jsonResponse(await accountRequest(tenantId, `/conversations/${encodeURIComponent(String(conversationId || ''))}/read`, {
    method: 'POST',
  }), 'Не удалось отметить переписку прочитанной');
}

export async function sendEndUserMessengerMessage(tenantId, conversationId, { body = '', attachments = [], replyToId = '' } = {}) {
  return jsonResponse(await accountRequest(tenantId, `/conversations/${encodeURIComponent(String(conversationId || ''))}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body, attachments, replyToId }),
  }), 'Не удалось отправить сообщение');
}

export async function editEndUserMessengerMessage(tenantId, messageId, body) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}`, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  }), 'Не удалось изменить сообщение');
}

export async function deleteEndUserMessengerMessage(tenantId, messageId) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}`, {
    method: 'DELETE',
  }), 'Не удалось удалить сообщение');
}

export async function reactEndUserMessengerMessage(tenantId, messageId, emoji) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}/reactions`, {
    method: 'POST',
    body: JSON.stringify({ emoji }),
  }), 'Не удалось изменить реакцию');
}

export async function pinEndUserMessengerMessage(tenantId, messageId) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}/pin`, {
    method: 'POST',
  }), 'Не удалось закрепить сообщение');
}

export async function forwardEndUserMessengerMessage(tenantId, messageId, conversationId) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}/forward`, {
    method: 'POST',
    body: JSON.stringify({ conversationId }),
  }), 'Не удалось переслать сообщение');
}

export async function voteEndUserMessengerPoll(tenantId, messageId, optionId) {
  return jsonResponse(await accountRequest(tenantId, `/messages/${encodeURIComponent(String(messageId || ''))}/vote`, {
    method: 'POST',
    body: JSON.stringify({ optionId }),
  }), 'Не удалось сохранить голос');
}

export async function searchEndUserMessenger(tenantId, { query = '', conversationId = '' } = {}) {
  const params = new URLSearchParams({ q: String(query || '') });
  if (conversationId) params.set('conversationId', String(conversationId));
  return jsonResponse(await accountRequest(tenantId, `/search?${params}`), 'Не удалось выполнить поиск');
}

export async function setEndUserMessengerConversationState(tenantId, conversationId, { archived = false, muted = false } = {}) {
  return jsonResponse(await accountRequest(tenantId, `/conversations/${encodeURIComponent(String(conversationId || ''))}/state`, {
    method: 'PUT',
    body: JSON.stringify({ archived, muted }),
  }), 'Не удалось изменить настройки диалога');
}
