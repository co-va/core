import { renderPeople } from './core/people/people.js';
import { financeNavigationItems, renderFinanceSection } from './core/finance/index.js';
import { inventoryNavigationItems, renderInventorySection } from './core/inventory/index.js';
import { loyaltyNavigationItems, renderLoyaltySection } from './core/loyalty/index.js';
import { renderJournal } from './journal/journal.js';
import { renderTimetable } from './timetable/timetable.js';
import { settingsNavigationItems, renderSettingsSection } from './settings/settings.js';
import { render as renderProfile } from './core/profile/profile.js';
import { getProfile } from './core/profile/data.js';
import { render as renderService } from './core/service/service.js';
import { renderChat } from './chat/chat.js';
import { getWorkplaces as getWorkplaceEntities } from './core/profile/workplaces/data.js';
import { loadProfileState } from './core/profile/runtime.js';
import { loadBusinessState } from './core/runtime/business-state.js';
import { loadOperationalState } from './core/runtime/operational-state.js';
import { ensureRknGuide, loadTenantDocumentArchive, refreshTenantDocumentArchive } from './core/runtime/tenant-document-archive.js';
import { loadAuxiliaryState, loadFinanceState } from './core/runtime/auxiliary-state.js';
import { getJournalTimeUsages, releaseJournalSoftTimeUsages } from './journal/time-usage-source.js';
import { configureWorkplaceSource } from './core/workplace-time.js';
import { configureTimeUsageSource, configureSoftTimeUsageReleaseSource } from './core/time/index.js';
import { getCurrentAccount, login, requestPasswordReset } from './core/auth.js';
import { resolveBookingPublicRoute } from './core/account/index.js';
import { activateBookDemo, canUseBookCapability, getBookAccess, loadBookAccess } from './core/access.js';
import { startServerBookingSync } from './online-booking/server-sync.js';
import { renderGlobalClient } from './online-booking/booking.js';
import { renderAccess as renderOnlineBooking } from './online-booking/access.js';
import './online-booking/account-runtime.js';
import { field, passwordField, initPasswordFields, mountV2ZLayer, openNotice, initV2WorkspaceInteraction, setV2DeckOpen, v2CardDeck, v2Header, v2Shell, v2Sticker, v2ZLayer } from './ui/ui.js';
import { startPlatformNotices } from './core/platform-notices.js';
import { USER_ORIGIN } from './core/environment.js';

configureWorkplaceSource(getWorkplaceEntities);
configureTimeUsageSource(getJournalTimeUsages);
configureSoftTimeUsageReleaseSource(releaseJournalSoftTimeUsages);

const END_USER_APP_HOSTS = new Set([
  new URL(USER_ORIGIN).hostname,
]);

const ROOT_SECTIONS = [
  { id: 'people', label: 'Клиенты', capability: 'people.access' },
  { id: 'journal', label: 'Журнал', capability: '' },
  { id: 'timetable', label: 'График', capability: 'timetable.access' },
  { id: 'profile', label: 'Профиль', capability: '' },
  { id: 'service', label: 'Сервис', capability: 'services.access' },
  { id: 'loyalty', label: 'Лояльность', capability: '' },
  { id: 'finance', label: 'Финансы', capability: '' },
  { id: 'inventory', label: 'Склад', capability: '' },
  { id: 'settings', label: 'Настройки', capability: '' },
];

const state = {
  activeSection: 'journal',
  lastRootSection: 'journal',
  navigationOpen: false,
  navigationLevel: 'f',
  navigationEnterZ: false,
  chatPersonKey: '',
  journalView: 'day',
  secondary: {
    finance: 'cash',
    inventory: 'stock',
    loyalty: 'deposit',
    settings: 'online-booking',
  },
};
const app = document.querySelector('#app');
let disposeView = () => {};
let workspaceReady = false;
let authenticatedAccount = null;
let serverBookingSyncStarted = false;
let disposePlatformNotices = () => {};
let rknGuideSyncTimer = null;
let workspaceRenderVersion = 0;

async function syncRknGuideIfReady() {
  if (!authenticatedAccount) return false;
  const result = await ensureRknGuide();
  if (!result?.ready) return false;
  await refreshTenantDocumentArchive();
  return true;
}

