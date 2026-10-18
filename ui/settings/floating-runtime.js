import { floatingSettingsButton } from './index.js';

const BUTTON_SELECTOR = '[data-floating-settings-button]';
const SETTINGS_SOURCE_SELECTOR = '[data-workspace-context-action][data-workspace-a-kind="settings"]';

function workspaceShell() {
  return document.querySelector('#app > [data-v2-app].v2-app--workspace');
}

function zSurfaces(shell) {
  const front = shell?.querySelector(':scope > .v2-app__stage > .v2-front');
  if (!front) return [];
  const base = front.querySelector(':scope > [data-v2-z]:not([data-v2-z-layer])');
  const layers = [...front.querySelectorAll(':scope > [data-v2-z-layer]')];
  return [base, ...layers].filter(Boolean);
}

function activeZ(shell) {
  return zSurfaces(shell).at(-1) || null;
}

function settingsSource(surface) {
  const source = surface?.querySelector(SETTINGS_SOURCE_SELECTOR) || null;
  if (!source || source.disabled || source.dataset.floatingSettings === 'false') return null;
  return source;
}

function clearFloatingSettings(shell) {
  zSurfaces(shell).forEach((surface) => {
    surface.querySelector(`:scope > ${BUTTON_SELECTOR}`)?.remove();
    surface.classList.remove('has-floating-settings');
  });
}

function syncFloatingSettings() {
  const shell = workspaceShell();
  if (!shell) {
    document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => button.remove());
    return;
  }

  const surface = activeZ(shell);
  const source = settingsSource(surface);
  clearFloatingSettings(shell);
  if (!surface || !source || document.querySelector('[data-modal]')) return;

  surface.insertAdjacentHTML('beforeend', floatingSettingsButton());
  const button = surface.querySelector(`:scope > ${BUTTON_SELECTOR}`);
  if (!button) return;
  surface.classList.add('has-floating-settings');
  button.setAttribute('aria-label', source.getAttribute('aria-label') || 'Настройки');
  button.onclick = () => settingsSource(activeZ(workspaceShell()))?.click();
}

let queued = false;
function queueSync() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    syncFloatingSettings();
  });
}

const app = document.querySelector('#app');
if (app) {
  const appObserver = new MutationObserver(queueSync);
  appObserver.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'data-workspace-a-kind', 'data-floating-settings'],
  });
  const modalObserver = new MutationObserver(queueSync);
  modalObserver.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('book:v2-context-changed', queueSync);
  queueSync();
}
