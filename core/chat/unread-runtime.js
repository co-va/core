import { getGlobalAccountUnreadSummary } from '../account/index.js';
import { USER_ORIGIN } from '../environment.js';
import { getProfessionalMessengerConversations } from './messenger-api.js';

const USER_HOST = new URL(USER_ORIGIN).hostname;
const CHAT_UNREAD_KEY = '__VA_TOOLS_CHAT_UNREAD__';
let refreshBusy = false;
let refreshQueued = false;
let pendingReadRow = null;
let timer = null;

function isEndUserRuntime() {
  return String(globalThis.location?.hostname || '').toLowerCase() === USER_HOST;
}

function normalizedCount(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function professionalUnread(conversations = []) {
  return (Array.isArray(conversations) ? conversations : [])
    .reduce((sum, conversation) => sum + normalizedCount(conversation?.unreadCount), 0);
}

function syncInstalledBadge(total) {
  if (typeof navigator === 'undefined') return;
  const count = normalizedCount(total);
  if (count > 0 && typeof navigator.setAppBadge === 'function') {
    void navigator.setAppBadge(count).catch(() => {});
  } else if (count === 0 && typeof navigator.clearAppBadge === 'function') {
    void navigator.clearAppBadge().catch(() => {});
  }
}

function syncHeaderBadges(total) {
  if (typeof document === 'undefined') return;
  const count = normalizedCount(total);
  document.querySelectorAll('.v2-header__control--chat').forEach((button) => {
    let badge = button.querySelector(':scope > .v2-header__badge');
    if (count <= 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'v2-header__badge';
      button.append(badge);
    }
    badge.textContent = String(Math.min(99, count));
  });
}

function syncThreadUnreadRows() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('[data-chat-thread]').forEach((row) => {
    const indicator = row.querySelector('.list-entry__right small');
    const unread = /\b(?:новое|новых|нов)\b/i.test(String(indicator?.textContent || ''));
    row.classList.toggle('chat-thread--unread', unread);
  });
}

function publish(total) {
  const count = normalizedCount(total);
  if (typeof globalThis !== 'undefined') globalThis[CHAT_UNREAD_KEY] = { total: count };
  syncHeaderBadges(count);
  syncThreadUnreadRows();
  syncInstalledBadge(count);
  return count;
}

async function loadTotal() {
  if (isEndUserRuntime()) {
    const summary = await getGlobalAccountUnreadSummary();
    return normalizedCount(summary?.total);
  }
  const conversations = await getProfessionalMessengerConversations();
  return professionalUnread(conversations);
}

export async function refreshChatUnread() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  refreshBusy = true;
  try {
    publish(await loadTotal());
  } catch {
    // Authentication and network readiness are owned by their runtimes.
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueMicrotask(() => void refreshChatUnread());
    }
  }
}

function clearPendingReadRow() {
  if (!pendingReadRow?.isConnected) {
    pendingReadRow = null;
    return;
  }
  pendingReadRow.classList.remove('chat-thread--unread');
  const indicator = pendingReadRow.querySelector('.list-entry__right small');
  if (/\b(?:новое|новых|нов)\b/i.test(String(indicator?.textContent || ''))) indicator.remove();
  if (!pendingReadRow.querySelector('.list-entry__right > *')) pendingReadRow.querySelector('.list-entry__right')?.remove();
  pendingReadRow = null;
}

function scheduleRefresh() {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    void refreshChatUnread();
  }, 80);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const row = event.target.closest?.('[data-chat-thread]');
    if (row) pendingReadRow = row;
  }, true);

  const observer = new MutationObserver(() => {
    const current = normalizedCount(globalThis[CHAT_UNREAD_KEY]?.total);
    syncHeaderBadges(current);
    syncThreadUnreadRows();
    if (document.querySelector('[data-v2-app]')) scheduleRefresh();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

if (typeof window !== 'undefined') {
  window.addEventListener('va-tools:chat-thread-read', () => {
    clearPendingReadRow();
    void refreshChatUnread();
  });
  window.addEventListener('va-tools:chat-unread-refresh', () => void refreshChatUnread());
  window.addEventListener('focus', () => void refreshChatUnread());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshChatUnread();
  });

  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    if (event.data?.type !== 'va-tools:push-unread') return;
    if (event.data?.count != null) publish(event.data.count);
    void refreshChatUnread();
  });

  void refreshChatUnread();
  window.setInterval(() => {
    if (!document.hidden) void refreshChatUnread();
  }, 15_000);
}
