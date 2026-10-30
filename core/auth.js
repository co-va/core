import { API_BASE } from './environment.js';

const TOKEN_KEY = 'book.auth.token';

function migrateSessionToken() {
  const persistent = localStorage.getItem(TOKEN_KEY) || '';
  if (persistent) return persistent;
  const sessionValue = sessionStorage.getItem(TOKEN_KEY) || '';
  if (!sessionValue) return '';
  localStorage.setItem(TOKEN_KEY, sessionValue);
  sessionStorage.removeItem(TOKEN_KEY);
  return sessionValue;
}

export function getAuthToken() {
  return localStorage.getItem(TOKEN_KEY) || migrateSessionToken();
}

export function setAuthToken(token) {
  const value = String(token || '').trim();
  sessionStorage.removeItem(TOKEN_KEY);
  if (!value) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, value);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const headers = new Headers(options.headers || {});
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !multipart && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

export async function login(identifier, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || 'Не удалось войти');
  }

  setAuthToken(payload.accessToken);
  return payload;
}

export async function requestPasswordReset(identifier) {
  const response = await apiRequest('/auth/password-reset/request', {
    method: 'POST',
    body: JSON.stringify({ identifier, email: identifier, surface: 'app' }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось отправить ссылку восстановления');
  return payload;
}

export async function getCurrentAccount() {
  const token = getAuthToken();
  if (!token) return null;
  const response = await apiRequest('/auth/me');

  if (response.status === 401) {
    clearAuthToken();
    return null;
  }

  if (!response.ok) {
    throw new Error('Не удалось проверить вход');
  }

  return response.json();
}

export async function changePassword(currentPassword, newPassword) {
  const response = await apiRequest('/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось изменить пароль');
  return payload;
}

export function logout() {
  clearAuthToken();
  window.dispatchEvent(new CustomEvent('book:auth-logout'));
}
