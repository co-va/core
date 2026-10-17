import { getBookingContext, getGlobalAccountRecords, resolveBookingPublicRoute } from '../core/account/index.js';
import { procedurePricingForWorkplace } from '../core/service/procedures/selection.js';
import { openRecordConfirmationNotice } from '../ui/record/confirmation-notice.js';
import { renderGlobalClient } from './booking.js';
import { renderAccess } from './access.js';
import { startAccountRuntime } from './account-runtime.js';

const app = document.querySelector('#app');
let disposeView = () => {};

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv?.height || window.innerHeight;
  const width = vv?.width || window.innerWidth;
  document.documentElement.style.setProperty('--visual-vh', `${height}px`);
  document.documentElement.style.setProperty('--visual-vw', `${width}px`);
  document.documentElement.classList.toggle('keyboard-open', vv ? height < window.innerHeight * 0.78 : false);
}

function setThemeColor(value) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value);
}

function bookingRouteQuery(params) {
  return {
    procedureIds: String(params.get('procedures') || '').split(',').map((value) => value.trim()).filter(Boolean),
    telegramEntry: String(params.get('tg_entry') || '').trim(),
    entry: String(params.get('entry') || '').trim(),
  };
}

function accountBookingRoute() {
  const params = new URLSearchParams(location.search);
  const tenantId = String(params.get('booking') || '').trim();
  if (!tenantId) return null;
  return {
    tenantId,
    workplaceKey: String(params.get('workplace') || '').trim(),
    ...bookingRouteQuery(params),
  };
}

function publicBookingPath() {
  const segments = String(location.pathname || '/')
    .split('/')
    .filter(Boolean)
    .map((value) => {
      try { return decodeURIComponent(value); } catch { return value; }
    });
  if (!segments.length) return null;
  if (segments.length > 2) return { invalid: true, profileSlug: '', workplaceSlug: '' };
  return {
    invalid: false,
    profileSlug: String(segments[0] || '').trim(),
    workplaceSlug: String(segments[1] || '').trim(),
  };
}

async function bookingRoute() {
  const params = new URLSearchParams(location.search);
  const pathRoute = publicBookingPath();
  if (!pathRoute) return null;
  if (pathRoute.invalid || !pathRoute.profileSlug) {
    return { tenantId: '', workplaceKey: '', ...bookingRouteQuery(params) };
  }

  try {
    const resolved = await resolveBookingPublicRoute(pathRoute.profileSlug, pathRoute.workplaceSlug);
    return {
      tenantId: String(resolved?.tenantId || ''),
      workplaceKey: String(resolved?.workplaceKey || ''),
      ...bookingRouteQuery(params),
    };
  } catch {
    return { tenantId: '', workplaceKey: '', ...bookingRouteQuery(params) };
  }
}

function recordCreatedMoment(record = {}) {
  const value = Date.parse(record?.createdAt || record?.updatedAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function latestConfirmedRecord(records = [], tenantId = '') {
  const id = String(tenantId || '');
  const scoped = (Array.isArray(records) ? records : []).filter((record) => {
    const recordTenantId = String(record?.tenantId || '');
    const status = String(record?.status || '').toLowerCase();
    return status !== 'cancelled' && (!recordTenantId || !id || recordTenantId === id);
  });
  return scoped.sort((a, b) => recordCreatedMoment(b) - recordCreatedMoment(a))[0] || null;
}

function numericCost(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

async function showOnlineBookingConfirmation(route) {
  const records = await getGlobalAccountRecords().catch(() => []);
  const record = latestConfirmedRecord(records, route.tenantId);
  const workplaceId = String(record?.workplaceId || record?.workplaceKey || route.workplaceKey || '');
  const context = route.tenantId
    ? await getBookingContext(route.tenantId, workplaceId).catch(() => ({}))
    : {};
  const catalog = new Map((Array.isArray(context?.procedures) ? context.procedures : [])
    .map((procedure) => [String(procedure?.id || ''), procedure]));
  const recordedProcedures = Array.isArray(record?.procedures) ? record.procedures : [];
  const fallbackIds = Array.isArray(route.procedureIds) ? route.procedureIds.map(String) : [];
  const procedureSources = recordedProcedures.length
    ? recordedProcedures
    : fallbackIds.map((id) => catalog.get(id)).filter(Boolean);
  const procedures = procedureSources.map((entry) => {
    const source = catalog.get(String(entry?.id || '')) || entry || {};
    const pricing = procedurePricingForWorkplace(source, workplaceId);
    const recordedCost = entry?.cost;
    return {
      name: String(entry?.name || source?.name || 'Процедура'),
      value: recordedCost !== '' && recordedCost != null ? recordedCost : pricing.value,
      variable: pricing.variable,
      free: pricing.free,
    };
  });
  const finance = record?.finance && typeof record.finance === 'object' ? record.finance : {};
  const calculated = procedures.reduce((sum, procedure) => sum + numericCost(procedure.value), 0);
  const total = finance.planTotal ?? finance.serviceTotal ?? calculated;
  openRecordConfirmationNotice({
    headline: 'Вы записаны',
    date: String(record?.date || ''),
    time: String(record?.from || ''),
    procedures,
    total,
    variable: procedures.some((procedure) => procedure.variable),
  });
}

async function renderGlobalClientRoot(initial = {}) {
  disposeView();
  disposeView = () => {};
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');
  app.innerHTML = '<main class="booking-content" id="app-content"></main>';
  await renderGlobalClient(document.querySelector('#app-content'), initial);
  syncViewport();
}

async function renderAccessRoute(route) {
  disposeView();
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');

  if (route.entry === 'account-booking') {
    await renderGlobalClientRoot({ tab: 'contact-detail', tenantId: route.tenantId });
  } else {
    app.innerHTML = '<main class="booking-content" id="app-content"></main>';
  }

  const disposeRuntime = await startAccountRuntime(route);
  let recordCreationCommitted = false;
  const onRecordCreationCommitted = () => { recordCreationCommitted = true; };
  window.addEventListener('va-tools:record-creation-committed', onRecordCreationCommitted);
  disposeView = () => {
    disposeRuntime?.();
    window.removeEventListener('va-tools:record-creation-committed', onRecordCreationCommitted);
  };
  await renderAccess(document.querySelector('#app-content'), {
    ...route,
    onExitToAccount: async (target = {}) => {
      const confirmed = recordCreationCommitted;
      recordCreationCommitted = false;
      history.replaceState({}, '', '/');
      await renderGlobalClientRoot(target);
      if (confirmed) await showOnlineBookingConfirmation(route);
    },
  });
  syncViewport();
}

window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });

syncViewport();
const accountBooking = accountBookingRoute();
if (accountBooking) await renderAccessRoute(accountBooking);
else {
  const publicBooking = await bookingRoute();
  if (publicBooking) await renderAccessRoute(publicBooking);
  else await renderGlobalClientRoot();
}
