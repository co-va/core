import { API_BASE } from '../core/environment.js';

const TTL_MS = 15_000;
const cache = new Map();
const inFlight = new Map();
const nativeFetch = window.fetch.bind(window);

function text(value) {
  return String(value ?? '').trim();
}

function contextUrl(input, init = {}) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'GET') return '';
  const raw = text(input?.url || input);
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    if (!/^\/online-booking\/[^/]+\/context$/.test(url.pathname.replace(/^\/api/, ''))) return '';
    return url.href;
  } catch {
    return '';
  }
}

function snapshotResponse(response, payload) {
  return {
    expiresAt: Date.now() + TTL_MS,
    payload,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
}

function responseFrom(snapshot) {
  return new Response(JSON.stringify(snapshot.payload), {
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
  });
}

window.fetch = async (input, init = {}) => {
  const key = contextUrl(input, init);
  if (!key) return nativeFetch(input, init);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return responseFrom(cached);
  if (cached) cache.delete(key);

  if (inFlight.has(key)) return responseFrom(await inFlight.get(key));

  const load = (async () => {
    const response = await nativeFetch(input, init);
    if (!response.ok) return snapshotResponse(response, await response.clone().json().catch(() => ({})));
    const payload = await response.clone().json().catch(() => ({}));
    const snapshot = snapshotResponse(response, payload);
    cache.set(key, snapshot);
    return snapshot;
  })();
  inFlight.set(key, load);
  try {
    const snapshot = await load;
    return responseFrom(snapshot);
  } finally {
    if (inFlight.get(key) === load) inFlight.delete(key);
  }
};

function prefetchTenant(tenantId) {
  const id = text(tenantId);
  if (!id) return;
  const url = `${API_BASE}/online-booking/${encodeURIComponent(id)}/context`;
  void fetch(url).catch(() => {});
}

const observed = new WeakSet();
const visibility = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        const tenantId = text(node.dataset.accountBookingProfessional || node.dataset.globalRelationship);
        prefetchTenant(tenantId);
        visibility.unobserve(node);
      });
    }, { rootMargin: '120px' })
  : null;

function observeTargets() {
  document.querySelectorAll('[data-account-booking-professional], [data-global-relationship]').forEach((node) => {
    if (observed.has(node)) return;
    observed.add(node);
    if (visibility) visibility.observe(node);
    else prefetchTenant(node.dataset.accountBookingProfessional || node.dataset.globalRelationship);
  });
}

const mutations = new MutationObserver(observeTargets);
mutations.observe(document.documentElement, { childList: true, subtree: true });

const dispose = () => {
  mutations.disconnect();
  visibility?.disconnect();
  window.removeEventListener('pagehide', dispose);
};
window.addEventListener('pagehide', dispose);
observeTargets();