function scheduleRknGuideSync() {
  if (!authenticatedAccount) return;
  if (rknGuideSyncTimer) window.clearTimeout(rknGuideSyncTimer);
  rknGuideSyncTimer = window.setTimeout(() => {
    rknGuideSyncTimer = null;
    void syncRknGuideIfReady().catch((error) => {
      console.error('RKN guide sync failed', error);
    });
  }, 700);
}

window.addEventListener('book:profile-changed', scheduleRknGuideSync);
window.addEventListener('book:server-mutation-completed', (event) => {
  const scopes = Array.isArray(event?.detail?.scopes) ? event.detail.scopes : [];
  if (scopes.includes('operational')) scheduleRknGuideSync();
});

window.addEventListener('book:business-persistence-error', (event) => {
  const message = String(event?.detail?.message || 'Не удалось сохранить изменения на сервере.');
  openNotice({ title: 'Не удалось сохранить', message, surface: 'app' });
});

window.addEventListener('book:record-chat-request', (event) => {
  if (!workspaceReady) return;
  const layer = mountV2ZLayer(app, v2ZLayer('', { className: 'record-chat-z' }), { stack: true });
  if (!layer) return;
  renderChat(layer, {
    personKey: String(event?.detail?.personKey || ''),
  });
});

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

function publicBookingPath() {
  if (!isEndUserAppHost()) return null;
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

async function renderPublicBooking(route) {
  workspaceReady = false;
  disposeView();
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');
  app.innerHTML = '<main class="booking-content" id="app-content"></main>';
  disposeView = await renderOnlineBooking(document.querySelector('#app-content'), {
    ...route,
    onExitToAccount: (target = {}) => {
      history.replaceState({}, '', isEndUserAppHost() ? '/' : location.pathname);
      void renderGlobalClientRoot(target);
    },
  });
  syncViewport();
}

function isEndUserAppHost() {
  const host = String(location.hostname || '').toLowerCase();
  return END_USER_APP_HOSTS.has(host);
}

async function renderGlobalClientRoot(initial = {}) {
  workspaceReady = false;
  disposeView();
  disposeView = () => {};
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');
  app.innerHTML = '<main class="booking-content" id="app-content"></main>';
  await renderGlobalClient(document.querySelector('#app-content'), initial);
  syncViewport();
}

function ensureServerBookingSync() {
  if (serverBookingSyncStarted) return;
  serverBookingSyncStarted = true;
  startServerBookingSync();
}

function rootDefinition(section) {
  return ROOT_SECTIONS.find((item) => item.id === section) || null;
}

function sectionAllowed(section) {
  if (section === 'chat') return canUseBookCapability('chat.access');
  if (section === 'finance' || section === 'inventory' || section === 'loyalty' || section === 'settings') {
    return secondaryItems(section).length > 0;
  }
  const item = rootDefinition(section);
  return Boolean(item && (!item.capability || canUseBookCapability(item.capability)));
}

function allowedSections() {
  return ROOT_SECTIONS.filter((item) => sectionAllowed(item.id)).map((item) => item.id);
}

function rootDisplayLabel(section) {
  const definition = rootDefinition(section);
  if (!definition) return '';
  const children = secondaryItems(section);
  return children.length === 1 ? children[0].label : definition.label;
}

function allowedRootItems() {
  return ROOT_SECTIONS
    .filter((item) => sectionAllowed(item.id))
    .map(({ id }) => {
      const children = secondaryItems(id);
      return {
        id,
        label: rootDisplayLabel(id),
        childrenCount: children.length > 1 ? children.length : 0,
      };
    });
}

function defaultSection() {
  if (sectionAllowed('journal')) return 'journal';
  return allowedSections()[0] || 'settings';
}

function normalizeRequestedSection(section) {
  return String(section || '').trim();
}
function activeRootSection() {
  return state.activeSection === 'chat' ? state.lastRootSection : state.activeSection;
}

function secondaryItems(section = activeRootSection()) {
  if (section === 'finance') return financeNavigationItems();
  if (section === 'inventory') return inventoryNavigationItems();
  if (section === 'loyalty') return loyaltyNavigationItems();
  if (section === 'settings') return settingsNavigationItems();
  return [];
}

function ensureSecondary(section) {
  const items = secondaryItems(section);
  if (!items.length) return '';
  const selected = String(state.secondary[section] || '');
  if (items.some((item) => item.id === selected)) return selected;
  state.secondary[section] = items[0].id;
  return items[0].id;
}

function setNavigationOpen(open) {
  state.navigationOpen = Boolean(open);
  if (!state.navigationOpen) state.navigationLevel = 'f';
  setV2DeckOpen(app, state.navigationOpen);
}

function navigate(section, { navigationOpen = state.navigationOpen, updateHash = true, chatPersonKey = '' } = {}) {
  if (!workspaceReady) return;
  const next = normalizeRequestedSection(section);
  if (!sectionAllowed(next)) return;
  if (next === 'chat') {
    if (state.activeSection !== 'chat') state.lastRootSection = activeRootSection();
    state.activeSection = 'chat';
    state.chatPersonKey = String(chatPersonKey || '');
    state.navigationOpen = false;
    state.navigationLevel = 'f';
  } else {
    state.activeSection = next;
    state.chatPersonKey = '';
    state.lastRootSection = next;
    state.navigationOpen = Boolean(navigationOpen);
    if (!state.navigationOpen) state.navigationLevel = 'f';
    ensureSecondary(next);
  }
  renderWorkspace();
  if (updateHash) history.replaceState({}, '', `#${state.activeSection}`);
}

function selectSecondary(id) {
  const section = activeRootSection();
  const items = secondaryItems(section);
  if (!items.some((item) => item.id === id)) return;
  state.secondary[section] = id;
  state.navigationOpen = false;
  state.navigationLevel = 'f';
  state.navigationEnterZ = true;
  renderWorkspace();
  history.replaceState({}, '', `#${section}`);
}

function sourceText(node, fallback = '') {
  const value = String(node?.textContent || '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function isAddPrimarySource(source) {
  if (!source) return false;
  const label = String(source.dataset.v2PrimaryLabel || source.getAttribute('aria-label') || source.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('ru-RU');
  if (label === '+' || label.startsWith('добав')) return true;
  if (source.matches('[data-add],[data-add-workplace]')) return true;
  return [...source.attributes].some((attribute) => /^data-(?:[a-z0-9-]*-)?add(?:-|$)/i.test(attribute.name));
}

function primarySource(surface) {
  const candidates = [
    ...surface.querySelectorAll('[data-v2-primary-action], .page-header-action button, [data-add], [data-add-workplace]'),
  ];
  return candidates.find(isAddPrimarySource) || null;
}

function primaryLabel(source) {
  return source ? '+' : '';
}

function primaryVisible(source) {
  if (!source || source.hidden || source.dataset.v2PrimaryVisible === 'false') return false;
  if (source.matches('.accordion-save') && !source.classList.contains('is-visible')) return false;
  return true;
}

function syncWorkspacePrimarySource(surface, source) {
  surface.querySelectorAll('.v2-workspace-source-hidden').forEach((node) => {
    if (node !== source) node.classList.remove('v2-workspace-source-hidden');
  });
  if (source && !source.classList.contains('v2-workspace-source-hidden')) {
    source.classList.add('v2-workspace-source-hidden');
  }
}

function activeWorkspaceSurface(surface) {
  const qLayers = [...document.querySelectorAll('[data-v2-q="true"] .v2-layer')];
  if (qLayers.length) return qLayers.at(-1);
  const layers = [...app.querySelectorAll('[data-v2-z-layer]')];
  return layers.at(-1) || surface;
}

function workspaceProfileASlot() {
  const profile = getProfile();
  const name = [profile.name, profile.surname].filter(Boolean).join(' ') || 'Профиль';
  const crop = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Math.round(Number(value)))) : 50;
  return {
    kind: 'avatar',
    label: name,
    image: String(profile.photo || ''),
    imagePosition: `${crop(profile.photoCropX)}% ${crop(profile.photoCropY)}%`,
    initials: name.slice(0, 1).toUpperCase() || '?',
  };
}

function syncWorkspaceHeader(surface) {
  if (!surface?.isConnected) return;
  const contextRoot = activeWorkspaceSurface(surface);
  const context = contextRoot.querySelector('[data-workspace-header-context]');
  const root = activeRootSection();
  const fallbackTitle = state.activeSection === 'chat'
    ? 'Чат'
    : rootDefinition(root)?.label || '';
  const title = context?.dataset.workspaceTitle || sourceText(
    contextRoot.querySelector('.page-header h1'),
    fallbackTitle,
  );
  const aContext = contextRoot.querySelector('[data-workspace-a-context]');
  const dSource = contextRoot.querySelector('[data-workspace-d-action]');
  const cSource = primarySource(contextRoot);
  const cVisible = primaryVisible(cSource);
  syncWorkspacePrimarySource(contextRoot, cVisible ? cSource : null);
  const header = app.querySelector('[data-v2-header]');
  if (!header) return;

  const aSlot = aContext
    ? {
        kind: 'avatar',
        label: aContext.dataset.workspaceALabel || '',
        image: aContext.dataset.workspaceAImage || '',
        imagePosition: aContext.dataset.workspaceAImagePosition || '',
        initials: aContext.dataset.workspaceAInitials || '',
      }
    : workspaceProfileASlot();

  header.outerHTML = v2Header({
    a: aSlot,
    b: title,
    c: cVisible ? {
      kind: 'text',
      label: primaryLabel(cSource),
      data: 'data-v2-workspace-primary',
      aria: cSource.getAttribute('aria-label') || 'Добавить',
      disabled: Boolean(cSource.disabled),
    } : null,
    d: sectionAllowed('chat') ? {
      kind: dSource?.dataset.workspaceDKind || 'chat',
      data: 'data-v2-workspace-chat',
      aria: dSource?.getAttribute('aria-label') || (state.activeSection === 'chat' ? 'Вернуться из чата' : 'Чат'),
    } : null,
  });

  app.querySelector('[data-v2-workspace-primary]')?.addEventListener('click', () => cSource?.click());
  app.querySelector('[data-v2-workspace-chat]')?.addEventListener('click', () => {
    if (dSource) {
      dSource.click();
      return;
    }
    if (state.activeSection === 'chat') navigate(state.lastRootSection, { navigationOpen: false });
    else navigate('chat', { navigationOpen: false });
  });
}

async function ensureWorkspaceState(section) {
  const secondary = section === 'finance' || section === 'settings' ? ensureSecondary(section) : '';
  const needsAuxiliary = section === 'people'
    || section === 'loyalty'
    || section === 'service'
    || (section === 'finance' && secondary === 'cash')
    || (section === 'settings' && secondary === 'tags');
  if (needsAuxiliary) await loadAuxiliaryState();
  if (section === 'people' || (section === 'settings' && secondary === 'documents')) {
    await loadTenantDocumentArchive();
  }
}

async function renderActiveWorkspaceSurface(surface) {
  const section = state.activeSection;
  await ensureWorkspaceState(section);
  const openNavigation = () => setNavigationOpen(true);
  if (section === 'people') return renderPeople(surface, {
    onDirectChat: (personKey) => navigate('chat', { navigationOpen: false, chatPersonKey: personKey }),
  });
  if (section === 'finance') return renderFinanceSection(surface, ensureSecondary('finance'), {
    onDirectChat: (personKey) => navigate('chat', { navigationOpen: false, chatPersonKey: personKey }),
  });
  if (section === 'inventory') return renderInventorySection(surface, ensureSecondary('inventory'));
  if (section === 'loyalty') return renderLoyaltySection(surface, ensureSecondary('loyalty'));
  if (section === 'timetable') return renderTimetable(surface);
  if (section === 'journal') {
    return renderJournal(surface, {
      initialView: state.journalView || 'day',
      onViewChange: (view) => {
        state.journalView = view;
      },
    });
  }
  if (section === 'profile') return renderProfile(surface, openNavigation);
  if (section === 'service') return renderService(surface, openNavigation);
  if (section === 'settings') return renderSettingsSection(surface, ensureSecondary('settings'), { onBack: openNavigation });
  if (section === 'chat') return renderChat(surface, { personKey: state.chatPersonKey });
  return renderPeople(surface);
}

function renderWorkspace() {
  setThemeColor('#2F3338');
  app.classList.remove('app-shell--booking');
  workspaceReady = true;
  disposeView();
  disposeView = () => {};
  const requested = normalizeRequestedSection(state.activeSection);
  if (!sectionAllowed(requested)) state.activeSection = defaultSection();
  if (state.activeSection !== 'chat') state.lastRootSection = state.activeSection;

  const root = activeRootSection();
  const rootItems = allowedRootItems();
  const childItems = secondaryItems(root);
  const childActive = ensureSecondary(root);
  const rootDeck = v2CardDeck(rootItems, {
    axis: 'x',
    active: root,
    data: 'data-v2-root-item',
    className: 'v2-deck--root',
    role: 'root',
    level: 'f',
  });
  const eDeck = childItems.length > 1 ? v2CardDeck(childItems, {
    axis: 'y',
    active: childActive,
    data: 'data-v2-secondary-item',
    level: 'e',
  }) : '';

  const headerMarkup = v2Header({
    a: workspaceProfileASlot(),
    b: state.activeSection === 'chat' ? 'Чат' : rootDisplayLabel(root),
    d: sectionAllowed('chat') ? { kind: 'chat', data: 'data-v2-workspace-chat', aria: 'Чат' } : null,
  });
  let shell = app.querySelector(':scope > [data-v2-app].v2-app--workspace');
  if (!shell) {
    app.innerHTML = v2Shell({
      header: headerMarkup,
      deck: rootDeck,
      eDeck,
      deckOpen: state.navigationOpen,
      eOpen: state.navigationOpen && state.navigationLevel === 'e',
      zEnter: Boolean(state.navigationEnterZ),
      className: 'v2-app--workspace',
      body: '<section class="v2-workspace-surface" data-v2-workspace-surface></section>',
    });
    shell = app.querySelector(':scope > [data-v2-app].v2-app--workspace');
  } else {
    const currentHeader = shell.querySelector(':scope > .v2-header');
    if (currentHeader) currentHeader.outerHTML = headerMarkup;

    const feHost = shell.querySelector('[data-v2-fe]');
    const currentF = feHost?.querySelector('[data-v2-card-deck][data-v2-deck-level="f"]');
    const nextFIds = rootItems.map((item) => String(item.id || '')).join('|');
    const currentFIds = [...(currentF?.querySelectorAll('[data-v2-card-item]') || [])]
      .map((card) => String(card.dataset.v2CardItem || '')).join('|');
    if (nextFIds !== currentFIds) {
      if (currentF) currentF.outerHTML = rootDeck;
      else if (rootDeck && feHost) feHost.insertAdjacentHTML('afterbegin', rootDeck);
    }

    const currentE = feHost?.querySelector('[data-v2-card-deck][data-v2-deck-level="e"]');
    const nextEIds = childItems.map((item) => String(item.id || '')).join('|');
    const currentEIds = [...(currentE?.querySelectorAll('[data-v2-card-item]') || [])]
      .map((card) => String(card.dataset.v2CardItem || '')).join('|');
    if (nextEIds !== currentEIds) {
      currentE?.remove();
      if (eDeck && feHost) feHost.insertAdjacentHTML('beforeend', eDeck);
    }

    setV2DeckOpen(shell, state.navigationOpen);
    shell.classList.toggle('is-e-open', Boolean(state.navigationOpen && state.navigationLevel === 'e' && eDeck));
    shell.classList.toggle('is-z-entering', Boolean(state.navigationEnterZ && !state.navigationOpen));
    const persistentSurface = shell.querySelector('[data-v2-workspace-surface]');
    persistentSurface?.replaceChildren();
  }

  state.navigationEnterZ = false;

  const surface = shell?.querySelector('[data-v2-workspace-surface]');
  const disposers = [];
  let moduleDispose = () => {};
  let disposed = false;
  const renderVersion = ++workspaceRenderVersion;

  app.querySelector('[data-v2-workspace-chat]')?.addEventListener('click', () => navigate('chat', { navigationOpen: false }));

  if (shell) disposers.push(initV2WorkspaceInteraction(shell, {
    activeId: root,
    eActiveId: childActive,
    deckOpen: state.navigationOpen,
    eOpen: state.navigationOpen && state.navigationLevel === 'e',
    onDeckOpenChange: (open) => {
      state.navigationOpen = open;
      if (open) state.navigationLevel = 'f';
      else state.navigationLevel = 'f';
    },
    onEOpenChange: (open) => {
      state.navigationLevel = open ? 'e' : 'f';
    },
    onRootSelect: (id) => {
      const hasE = secondaryItems(id).length > 1;
      state.navigationLevel = hasE ? 'e' : 'f';
      state.navigationEnterZ = !hasE;
      navigate(id, { navigationOpen: hasE });
    },
    onSecondarySelect: (id) => selectSecondary(id),
  }));

  const onV2ContextChanged = () => syncWorkspaceHeader(surface);
  window.addEventListener('book:v2-context-changed', onV2ContextChanged);
  disposers.push(() => window.removeEventListener('book:v2-context-changed', onV2ContextChanged));

  let headerSyncQueued = false;
  const observer = new MutationObserver(() => {
    if (headerSyncQueued || disposed) return;
    headerSyncQueued = true;
    queueMicrotask(() => {
      headerSyncQueued = false;
      if (!disposed) syncWorkspaceHeader(surface);
    });
  });
  if (surface) observer.observe(surface, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'disabled', 'aria-label', 'data-v2-primary-visible', 'data-v2-primary-label', 'data-v2-primary-variant'],
  });

  const result = surface ? renderActiveWorkspaceSurface(surface) : null;
  Promise.resolve(result).then((nextDispose) => {
    if (disposed || renderVersion !== workspaceRenderVersion) {
      if (typeof nextDispose === 'function') nextDispose();
      return;
    }
    if (typeof nextDispose === 'function') moduleDispose = nextDispose;
    syncWorkspaceHeader(surface);
  }).catch((error) => {
    console.error('Workspace UI render failed', error);
  });
  syncWorkspaceHeader(surface);

  disposeView = () => {
    disposed = true;
    observer.disconnect();
    disposers.forEach((dispose) => dispose?.());
    moduleDispose?.();
  };

  syncViewport();
}

