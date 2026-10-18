import { floatingSettingsButton } from './index.js';

const BUTTON_SELECTOR = '[data-floating-settings-button]';

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

function resolvedSettingsA(shell) {
  const control = shell?.querySelector('[data-v2-header] [data-v2-workspace-a]') || null;
  if (!control || control.disabled || !control.querySelector('.v2-header__settings-tag')) return null;
  return control;
}

function removeFloatingSettings(surface) {
  surface?.querySelector(`:scope > ${BUTTON_SELECTOR}`)?.remove();
  surface?.classList.remove('has-floating-settings');
}

function syncFloatingSettings() {
  const shell = workspaceShell();
  if (!shell) {
    document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => button.remove());
    return;
  }

  const surfaces = zSurfaces(shell);
  const surface = surfaces.at(-1) || null;
  surfaces.forEach((item) => {
    if (item !== surface) removeFloatingSettings(item);
  });

  const settingsA = resolvedSettingsA(shell);
  if (!surface || !settingsA || shell.classList.contains('has-v2-modal')) {
    removeFloatingSettings(surface);
    return;
  }

  let button = surface.querySelector(`:scope > ${BUTTON_SELECTOR}`);
  if (!button) {
    surface.insertAdjacentHTML('beforeend', floatingSettingsButton());
    button = surface.querySelector(`:scope > ${BUTTON_SELECTOR}`);
  }
  if (!button) return;
  surface.classList.add('has-floating-settings');
  const ariaLabel = settingsA.getAttribute('aria-label') || 'Настройки';
  if (button.getAttribute('aria-label') !== ariaLabel) button.setAttribute('aria-label', ariaLabel);
  button.onclick = () => resolvedSettingsA(workspaceShell())?.click();
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
  const observer = new MutationObserver(queueSync);
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
  });
  window.addEventListener('book:v2-context-changed', queueSync);
  queueSync();
}
