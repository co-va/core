import { API_BASE } from '../environment.js';

const ACCOUNT_TOKEN_KEY = 'book.account.token';
const ACCOUNT_EMAIL_KEY = 'book.account.email';
const ACCOUNT_UNREAD_KEY = '__VA_TOOLS_ACCOUNT_UNREAD__';
let globalAccountCacheToken = '';
let globalAccountCache = null;

function unreadSnapshot() {
  if (typeof globalThis === 'undefined') return { total: 0, byTenant: {} };
  const value = globalThis[ACCOUNT_UNREAD_KEY];
  if (value && typeof value === 'object' && value.byTenant && typeof value.byTenant === 'object') return value;
  const initial = { total: 0, byTenant: {} };
  globalThis[ACCOUNT_UNREAD_KEY] = initial;
  return initial;
}

function syncInstalledBadge(total) {
  if (typeof navigator === 'undefined') return;
  const count = Math.max(0, Math.trunc(Number(total) || 0));
  if (count > 0 && typeof navigator.setAppBadge === 'function') {
    void navigator.setAppBadge(count).catch(() => {});
  } else if (count === 0 && typeof navigator.clearAppBadge === 'function') {
    void navigator.clearAppBadge().catch(() => {});
  }
}

function publishUnread(byTenant = {}) {
  const normalized = {};
  for (const [tenantId, value] of Object.entries(byTenant || {})) {
    const id = String(tenantId || '').trim();
    const count = Math.max(0, Math.trunc(Number(value) || 0));
    if (id) normalized[id] = count;
  }
  const total = Object.values(normalized).reduce((sum, value) => sum + Number(value || 0), 0);
  const snapshot = { total, byTenant: normalized };
  if (typeof globalThis !== 'undefined') globalThis[ACCOUNT_UNREAD_KEY] = snapshot;
  syncInstalledBadge(total);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('va-tools:account-unread', { detail: snapshot }));
  }
  return snapshot;
}

function setTenantUnread(tenantId, count) {
  const id = String(tenantId || '').trim();
  if (!id) return unreadSnapshot();
  const current = unreadSnapshot();
  return publishUnread({ ...current.byTenant, [id]: Math.max(0, Math.trunc(Number(count) || 0)) });
}

export function getAccountUnreadState() {
  const current = unreadSnapshot();
  return { total: Number(current.total || 0), byTenant: { ...current.byTenant } };
}

export function getGlobalAccountUnreadCount() {
  return Math.max(0, Math.trunc(Number(unreadSnapshot().total) || 0));
}

export function getTenantAccountUnreadCount(tenantId) {
  const id = String(tenantId || '').trim();
  return Math.max(0, Math.trunc(Number(unreadSnapshot().byTenant?.[id]) || 0));
}

export function getAccountToken() {
  return localStorage.getItem(ACCOUNT_TOKEN_KEY) || '';
}

export function getRememberedAccountEmail() {
  return localStorage.getItem(ACCOUNT_EMAIL_KEY) || '';
}

export function clearAccount() {
  localStorage.removeItem(ACCOUNT_TOKEN_KEY);
  globalAccountCacheToken = '';
  globalAccountCache = null;
  publishUnread({});
}

