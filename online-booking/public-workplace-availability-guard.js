const CONTEXT_TTL_MS = 15_000;
let bookingContext = null;
const contextCache = new Map();
const contextInFlight = new Map();

function text(value) {
  return String(value ?? '').trim();
}

function contextKey(input, init = {}) {
  const method = String(init?.method || input?.method || 'GET').toUpperCase();
  if (method !== 'GET') return '';
  const raw = text(input?.url || input);
  if (!raw) return '';
  try {
    const url = new URL(raw, location.origin);
    if (!/^\/api\/online-booking\/[^/]+\/context$/.test(url.pathname)
      && !/^\/online-booking\/[^/]+\/context$/.test(url.pathname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function scheduledWorkplaces(context = bookingContext) {
  const days = Array.isArray(context?.days) ? context.days : [];
  return new Set(days.map((day) => text(day?.workplaceId)).filter(Boolean));
}

function applyWorkplaceAvailability() {
  if (!bookingContext) return;
  const scheduled = scheduledWorkplaces();
  document.querySelectorAll('[data-booking-workplace]').forEach((node) => {
    const key = text(node.dataset.bookingWorkplace);
    const enabled = Boolean(key && scheduled.has(key));
    if ('disabled' in node) node.disabled = !enabled;
    node.toggleAttribute('aria-disabled', !enabled);
    node.classList.toggle('is-disabled', !enabled);
    if (!enabled) node.setAttribute('title', 'Расписание не настроено');
    else node.removeAttribute('title');
  });
}

function snapshot(response, payload) {
  return {
    expiresAt: Date.now() + CONTEXT_TTL_MS,
    payload,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
  };
}

function responseFrom(value) {
  return new Response(JSON.stringify(value.payload), {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init = {}) => {
  const key = contextKey(input, init);
  if (!key) return originalFetch(input, init);

  const cached = contextCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    bookingContext = cached.payload;
    return responseFrom(cached);
  }
  if (cached) contextCache.delete(key);

  if (contextInFlight.has(key)) {
    const pending = await contextInFlight.get(key);
    bookingContext = pending.payload;
    return responseFrom(pending);
  }

  const load = (async () => {
    const response = await originalFetch(input, init);
    const payload = await response.clone().json().catch(() => ({}));
    const value = snapshot(response, payload);
    if (response.ok) contextCache.set(key, value);
    return value;
  })();
  contextInFlight.set(key, load);
  try {
    const value = await load;
    if (value.status >= 200 && value.status < 300) {
      bookingContext = value.payload && typeof value.payload === 'object' ? value.payload : null;
      applyWorkplaceAvailability();
    }
    return responseFrom(value);
  } finally {
    if (contextInFlight.get(key) === load) contextInFlight.delete(key);
  }
};

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-booking-workplace]') : null;
  if (!target || target.getAttribute('aria-disabled') !== 'true') return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

const observer = new MutationObserver(() => applyWorkplaceAvailability());
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