function renderSuspended() {
  app.classList.remove('app-shell--booking');
  workspaceReady = false;
  disposeView();
  disposeView = () => {};
  app.innerHTML = v2Sticker({
    title: 'Рабочее пространство временно недоступно',
    body: '<p>Доступ к этому рабочему пространству приостановлен владельцем платформы.</p>',
    className: 'v2-sticker-screen--technical',
    closeData: 'data-suspended-u-close',
  });
  app.querySelector('[data-suspended-u-close]')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
  });
  syncViewport();
}

function startRegularPlatformNotices() {
  disposePlatformNotices();
  disposePlatformNotices = startPlatformNotices({
    onAccessChanged: async () => {
      await loadBookAccess();
      if (getBookAccess().status === 'SUSPENDED') {
        renderSuspended();
        return;
      }
      if (workspaceReady) renderWorkspace();
    },
  });
}

async function renderAuthenticated(account = authenticatedAccount) {
  authenticatedAccount = account || authenticatedAccount;
  const profileReady = loadProfileState();
  await Promise.all([
    profileReady,
    loadBusinessState(),
    loadOperationalState(),
    loadFinanceState(),
    loadBookAccess(),
  ]);
  if (getBookAccess().status === 'SUSPENDED') {
    renderSuspended();
    return;
  }
  ensureServerBookingSync();

  disposePlatformNotices();
  disposePlatformNotices = () => {};

  const freshDemo = getBookAccess().commercialMode === 'DEMO' && !getBookAccess().demoActivatedAt;
  state.activeSection = freshDemo && sectionAllowed('profile')
    ? 'profile'
    : sectionAllowed('journal') ? 'journal' : defaultSection();
  if (freshDemo && state.activeSection === 'profile') await activateBookDemo();
  if (state.activeSection !== 'chat') state.lastRootSection = state.activeSection;
  history.replaceState({}, '', `#${state.activeSection}`);
  renderWorkspace();
  startRegularPlatformNotices();
}