async function request(path, { tenantId = '', auth = false, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (auth) {
    const token = getAccountToken(tenantId);
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return fetch(`${API_BASE}${path}`, { ...options, headers });
}

const TECHNICAL_ACCOUNT_MESSAGE = /(?:\b(?:Account|tenant|Prisma|Exception|Error|stack|SQL|token|undefined|null|Book)\b|\bid\b|\.js\b|\.ts\b|\/api\/|\{.*\}|\[.*\])/i;

function safeAccountApiMessage(value, fallbackMessage) {
  const raw = Array.isArray(value) ? value[0] : value;
  const message = String(raw || '').trim();
  const system = !message
    || message.length > 240
    || message.includes('\n')
    || TECHNICAL_ACCOUNT_MESSAGE.test(message)
    || !/[А-Яа-яЁё]/.test(message);
  return { message: system ? fallbackMessage : message, system };
}

class AccountRequestError extends Error {
  constructor(message, { system = false } = {}) {
    super(message);
    this.name = 'AccountRequestError';
    this.userSafe = true;
    this.system = Boolean(system);
  }
}

export function accountErrorMessage(error, fallbackMessage) {
  return error instanceof AccountRequestError && error.userSafe === true
    ? error.message
    : fallbackMessage;
}

export function isAccountSystemError(error) {
  return !(error instanceof AccountRequestError) || error.system === true;
}

async function jsonResponse(response, fallbackMessage) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const safe = safeAccountApiMessage(payload?.message, fallbackMessage);
    throw new AccountRequestError(safe.message, { system: safe.system });
  }
  return payload;
}

function storeSession(_tenantId, payload) {
  if (payload?.accessToken) {
    localStorage.setItem(ACCOUNT_TOKEN_KEY, payload.accessToken);
    publishUnread({});
  }
  if (payload?.account?.email) localStorage.setItem(ACCOUNT_EMAIL_KEY, payload.account.email);
  if (payload?.account && payload?.accessToken) {
    globalAccountCacheToken = String(payload.accessToken);
    globalAccountCache = payload.account;
  }
  return payload;
}

export async function getAccountTerms() {
  return jsonResponse(
    await request('/online-booking/account-terms'),
    'Не удалось загрузить Условия использования учетной записи',
  );
}

export async function getGlobalAccountPlatformState() {
  return jsonResponse(
    await request('/online-booking/account/platform-state', { auth: true }),
    'Не удалось проверить Условия использования учетной записи',
  );
}

export async function acceptGlobalAccountTerms(accountTerms) {
  return jsonResponse(
    await request('/online-booking/account/platform-terms', {
      auth: true,
      method: 'POST',
      body: JSON.stringify({ accountTerms }),
    }),
    'Не удалось сохранить принятие Условий использования учетной записи',
  );
}

