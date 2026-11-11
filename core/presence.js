import { apiRequest, getAuthToken } from './auth.js';

// Same canonical authenticated POST /auth/presence as Professional.
// Foreground telemetry never participates in login, page loading or data sync.
export const PRESENCE_HEARTBEAT_MS = 45_000;
const PRESENCE_MIN_GAP_MS = 20_000;
const PRESENCE_TIMEOUT_MS = 5_000;

let running = false;
let timer = null;
let inFlight = false;
let lastRequestAt = 0;
let refreshOnReport = false;
let onForegroundReport = null;

function foreground() {
  return typeof document !== 'undefined' && document.visibilityState !== 'hidden';
}

function reportPresence() {
  if (!running || !foreground() || !getAuthToken() || inFlight) return;
  const now = Date.now();
  if (now - lastRequestAt < PRESENCE_MIN_GAP_MS) return;
  lastRequestAt = now;
  inFlight = true;
  void apiRequest('/auth/presence', { method: 'POST', timeoutMs: PRESENCE_TIMEOUT_MS })
    .then((response) => {
      if (response.status === 401) {
        stopAccountPresence();
        return;
      }
      if (response.ok && refreshOnReport) {
        refreshOnReport = false;
        try { onForegroundReport?.(); } catch { /* Telemetry does not affect the UI. */ }
      }
    })
    .catch(() => {
      // An offline network must never delay login, Journal or Admin interactions.
    })
    .finally(() => { inFlight = false; });
}

function onForeground() {
  if (!foreground()) return;
  refreshOnReport = true;
  reportPresence();
}

export function startAccountPresence({ onForegroundReport: callback } = {}) {
  if (running || !getAuthToken()) return;
  running = true;
  refreshOnReport = true;
  lastRequestAt = 0;
  onForegroundReport = typeof callback === 'function' ? callback : null;
  reportPresence();
  timer = window.setInterval(reportPresence, PRESENCE_HEARTBEAT_MS);
  document.addEventListener('visibilitychange', onForeground);
  window.addEventListener('focus', onForeground);
  window.addEventListener('pageshow', onForeground);
}

export function stopAccountPresence() {
  running = false;
  if (timer != null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onForeground);
  window.removeEventListener('focus', onForeground);
  window.removeEventListener('pageshow', onForeground);
  onForegroundReport = null;
  refreshOnReport = false;
}
