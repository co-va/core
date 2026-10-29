import {
  bindAccountTelegramEntry,
  clearAccount,
  getAccountToken,
  resolveAccountTelegramEntry,
} from '../core/account/index.js';

function removeTelegramEntryFromUrl({ removeBooking = false } = {}) {
  const url = new URL(location.href);
  if (!url.searchParams.has('tg_entry') && (!removeBooking || !url.searchParams.has('booking'))) return;
  url.searchParams.delete('tg_entry');
  if (removeBooking) url.searchParams.delete('booking');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

function continueTelegramEntryToBooking(tenantId) {
  const tenant = String(tenantId || '').trim();
  if (!tenant) return;
  const url = new URL(location.href);
  url.searchParams.delete('tg_entry');
  url.searchParams.set('booking', tenant);
  url.searchParams.set('entry', 'account-booking');
  location.replace(`${url.pathname}${url.search}${url.hash}`);
}

function rootTelegramEntryRoute() {
  if (typeof window === 'undefined') return null;
  const path = String(location.pathname || '/').replace(/\/+$/, '') || '/';
  if (path !== '/') return null;
  const params = new URLSearchParams(location.search);
  const tenantId = String(params.get('booking') || '').trim();
  const telegramEntry = String(params.get('tg_entry') || '').trim();
  return tenantId && telegramEntry ? { tenantId, telegramEntry } : null;
}

export async function startAccountRuntime({
  tenantId = '',
  telegramEntry = '',
  onTelegramEntryCompleted = null,
} = {}) {
  const tenant = String(tenantId || '').trim();
  const entry = String(telegramEntry || '').trim();
  if (!tenant) return () => {};

  let telegramAttempted = !entry;
  let telegramReadyForBind = false;
  let telegramResolving = false;
  let disposed = false;

  const completeTelegramEntry = () => {
    telegramAttempted = true;
    removeTelegramEntryFromUrl();
    if (typeof onTelegramEntryCompleted === 'function') onTelegramEntryCompleted();
  };

  async function resolveTelegramEntry() {
    if (disposed || telegramAttempted || telegramReadyForBind || telegramResolving || !entry) return;
    telegramResolving = true;
    try {
      const resolved = await resolveAccountTelegramEntry(tenant, entry);
      if (resolved?.exists && resolved?.accessToken) {
        completeTelegramEntry();
        return;
      }

      // An unknown Telegram must never inherit whichever Account happened to
      // be left authenticated in this browser. Force explicit identity first.
      clearAccount(tenant);
      telegramReadyForBind = true;
    } catch {
      // Do not bind an unresolved Telegram ticket to an arbitrary existing
      // browser session. Resolution will retry while the ticket remains valid.
    } finally {
      telegramResolving = false;
    }
  }

  async function bindTelegramWhenAuthenticated() {
    if (disposed || telegramAttempted || !telegramReadyForBind || !getAccountToken(tenant)) return;
    try {
      await bindAccountTelegramEntry(tenant, entry);
      completeTelegramEntry();
    } catch {
      // Keep retry available while the one-time entry token is still valid.
    }
  }

  await resolveTelegramEntry();
  const interval = window.setInterval(() => {
    void resolveTelegramEntry();
    void bindTelegramWhenAuthenticated();
  }, 1500);
  void bindTelegramWhenAuthenticated();

  return () => {
    disposed = true;
    window.clearInterval(interval);
  };
}

let disposeRootTelegramRuntime = () => {};
const rootTelegramRoute = rootTelegramEntryRoute();
if (rootTelegramRoute) {
  // Telegram entry at user.va-tools.ru root is a real account-entry route.
  // Drop any unrelated browser Account before the async ticket is resolved.
  clearAccount(rootTelegramRoute.tenantId);
  void startAccountRuntime({
    ...rootTelegramRoute,
    onTelegramEntryCompleted: () => {
      disposeRootTelegramRuntime();
      continueTelegramEntryToBooking(rootTelegramRoute.tenantId);
    },
  }).then((dispose) => {
    disposeRootTelegramRuntime = typeof dispose === 'function' ? dispose : () => {};
  });
  window.addEventListener('pagehide', () => disposeRootTelegramRuntime(), { once: true });
}