export async function prepareGlobalAccount(input) {
  const body = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : { identifier: String(input || '').trim() };
  return jsonResponse(
    await request('/online-booking/account/prepare', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    'Не удалось проверить аккаунт',
  );
}

export async function registerGlobalAccount(data) {
  const payload = await jsonResponse(
    await request('/online-booking/account/register', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
    'Не удалось создать аккаунт',
  );
  return storeSession('', payload);
}

export async function loginGlobalAccount(identifier, password) {
  const payload = await jsonResponse(
    await request('/online-booking/account/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
    'Не удалось войти',
  );
  return storeSession('', payload);
}

export async function getGlobalAccount() {
  const token = getAccountToken('');
  if (!token) return null;
  if (globalAccountCache && globalAccountCacheToken === token) return globalAccountCache;
  const response = await request('/online-booking/account/me', { auth: true });
  if (response.status === 401) {
    clearAccount('');
    return null;
  }
  const account = await jsonResponse(response, 'Не удалось открыть аккаунт');
  globalAccountCacheToken = token;
  globalAccountCache = account;
  return account;
}

export async function updateGlobalAccount(data) {
  const account = await jsonResponse(
    await request('/online-booking/account/me', {
      auth: true,
      method: 'PUT',
      body: JSON.stringify(data || {}),
    }),
    'Не удалось обновить аккаунт',
  );
  globalAccountCacheToken = getAccountToken('');
  globalAccountCache = account;
  return account;
}

export async function deleteGlobalAccount() {
  const result = await jsonResponse(
    await request('/online-booking/account/me', {
      auth: true,
      method: 'DELETE',
    }),
    'Не удалось удалить профиль',
  );
  clearAccount('');
  return result;
}

export async function changeGlobalAccountPassword(currentPassword, newPassword) {
  return jsonResponse(
    await request('/online-booking/account/password', {
      auth: true,
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
    'Не удалось изменить пароль',
  );
}

export async function getGlobalAccountUnreadSummary() {
  const payload = await jsonResponse(
    await request('/online-booking/account/unread-summary', { auth: true }),
    'Не удалось загрузить непрочитанные уведомления',
  );
  const byTenant = {};
  for (const row of Array.isArray(payload?.byTenant) ? payload.byTenant : []) {
    const tenantId = String(row?.tenantId || '').trim();
    if (!tenantId) continue;
    byTenant[tenantId] = Math.max(0, Math.trunc(Number(row?.unreadCount) || 0));
  }
  const snapshot = publishUnread(byTenant);
  return { ...payload, total: snapshot.total, byTenant: Object.entries(snapshot.byTenant).map(([tenantId, unreadCount]) => ({ tenantId, unreadCount })) };
}

export async function getGlobalAccountRelationships() {
  const [relationships, summary] = await Promise.all([
    jsonResponse(
      await request('/online-booking/account/relationships', { auth: true }),
      'Не удалось загрузить связи аккаунта',
    ),
    getGlobalAccountUnreadSummary().catch(() => ({ ...getAccountUnreadState(), byTenant: [] })),
  ]);
  const counts = new Map((Array.isArray(summary?.byTenant) ? summary.byTenant : [])
    .map((row) => [String(row?.tenantId || ''), Math.max(0, Math.trunc(Number(row?.unreadCount) || 0))]));
  return (Array.isArray(relationships) ? relationships : []).map((relationship) => {
    const tenantId = String(relationship?.tenantId || '');
    const unreadCount = counts.get(tenantId) || 0;
    const context = relationship?.context && typeof relationship.context === 'object' && !Array.isArray(relationship.context)
      ? relationship.context
      : {};
    const profile = context?.profile && typeof context.profile === 'object' && !Array.isArray(context.profile)
      ? context.profile
      : {};
    return {
      ...relationship,
      unreadCount,
      context: {
        ...context,
        profile: { ...profile, tenantId, unreadCount },
      },
    };
  });
}

export async function deleteGlobalAccountRelationship(tenantId) {
  const id = String(tenantId || '');
  const result = await jsonResponse(
    await request(`/online-booking/account/relationships/${encodeURIComponent(id)}`, {
      auth: true,
      method: 'DELETE',
    }),
    'Не удалось удалить контакт',
  );
  const current = getAccountUnreadState();
  const next = { ...current.byTenant };
  delete next[id];
  publishUnread(next);
  return result;
}

export async function decideGlobalAccountInvestment(tenantId, investmentId, decision) {
  return jsonResponse(
    await request(`/online-booking/account/investments/${encodeURIComponent(String(tenantId || ''))}/${encodeURIComponent(String(investmentId || ''))}/decision`, {
      auth: true,
      method: 'POST',
      body: JSON.stringify({ decision }),
    }),
    'Не удалось сохранить решение по инвестиции',
  );
}

export async function getGlobalAccountRecords() {
  return jsonResponse(
    await request('/online-booking/account/records', { auth: true }),
    'Не удалось загрузить историю аккаунта',
  );
}

export async function getAccountPlatformState(tenantId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/platform-state`, { tenantId, auth: true }),
    'Не удалось проверить Условия использования учетной записи',
  );
}

export async function acceptAccountTerms(tenantId, accountTerms) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/platform-terms`, {
      tenantId,
      auth: true,
      method: 'POST',
      body: JSON.stringify({ accountTerms }),
    }),
    'Не удалось сохранить принятие Условий использования учетной записи',
  );
}

export async function resolveBookingPublicRoute(profileSlug, workplaceSlug = '') {
  const params = new URLSearchParams();
  if (workplaceSlug) params.set('workplace', workplaceSlug);
  const suffix = params.toString() ? `?${params}` : '';
  return jsonResponse(
    await request(`/online-booking/route/${encodeURIComponent(String(profileSlug || '').trim())}${suffix}`),
    'Ссылка онлайн-записи недействительна',
  );
}

export async function getBookingContext(tenantId, workplaceKey = '') {
  const params = new URLSearchParams();
  if (workplaceKey) params.set('workplace', workplaceKey);
  const suffix = params.toString() ? `?${params}` : '';
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/context${suffix}`),
    'Не удалось загрузить онлайн-запись',
  );
}

export async function prepareAccount(tenantId, input) {
  const body = input && typeof input === 'object' && !Array.isArray(input)
    ? input
    : { identifier: String(input || '').trim() };
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/prepare`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    'Не удалось проверить аккаунт',
  );
}

export async function registerAccount(tenantId, data) {
  const payload = await jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/register`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
    'Не удалось создать аккаунт',
  );
  return storeSession(tenantId, payload);
}

export async function loginAccount(tenantId, identifier, password) {
  const payload = await jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/login`, {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
    'Не удалось войти',
  );
  return storeSession(tenantId, payload);
}

export async function getAccount(tenantId) {
  const token = getAccountToken(tenantId);
  if (!token) return null;
  const response = await request(`/online-booking/${encodeURIComponent(tenantId)}/account/me`, { tenantId, auth: true });
  if (response.status === 401) {
    clearAccount(tenantId);
    return null;
  }
  return jsonResponse(response, 'Не удалось открыть аккаунт');
}

export async function updateAccount(tenantId, data) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/me`, {
      tenantId,
      auth: true,
      method: 'PUT',
      body: JSON.stringify(data || {}),
    }),
    'Не удалось обновить аккаунт',
  );
}

export async function changeAccountPassword(tenantId, currentPassword, newPassword) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/password`, {
      tenantId,
      auth: true,
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
    'Не удалось изменить пароль',
  );
}

export async function createBookingRequest(tenantId, data) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/requests`, {
      tenantId,
      auth: true,
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
    'Не удалось подтвердить запись',
  );
}

export async function getAccountRecords(tenantId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/records`, { tenantId, auth: true }),
    'Не удалось загрузить записи аккаунта',
  );
}