function renderPasswordResetRequest() {
  setThemeColor('#F5F5F3');
  app.classList.remove('app-shell--booking');
  workspaceReady = false;
  disposeView();
  disposeView = () => {};

  app.innerHTML = v2Sticker({
    title: 'Восстановление пароля',
    body: `<form class="auth-form" id="password-reset-request-form">
      ${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'email' })}
      <p>Укажите email профиля. Если учётная запись существует, на него придёт ссылка для изменения пароля.</p>
      <p class="auth-error" data-password-reset-request-error role="alert"></p>
    </form>`,
    action: '<button class="ui-button" type="submit" form="password-reset-request-form">Отправить ссылку</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-password-reset-request-close',
  });

  app.querySelector('[data-password-reset-request-close]')?.addEventListener('click', () => renderLogin());
  const form = app.querySelector('#password-reset-request-form');
  const error = app.querySelector('[data-password-reset-request-error]');
  const button = app.querySelector('button[type="submit"][form="password-reset-request-form"]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Отправляем…';
    const data = new FormData(form);
    try {
      await requestPasswordReset(data.get('email'));
      app.innerHTML = v2Sticker({
        title: 'Проверьте почту',
        body: '<p>Если профиль с таким email существует, ссылка для изменения пароля отправлена. Ссылка действует 30 минут.</p>',
        action: '<button class="ui-button" type="button" data-password-reset-return>Вернуться ко входу</button>',
        className: 'v2-sticker-screen--auth',
      });
      app.querySelector('[data-password-reset-return]')?.addEventListener('click', () => renderLogin());
    } catch (requestError) {
      error.textContent = requestError instanceof Error ? requestError.message : 'Не удалось отправить ссылку восстановления';
      button.disabled = false;
      button.textContent = 'Отправить ссылку';
    }
  });
  syncViewport();
}

