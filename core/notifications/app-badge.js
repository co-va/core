const CHAT_UNREAD_KEY = '__VA_TOOLS_CHAT_UNREAD__';
const ACCOUNT_UNREAD_KEY = '__VA_TOOLS_ACCOUNT_UNREAD__';
const SERVICE_UNSEEN_KEY = '__VA_TOOLS_SERVICE_UNSEEN__';

function count(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function stateTotal(key) {
  if (typeof globalThis === 'undefined') return 0;
  return count(globalThis[key]?.total);
}

export function getApplicationBadgeCount() {
  const chat = Math.max(stateTotal(CHAT_UNREAD_KEY), stateTotal(ACCOUNT_UNREAD_KEY));
  return chat + stateTotal(SERVICE_UNSEEN_KEY);
}

export function syncApplicationBadge() {
  if (typeof navigator === 'undefined') return getApplicationBadgeCount();
  const total = getApplicationBadgeCount();
  if (total > 0 && typeof navigator.setAppBadge === 'function') {
    void navigator.setAppBadge(total).catch(() => {});
  } else if (total === 0 && typeof navigator.clearAppBadge === 'function') {
    void navigator.clearAppBadge().catch(() => {});
  }
  return total;
}

export function publishChatUnreadCount(value) {
  const total = count(value);
  if (typeof globalThis !== 'undefined') globalThis[CHAT_UNREAD_KEY] = { total };
  syncApplicationBadge();
  return total;
}

export function publishServiceUnseen(items = []) {
  const values = Array.isArray(items) ? items : [];
  const state = { total: values.length, items: values };
  if (typeof globalThis !== 'undefined') globalThis[SERVICE_UNSEEN_KEY] = state;
  syncApplicationBadge();
  return state;
}

export function getServiceUnseenState() {
  if (typeof globalThis === 'undefined') return { total: 0, items: [] };
  const state = globalThis[SERVICE_UNSEEN_KEY];
  return state && typeof state === 'object'
    ? { total: count(state.total), items: Array.isArray(state.items) ? state.items : [] }
    : { total: 0, items: [] };
}
