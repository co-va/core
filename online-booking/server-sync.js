import { apiRequest } from '../core/auth.js';
import { flushBusinessPersistence } from '../core/business-persistence.js';
import { hydrateBookingSettingsFromServer } from '../core/booking-settings/index.js';
import { hydrateDaysFromServer } from '../core/day/index.js';
import { hydrateEventsFromServer } from '../core/event/index.js';
import { hydrateFinanceFromServer, hydrateWalletsFromServer } from '../core/finance/index.js';
import { hydrateRecordStateFromServer } from '../core/record/index.js';
import { hydrateUEIFromServer } from '../core/uei.js';
import { hydratePeopleFromServer } from '../core/people/data.js';
import { hydrateConsentsFromServer } from '../settings/documents/consents.js';
import { hydrateDocumentsFromServer } from '../settings/documents/data.js';
import { hydrateDocumentHistoryFromServer } from '../settings/documents/history.js';
import { hydrateProfileFromServer } from '../core/profile/data.js';
import { hydrateWorkplacesFromServer } from '../core/profile/workplaces/data.js';
import { hydrateProceduresFromServer } from '../core/service/procedures/data.js';
import { hydrateProductsFromServer } from '../core/service/products/data.js';
import { hydrateTagsFromServer } from '../settings/tags/data.js';

const POLL_MS = 4000;
const ALL_SCOPES = Object.freeze(['business', 'operational', 'documents', 'profile', 'auxiliary', 'finance']);
const POLL_SCOPES = Object.freeze(['business', 'documents']);
let timer = null;
let running = false;
let stopListeners = () => {};
const pendingScopes = new Set();
const snapshots = new Map();

async function responseJson(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || fallback);
  return payload;
}

function stableSnapshot(value) {
  return JSON.stringify(value ?? null);
}

function hasChanged(key, value) {
  const next = stableSnapshot(value);
  const previous = snapshots.get(key);
  snapshots.set(key, next);
  return previous !== next;
}

