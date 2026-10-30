import { apiRequest } from '../auth.js';

async function jsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallbackMessage);
  return payload;
}

export async function getTelegramBotConnection() {
  return jsonResponse(await apiRequest('/communications/integrations/telegram'), 'Не удалось загрузить Telegram-интеграцию');
}

export async function connectTelegramBot(token) {
  return jsonResponse(await apiRequest('/communications/integrations/telegram', {
    method: 'PUT', body: JSON.stringify({ token: String(token || '').trim() }),
  }), 'Не удалось подключить Telegram-бота');
}

export async function disconnectTelegramBot() {
  return jsonResponse(await apiRequest('/communications/integrations/telegram', { method: 'DELETE' }), 'Не удалось отключить Telegram-бота');
}
