import { API_BASE } from './environment.js';

const TOKEN_KEY = 'book.auth.token';
const SESSION_CHECK_TIMEOUT_MS = 12000;
const JOURNAL_BOOTSTRAP_TIMEOUT_MS = 12000;
const DEFAULT_READ_TIMEOUT_MS = 12000;
const OPTIONAL_STARTUP_READ_TIMEOUT_MS = 8000;
const LOGIN_TIMEOUT_MS = 12000;

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

function timeoutValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultReadTimeout(path) {
  if (path === '/business-state/journal-bootstrap') return JOURNAL_BOOTSTRAP_TIMEOUT_MS;
  if (path === '/profile' || path === '/finance') return OPTIONAL_STARTUP_READ_TIMEOUT_MS;
  return DEFAULT_READ_TIMEOUT_MS;
}

export async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const { timeoutMs, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers || {});
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (requestOptions.body != null && !multipart && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const url = `${API_BASE}${path}`;
  if (requestOptions.signal) return fetch(url, { ...requestOptions, headers });

  const method = String(requestOptions.method || 'GET').toUpperCase();
  const shouldBound = timeoutMs != null || method === 'GET' || method === 'HEAD';
  if (!shouldBound) return fetch(url, { ...requestOptions, headers });

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutValue(timeoutMs, defaultReadTimeout(path)));
  try {
    return await fetch(url, { ...requestOptions, headers, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function login(identifier, password) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Сервер не ответил вовремя');
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }

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

  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), SESSION_CHECK_TIMEOUT_MS);
  let response;
  try {
    response = await apiRequest('/auth/me', { signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Сервер не ответил вовремя');
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }

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