function notify(name, detail = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function requestedScopes(scopes) {
  const requested = Array.isArray(scopes) && scopes.length ? scopes : ALL_SCOPES;
  return [...new Set(requested.filter((scope) => ALL_SCOPES.includes(scope)))];
}

async function fetchScopes(scopes) {
  const requests = new Map();
  if (scopes.includes('business')) {
    requests.set('business', apiRequest('/business-state'));
    requests.set('events', apiRequest('/events'));
  }
  if (scopes.includes('operational')) requests.set('operational', apiRequest('/business-state/operational'));
  if (scopes.includes('documents')) requests.set('documents', apiRequest('/tenant-document-archive'));
  if (scopes.includes('profile')) requests.set('profile', apiRequest('/profile'));
  if (scopes.includes('auxiliary')) requests.set('auxiliary', apiRequest('/auxiliary-state'));
  if (scopes.includes('finance')) requests.set('finance', apiRequest('/finance'));
  const entries = await Promise.all([...requests.entries()].map(async ([scope, request]) => [scope, await request]));
  return new Map(entries);
}

async function pull(scopes = ALL_SCOPES) {
  const requested = requestedScopes(scopes);
  if (!requested.length) return;
  if (running) {
    requested.forEach((scope) => pendingScopes.add(scope));
    return;
  }

  running = true;
  try {
    await flushBusinessPersistence();
    const responses = await fetchScopes(requested);

    if (responses.has('business')) {
      const business = await responseJson(responses.get('business'), 'Не удалось обновить рабочие данные');
        const peopleChanged = hasChanged('business.people', business.people || []);
        const ueiChanged = hasChanged('business.uei', business.uei || {});
        const recordsChanged = hasChanged('business.records', {
          records: business.records || [],
          recordEvents: business.recordEvents || [],
        });
        if (peopleChanged || ueiChanged || recordsChanged) {
          hydratePeopleFromServer(business.people || []);
          hydrateUEIFromServer(business.uei || {});
          hydrateRecordStateFromServer({ records: business.records || [], recordEvents: business.recordEvents || [] });
        }
        if (peopleChanged || ueiChanged) notify('book:people-changed', { action: 'server-refresh' });
        if (recordsChanged) {
          notify('book:records-changed', { action: 'server-refresh' });
          notify('book:time-usage-changed', { action: 'server-refresh' });
        }

    }

    if (responses.has('events')) {
      const events = await responseJson(responses.get('events'), 'Не удалось обновить события');
      const rows = Array.isArray(events) ? events : [];
      if (hasChanged('business.events', rows)) {
        hydrateEventsFromServer(rows);
        notify('book:events-changed', { action: 'server-refresh' });
        notify('book:time-usage-changed', { action: 'server-refresh' });
      }
    }

    if (responses.has('operational')) {
      const operational = await responseJson(responses.get('operational'), 'Не удалось обновить График, процедуры и онлайн-запись');
        const daysChanged = hasChanged('operational.days', operational.days || []);
        const proceduresChanged = hasChanged('operational.procedures', {
          procedures: operational.procedures || [],
          procedureHistory: operational.procedureHistory || [],
        });
        const bookingSettingsChanged = hasChanged('operational.bookingSettings', operational.bookingSettings || null);
        if (daysChanged) hydrateDaysFromServer(operational.days || []);
        if (proceduresChanged) hydrateProceduresFromServer({
          procedures: operational.procedures || [],
          procedureHistory: operational.procedureHistory || [],
        });
        if (bookingSettingsChanged) hydrateBookingSettingsFromServer(operational.bookingSettings || null);
        if (daysChanged) {
          notify('book:days-changed', { action: 'server-refresh' });
          notify('book:time-usage-changed', { action: 'server-refresh' });
        }
        if (proceduresChanged) notify('book:procedures-changed', { action: 'server-refresh' });
        if (bookingSettingsChanged) notify('book:booking-settings-changed', { action: 'server-refresh' });

    }

    if (responses.has('documents')) {
      const documents = await responseJson(responses.get('documents'), 'Не удалось обновить документы');
      const documentData = documents?.data || {};
      if (hasChanged('documents', documentData)) {
        hydrateDocumentsFromServer(documentData.documents || []);
        hydrateConsentsFromServer(documentData.consents || []);
        hydrateDocumentHistoryFromServer(documentData.history || []);
        notify('book:documents-changed', { action: 'server-refresh' });
      }
    }

    if (responses.has('profile')) {
      const profile = await responseJson(responses.get('profile'), 'Не удалось обновить Профиль и рабочие пространства');
      const profileChanged = hasChanged('profile.profile', {
        profile: profile.profile || {},
        customProfessions: profile.customProfessions || [],
      });
      const workplacesChanged = hasChanged('profile.workplaces', profile.workplaces || []);
      if (profileChanged) hydrateProfileFromServer(profile.profile || {}, profile.customProfessions || []);
      if (workplacesChanged) hydrateWorkplacesFromServer(profile.workplaces || []);
      if (profileChanged) notify('book:profile-changed', { action: 'server-refresh' });
      if (workplacesChanged) {
        notify('book:workplaces-changed', { action: 'server-refresh' });
        notify('book:time-usage-changed', { action: 'server-refresh' });
      }
    }

    if (responses.has('auxiliary')) {
      const auxiliary = await responseJson(responses.get('auxiliary'), 'Не удалось обновить связанные данные');
        const walletsChanged = hasChanged('auxiliary.wallets', auxiliary.wallets || []);
        const tagsChanged = hasChanged('auxiliary.tags', auxiliary.tags || []);
        const productsChanged = hasChanged('auxiliary.products', {
          products: auxiliary.products || [],
          productHistory: auxiliary.productHistory || [],
        });
        if (walletsChanged) hydrateWalletsFromServer(auxiliary.wallets || []);
        if (tagsChanged) hydrateTagsFromServer(auxiliary.tags || []);
        if (productsChanged) hydrateProductsFromServer({
          products: auxiliary.products || [],
          productHistory: auxiliary.productHistory || [],
        });
        if (walletsChanged) notify('book:wallets-changed', { action: 'server-refresh' });
        if (tagsChanged) notify('book:tags-changed', { action: 'server-refresh' });
        if (productsChanged) notify('book:products-changed', { action: 'server-refresh' });

    }

    if (responses.has('finance')) {
      const finance = await responseJson(responses.get('finance'), 'Не удалось обновить Финансы');
      if (hasChanged('finance', finance)) {
        hydrateFinanceFromServer(finance);
        notify('book:dds-changed', { action: 'server-refresh' });
      }
    }
  } catch {
    // Server remains the owner. A temporary network failure must not break the open Book UI.
  } finally {
    running = false;
    if (pendingScopes.size) {
      const next = [...pendingScopes];
      pendingScopes.clear();
      void pull(next);
    }
  }
}

export function startServerBookingSync() {
  if (timer) return () => stopServerBookingSync();
  void pull(ALL_SCOPES);
  timer = window.setInterval(() => void pull(POLL_SCOPES), POLL_MS);
  const refreshAll = () => void pull(ALL_SCOPES);
  const refreshMutation = (event) => {
    const scopes = Array.isArray(event?.detail?.scopes)
      ? event.detail.scopes.map((scope) => String(scope || '')).filter(Boolean)
      : [];
    void pull(scopes.length ? scopes : ALL_SCOPES);
  };
  document.addEventListener('visibilitychange', refreshAll);
  window.addEventListener('focus', refreshAll);
  window.addEventListener('book:server-mutation-completed', refreshMutation);
  stopListeners = () => {
    document.removeEventListener('visibilitychange', refreshAll);
    window.removeEventListener('focus', refreshAll);
    window.removeEventListener('book:server-mutation-completed', refreshMutation);
  };
  return () => stopServerBookingSync();
}

export function stopServerBookingSync() {
  if (timer) window.clearInterval(timer);
  timer = null;
  pendingScopes.clear();
  stopListeners();
  stopListeners = () => {};
}