function renderLogin(message = '') {
  setThemeColor('#F5F5F3');
  app.classList.remove('app-shell--booking');
  workspaceReady = false;
  disposeView();
  disposeView = () => {};

  const body = `
    <form class="auth-form" id="auth-form">
      ${field({ label: 'Email', name: 'email', type: 'email', required: true, autocomplete: 'username' })}
      ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })}
      <p class="auth-error" id="auth-error" role="alert">${message}</p>
      <button type="button" class="v2-sticker-link" data-specialist-forgot>Забыли пароль?</button>
    </form>`;

  app.innerHTML = v2Sticker({
    title: 'Вход',
    body,
    action: '<button class="ui-button" type="submit" form="auth-form">Войти</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-specialist-u-close',
  });

  initPasswordFields(app);
  app.querySelector('[data-specialist-u-close]')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
  });
  app.querySelector('[data-specialist-forgot]')?.addEventListener('click', renderPasswordResetRequest);

  const form = app.querySelector('#auth-form');
  const error = app.querySelector('#auth-error');
  const button = app.querySelector('button[type="submit"][form="auth-form"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Входим…';
    const data = new FormData(form);

    try {
      const account = await login(data.get('email'), data.get('password'));
      authenticatedAccount = account;
      await renderAuthenticated(account);
    } catch (loginError) {
      error.textContent = loginError instanceof Error ? loginError.message : 'Не удалось войти';
      button.disabled = false;
      button.textContent = 'Войти';
    }
  });

  syncViewport();
}

