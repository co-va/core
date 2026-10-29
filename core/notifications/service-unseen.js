import { API_BASE, USER_ORIGIN } from '../environment.js';
import { getAccountToken } from '../account/index.js';
import { getPlatformNotices, markPlatformNoticeSeen } from '../platform-notices.js';
import { escapeHtml, modal, mountModal } from '../../ui/ui.js';
import { getServiceUnseenState, publishServiceUnseen, syncApplicationBadge } from './app-badge.js';

const USER_HOST = new URL(USER_ORIGIN).hostname;
const SERVICE_UNSEEN_ROLLOUT_AT = Date.parse('2026-10-29T17:20:31.000Z');
const REFRESH_INTERVAL_MS = 15_000;
let refreshBusy = false;
let refreshQueued = false;
let summaryShown = false;
let visibleSeenTimer = null;
let initialized = false;

function text(value) {
  return String(value ?? '').trim();
}

function isEndUserRuntime() {
  return String(globalThis.location?.hostname || '').toLowerCase() === USER_HOST;
}

function afterRollout(value) {
  const stamp = Date.parse(String(value || ''));
  return Number.isFinite(stamp) && stamp >= SERVICE_UNSEEN_ROLLOUT_AT;
}

function recordIds(value) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map((item) => text(item)).filter(Boolean))];
}

function normalizeAccountItems(payload) {
  return (Array.isArray(payload?.items) ? payload.items : [])
    .filter((item) => text(item?.entityType).toLowerCase() === 'record' && afterRollout(item?.createdAt))
    .map((item) => ({
      id: text(item?.id),
      tenantId: text(item?.tenantId),
      type: text(item?.type),
      entityType: 'record',
      entityId: text(item?.entityId),
      recordIds: recordIds(item?.recordIds?.length ? item.recordIds : [item?.entityId]),
      date: text(item?.date).slice(0, 10),
      createdAt: item?.createdAt || '',
      owner: 'account',
    }))
    .filter((item) => item.id && item.recordIds.length);
}

function normalizeProfessionalItems(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter((item) => !item?.readAt)
    .filter((item) => text(item?.type).toUpperCase() === 'BOOKING_CREATED')
    .filter((item) => afterRollout(item?.createdAt))
    .map((item) => {
      const metadata = item?.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata) ? item.metadata : {};
      const ids = recordIds(Array.isArray(metadata.recordIds) ? metadata.recordIds : [metadata.recordId]);
      return {
        id: text(item?.id),
        tenantId: text(metadata.tenantId),
        type: 'booking.created',
        entityType: 'record',
        entityId: ids[0] || '',
        recordIds: ids,
        date: text(metadata.date).slice(0, 10),
        createdAt: item?.createdAt || '',
        owner: 'professional',
      };
    })
    .filter((item) => item.id && item.recordIds.length);
}

async function accountRequest(path, options = {}) {
  const token = getAccountToken();
  if (!token) return null;
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) throw new Error('Не удалось обновить сервисные уведомления');
  return response.json().catch(() => ({}));
}

async function loadItems() {
  if (isEndUserRuntime()) {
    const payload = await accountRequest('/online-booking/account/service-unseen');
    return normalizeAccountItems(payload || {});
  }
  return normalizeProfessionalItems(await getPlatformNotices());
}

function unseenRecordIds() {
  return new Set(getServiceUnseenState().items.flatMap((item) => recordIds(item?.recordIds)));
}

function markerNode(label = '🔴 Новая') {
  const marker = document.createElement('small');
  marker.dataset.serviceUnseenMarker = 'true';
  marker.textContent = label;
  return marker;
}

function syncMarkers() {
  if (typeof document === 'undefined') return;
  const unseen = unseenRecordIds();

  document.querySelectorAll('[data-service-unseen-marker]').forEach((marker) => {
    const owner = marker.closest('[data-journal-list-record],[data-time-usage]');
    const id = text(owner?.dataset?.journalListRecord || owner?.dataset?.timeUsage);
    if (!id || !unseen.has(id)) marker.remove();
  });

  document.querySelectorAll('[data-journal-list-record]').forEach((row) => {
    const id = text(row.dataset.journalListRecord);
    if (!id || !unseen.has(id) || row.querySelector('[data-service-unseen-marker]')) return;
    const target = row.querySelector('.list-entry__right') || row;
    target.prepend(markerNode());
  });

  document.querySelectorAll('[data-time-usage]').forEach((usage) => {
    const id = text(usage.dataset.timeUsage);
    if (!id || !unseen.has(id) || usage.querySelector('[data-service-unseen-marker]')) return;
    const target = usage.querySelector('.journal-record__identity') || usage.querySelector('.journal-record') || usage;
    target.append(markerNode(' 🔴'));
  });
}

function actuallyVisible(node) {
  if (!node?.isConnected || node.getClientRects().length === 0) return false;
  const rect = node.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
  const viewportWidth = window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
  return rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
}

