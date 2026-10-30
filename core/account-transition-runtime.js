import { USER_ORIGIN } from './environment.js';
import {
  clearAccount,
  getAccountToken,
  getGlobalAccount,
  getGlobalAccountPlatformState,
} from './account/index.js';
import { renderGlobalAccount } from '../online-booking/account-shell.js';
import { renderGlobalClient } from '../online-booking/booking.js';

const END_USER_HOST = new URL(USER_ORIGIN).hostname;
const LOGIN_FORM = '[data-global-account-entry]';
const LOGOUT_ACTION = '[data-shared-profile-action="logout"]';
const TRANSITION_CLASS = 'account-transition-splash';
const TRANSITION_DATASET = 'accountTransition';

let revealToken = '';
let revealPromise = null;
let logoutGuardUntil = 0;
let logoutRecoveryPending = false;

function isEndUserHost() {
  return String(location.hostname || '').toLowerCase() === END_USER_HOST;
}

function accountRoot() {
  return document.querySelector('#app-content');
}

function isLoadingSurface(root) {
  const screen = root?.querySelector('.v2-app--flow-center');
  if (!screen) return false;
  const title = String(screen.querySelector('.v2-flow-title')?.textContent || '').trim();
  const subtitle = String(screen.querySelector('.v2-flow-subtitle')?.textContent || '').trim();
  return title === 'Профиль' && subtitle === 'Загрузка…';
}

function isAnonymousFlow(root) {
  if (!root) return false;
  return Boolean(
    root.querySelector(LOGIN_FORM)
    || root.querySelector('[data-global-account-form]')
    || root.querySelector('[data-global-platform-continue]')
    || isLoadingSurface(root)
  );
}

function syncSplash() {
  if (!isEndUserHost()) return;
  const root = accountRoot();
  if (!root) return;
  const explicit = root.dataset[TRANSITION_DATASET] === 'login';
  root.classList.toggle(TRANSITION_CLASS, explicit || isLoadingSurface(root));
}

function clearTransition(root = accountRoot()) {
  if (!root) return;
  delete root.dataset[TRANSITION_DATASET];
  syncSplash();
}

function bookingStart(tenantId, options = {}) {
  const id = String(tenantId || '').trim();
  if (!id) return;
  const repeatRequest = options?.repeatRequest && typeof options.repeatRequest === 'object'
    ? options.repeatRequest
    : null;
  const workplaceKey = String(
    options?.workplaceKey
    || repeatRequest?.workplaceId
    || repeatRequest?.workplaceKey
    || ''
  ).trim();
  window.dispatchEvent(new CustomEvent('cova:account-booking-start', {
    detail: {
      tenantId: id,
      workplaceKey,
      repeatRequest,
      entry: repeatRequest ? 'repeat' : workplaceKey ? 'workplace' : 'profile',
    },
  }));
}

function fastState(account) {
  return {
    tenantId: '',
    context: {},
    accountDraft: {},
    contactErrors: {},
    account,
    accountTerms: null,
    accountTermsAccepted: true,
    relationships: [],
    accountRecords: [],
    error: '',
    accountJournalDate: null,
    accountTab: 'journal',
    accountDeckOpen: false,
    accountDeckActive: 'journal',
    accountSelectedContactTenantId: '',
    accountSelectedChatTenantId: '',
  };
}

function fastCallbacks(root, state) {
  return {
    onStartBooking: bookingStart,
    onLogout: () => {
      clearAccount('');
      state.account = null;
      state.relationships = [];
      state.accountRecords = [];
      clearTransition(root);
      void renderGlobalClient(root, { tab: 'journal' });
    },
  };
}

async function revealSignedInHome() {
  if (!isEndUserHost()) return false;
  const initialRoot = accountRoot();
  const token = getAccountToken('');
  if (!initialRoot || !token) return false;

  if (revealPromise && revealToken === token) return revealPromise;
  revealToken = token;
  revealPromise = (async () => {
    const [account, platformState] = await Promise.all([
      getGlobalAccount(),
      getGlobalAccountPlatformState(),
    ]);
    if (!account || getAccountToken('') !== token) return false;
    if (!platformState?.accepted || getAccountToken('') !== token) return false;

    const root = accountRoot();
    if (!root || isAnonymousFlow(root)) return false;
    const state = fastState(account);
    await renderGlobalAccount(root, state, fastCallbacks(root, state));
    clearTransition(root);
    return true;
  })().catch(() => false).finally(() => {
    if (revealToken === token) revealPromise = null;
  });

  return revealPromise;
}

async function waitForLoginResult(form, root) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 10000) {
    const token = getAccountToken('');
    if (token) {
      await revealSignedInHome();
      clearTransition(root);
      return;
    }
    if (!form.isConnected) {
      clearTransition(root);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }
  clearTransition(root);
}

function recoverLoggedOutScreen() {
  if (!isEndUserHost() || Date.now() > logoutGuardUntil || getAccountToken('')) return;
  const root = accountRoot();
  if (!root || isAnonymousFlow(root) || logoutRecoveryPending) return;
  logoutRecoveryPending = true;
  clearTransition(root);
  void renderGlobalClient(root, { tab: 'journal' }).finally(() => {
    logoutRecoveryPending = false;
  });
}

function maybeRevealInitialSession() {
  if (!isEndUserHost() || !getAccountToken('')) return;
  const root = accountRoot();
  if (!root || root.querySelector('[data-v2-app]') || isAnonymousFlow(root)) return;
  void revealSignedInHome();
}

if (isEndUserHost()) {
  document.addEventListener('submit', (event) => {
    const form = event.target instanceof Element ? event.target.closest(LOGIN_FORM) : null;
    if (!form) return;
    const root = accountRoot();
    if (!root) return;
    root.dataset[TRANSITION_DATASET] = 'login';
    syncSplash();
    void waitForLoginResult(form, root);
  });

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest(LOGOUT_ACTION) : null;
    if (!target) return;
    logoutGuardUntil = Date.now() + 3000;
    queueMicrotask(recoverLoggedOutScreen);
    window.setTimeout(recoverLoggedOutScreen, 120);
    window.setTimeout(recoverLoggedOutScreen, 650);
    window.setTimeout(recoverLoggedOutScreen, 1800);
  });

  const observer = new MutationObserver(() => {
    syncSplash();
    maybeRevealInitialSession();
    recoverLoggedOutScreen();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncSplash();
  maybeRevealInitialSession();
}