window.addEventListener('book:auth-logout', () => {
  authenticatedAccount = null;
  disposePlatformNotices();
  disposePlatformNotices = () => {};
  history.replaceState({}, '', location.pathname);
  renderLogin();
});

window.addEventListener('hashchange', () => {
  if (!workspaceReady) return;
  const section = normalizeRequestedSection(location.hash.slice(1));
  if (sectionAllowed(section)) {
    navigate(section, { navigationOpen: false, updateHash: false });
  } else {
    history.replaceState({}, '', `#${state.activeSection}`);
  }
});
window.addEventListener('book:v2-navigation-request', (event) => {
  if (!workspaceReady) return;
  setNavigationOpen(event?.detail?.open !== false);
});
window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });

document.addEventListener('focusin', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.matches('input, select, textarea')) return;
  if (target.closest('[data-v2-layer]')) return;
  window.setTimeout(() => target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }), 120);
}, { passive: true });

syncViewport();

const publicBooking = await bookingRoute();
if (publicBooking) {
  await renderPublicBooking(publicBooking);
} else if (isEndUserAppHost()) {
  await renderGlobalClientRoot();
} else {
  try {
    const currentAccount = await getCurrentAccount();
    if (currentAccount) {
      authenticatedAccount = currentAccount;
      await renderAuthenticated(currentAccount);
    } else {
      renderLogin();
    }
  } catch {
    renderLogin('Сервер временно недоступен');
  }
}