function visibleDayRecordIds() {
  const unseen = unseenRecordIds();
  const ids = [];
  document.querySelectorAll('[data-time-usage]').forEach((usage) => {
    const id = text(usage.dataset.timeUsage);
    if (!id || !unseen.has(id) || !actuallyVisible(usage)) return;
    ids.push(id);
  });
  return [...new Set(ids)];
}

function removeSeenLocally(ids) {
  const seen = new Set(recordIds(ids));
  const current = getServiceUnseenState().items;
  const remaining = current.filter((item) => !item.recordIds.some((id) => seen.has(id)));
  publishServiceUnseen(remaining);
  syncMarkers();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('va-tools:service-unseen', { detail: { total: remaining.length, items: remaining } }));
  }
}

async function markRecordsSeen(ids) {
  const values = recordIds(ids);
  if (!values.length) return;
  const items = getServiceUnseenState().items.filter((item) => item.recordIds.some((id) => values.includes(id)));
  if (!items.length) return;
  try {
    if (isEndUserRuntime()) {
      await accountRequest('/online-booking/account/service-unseen/seen', {
        method: 'POST',
        body: JSON.stringify({ recordIds: values }),
      });
    } else {
      await Promise.allSettled(items.map((item) => markPlatformNoticeSeen(item.id)));
    }
    removeSeenLocally(values);
  } catch {
    // A failed seen write must leave the indicator visible for the next retry.
  }
}

function scheduleVisibleSeen() {
  if (visibleSeenTimer) window.clearTimeout(visibleSeenTimer);
  visibleSeenTimer = window.setTimeout(() => {
    visibleSeenTimer = null;
    const ids = visibleDayRecordIds();
    if (ids.length) void markRecordsSeen(ids);
  }, 700);
}

function summaryText(total) {
  const count = Math.max(0, Math.trunc(Number(total) || 0));
  if (count === 1) return '1 новое изменение в записях.';
  if (count > 1 && count < 5) return `${count} новых изменения в записях.`;
  return `${count} новых изменений в записях.`;
}

function maybeShowSummary() {
  if (summaryShown || typeof document === 'undefined') return;
  const state = getServiceUnseenState();
  if (state.total <= 0 || !document.querySelector('[data-v2-app]')) return;
  if (document.querySelector('[data-service-summary-modal],[data-platform-notice-modal],[data-account-push-setup-modal],[data-platform-push-setup-modal]')) return;
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Уведомления</h2><p>${escapeHtml(summaryText(state.total))}</p></div>`, {
    title: 'Уведомления',
    variant: 's',
    surface: 'app',
  }));
  if (!layer) return;
  summaryShown = true;
  layer.dataset.serviceSummaryModal = 'true';
}

function publish(items) {
  const state = publishServiceUnseen(items);
  syncMarkers();
  scheduleVisibleSeen();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('va-tools:service-unseen', { detail: state }));
  }
  return state;
}

export async function refreshServiceUnseen() {
  if (refreshBusy) {
    refreshQueued = true;
    return;
  }
  refreshBusy = true;
  try {
    publish(await loadItems());
  } catch {
    // Auth/network readiness is owned by the surrounding application runtime.
  } finally {
    refreshBusy = false;
    if (refreshQueued) {
      refreshQueued = false;
      queueMicrotask(() => void refreshServiceUnseen());
    }
  }
}

export function startServiceUnseenRuntime() {
  if (initialized || typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  initialized = true;
  let disposed = false;
  let summaryTimer = null;
  const observer = new MutationObserver(() => {
    if (disposed) return;
    syncMarkers();
    scheduleVisibleSeen();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  const onRefresh = () => void refreshServiceUnseen();
  const onAccountUnread = () => syncApplicationBadge();
  const onFocus = () => {
    if (!document.hidden) void refreshServiceUnseen();
  };
  const onClick = (event) => {
    const row = event.target.closest?.('[data-journal-list-record]');
    const id = text(row?.dataset?.journalListRecord);
    if (id && unseenRecordIds().has(id)) void markRecordsSeen([id]);
  };
  window.addEventListener('va-tools:service-unseen-refresh', onRefresh);
  window.addEventListener('va-tools:account-unread', onAccountUnread);
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onFocus);
  document.addEventListener('click', onClick, true);

  void refreshServiceUnseen();
  summaryTimer = window.setTimeout(() => maybeShowSummary(), 1200);
  const interval = window.setInterval(() => {
    if (!document.hidden) void refreshServiceUnseen();
  }, REFRESH_INTERVAL_MS);

  return () => {
    disposed = true;
    observer.disconnect();
    if (visibleSeenTimer) window.clearTimeout(visibleSeenTimer);
    if (summaryTimer) window.clearTimeout(summaryTimer);
    window.clearInterval(interval);
    window.removeEventListener('va-tools:service-unseen-refresh', onRefresh);
    window.removeEventListener('va-tools:account-unread', onAccountUnread);
    window.removeEventListener('focus', onFocus);
    document.removeEventListener('visibilitychange', onFocus);
    document.removeEventListener('click', onClick, true);
    initialized = false;
  };
}

if (typeof window !== 'undefined') startServiceUnseenRuntime();
