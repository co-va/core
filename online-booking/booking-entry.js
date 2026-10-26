import { loadBookingDraft, saveBookingDraft, clearBookingDraft } from '../core/booking-draft.js';
import { API_BASE } from '../core/environment.js';
import { renderAccess } from './access.js';

const root = document.querySelector('#app-content');

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv?.height || window.innerHeight;
  const width = vv?.width || window.innerWidth;
  document.documentElement.style.setProperty('--visual-vh', `${height}px`);
  document.documentElement.style.setProperty('--visual-vw', `${width}px`);
  document.documentElement.style.setProperty('--app-stable-vh', `${window.innerHeight}px`);
  document.documentElement.classList.toggle('keyboard-open', vv ? height < window.innerHeight * 0.78 : false);
}

function routeQuery(params) {
  return {
    procedureIds: String(params.get('procedures') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function pathParts() {
  return String(location.pathname || '/')
    .split('/')
    .filter(Boolean)
    .map((value) => {
      try { return decodeURIComponent(value); } catch { return value; }
    });
}

async function resolveRoute() {
  const params = new URLSearchParams(location.search);
  const queryTenantId = String(params.get('booking') || '').trim();
  if (queryTenantId) {
    return {
      tenantId: queryTenantId,
      workplaceKey: String(params.get('workplace') || '').trim(),
      ...routeQuery(params),
    };
  }

  const parts = pathParts();
  if (!parts.length || parts.length > 2) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };
  const profileSlug = String(parts[0] || '').trim();
  const workplaceSlug = String(parts[1] || '').trim();
  if (!profileSlug) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };

  const query = new URLSearchParams();
  if (workplaceSlug) query.set('workplace', workplaceSlug);
  const suffix = query.toString() ? `?${query}` : '';
  const response = await fetch(`${API_BASE}/online-booking/route/${encodeURIComponent(profileSlug)}${suffix}`);
  if (!response.ok) return { tenantId: '', workplaceKey: '', ...routeQuery(params) };
  const resolved = await response.json().catch(() => ({}));
  return {
    tenantId: String(resolved?.tenantId || ''),
    workplaceKey: String(resolved?.workplaceKey || ''),
    ...routeQuery(params),
  };
}

function draftId(route) {
  return `${String(route?.tenantId || '').trim()}:${String(route?.workplaceKey || '').trim() || 'profile'}`;
}

function restoreStoredDraft(route) {
  const id = draftId(route);
  if (!String(route?.tenantId || '').trim()) return id;
  const stored = loadBookingDraft(id);
  if (stored) {
    history.replaceState({ ...(history.state || {}), covaBookingDraft: stored }, '', location.href);
  }
  return id;
}

function persistStoredDraft(id) {
  if (!id) return;
  const draft = history.state?.covaBookingDraft;
  if (draft) saveBookingDraft(id, draft);
  else clearBookingDraft(id);
}

window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });
syncViewport();

let route = { tenantId: '', workplaceKey: '', procedureIds: [] };
try {
  route = await resolveRoute();
} catch {
  route = { tenantId: '', workplaceKey: '', procedureIds: [] };
}

const storedDraftId = restoreStoredDraft(route);
window.addEventListener('pagehide', () => persistStoredDraft(storedDraftId));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistStoredDraft(storedDraftId);
});

await renderAccess(root, route);