export async function getAccountConsentState(tenantId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/consent-state`, { tenantId, auth: true }),
    'Не удалось проверить согласия',
  );
}

export async function submitAccountConsents(tenantId, consents = []) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/consents`, {
      tenantId,
      auth: true,
      method: 'POST',
      body: JSON.stringify({ consents }),
    }),
    'Не удалось сохранить согласия',
  );
}

export async function revokeAccountConsent(tenantId, documentId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/consents/${encodeURIComponent(documentId)}/revoke`, {
      tenantId,
      auth: true,
      method: 'POST',
    }),
    'Не удалось отозвать согласие',
  );
}

export async function getAccountNotifications(tenantId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/notifications`, { tenantId, auth: true }),
    'Не удалось загрузить уведомления',
  );
}

export async function markAccountNotificationRead(tenantId, notificationId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/notifications/${encodeURIComponent(notificationId)}/read`, {
      tenantId,
      auth: true,
      method: 'POST',
    }),
    'Не удалось открыть уведомление',
  );
}

export async function getAccountChat(tenantId) {
  const payload = await jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/chat`, { tenantId, auth: true }),
    'Не удалось загрузить чат',
  );
  await getGlobalAccountUnreadSummary().catch(() => null);
  return payload;
}

export async function getAccountChatSettings(tenantId) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/chat/settings`, { tenantId, auth: true }),
    'Не удалось загрузить настройки чата',
  );
}

export async function sendAccountChatMessage(tenantId, body, attachments = []) {
  return jsonResponse(
    await request(`/online-booking/${encodeURIComponent(tenantId)}/account/chat/messages`, {
      tenantId,
      auth: true,
      method: 'POST',
      body: JSON.stringify({ body: String(body || '').trim(), attachments: Array.isArray(attachments) ? attachments : [] }),
    }),
    'Не удалось отправить сообщение',
  );
}
