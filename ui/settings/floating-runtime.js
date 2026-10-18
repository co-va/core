import { floatingSettingsButton } from './index.js';

const BUTTON_SELECTOR = '[data-floating-settings-button]';
const SETTINGS_SOURCE_SELECTOR = '[data-workspace-context-action][data-workspace-a-kind="settings"]';

function workspaceShell() {
  return document.querySelector('#app > [data-v2-app].v2-app--workspace');
}

function primarySettingsSource(shell) {
  const surface = shell?.querySelector('[data-v2-workspace-surface]');
  if (!surface) return null;
  const source = surface.querySelector(SETTINGS_SOURCE_SELECTOR);
  if (!source || source.disabled || source.dataset.floatingSettings === 'false') return null;
  return source;
}

function primaryZ(shell) {
  return shell?.querySelector(':scope > .v2-app__stage > .v2-front > .v2-z') || null;
}

function syncFloatingSettings() {
  const shell = workspaceShell();
  const z = primaryZ(shell);
  if (!z) {
    document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => button.remove());
    return;
  }

  const source = primarySettingsSource(shell);
  let button = z.querySelector(`:scope > ${BUTTON_SELECTOR}`);
  if (!source) {
    button?.remove();
    z.classList.remove('has-floating-settings');
    return;
  }

  if (!button) {
    z.insertAdjacentHTML('beforeend', floatingSettingsButton());
    button = z.querySelector(`:scope > ${BUTTON_SELECTOR}`);
  }
  if (!button) return;
  z.classList.add('has-floating-settings');
  button.setAttribute('aria-label', source.getAttribute('aria-label') || 'Настройки');
  button.onclick = () => {
    const current = primarySettingsSource(workspaceShell());
    current?.click();
  };
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
    attributeFilter: ['disabled', 'data-workspace-a-kind', 'data-floating-settings'],
  });
  window.addEventListener('book:v2-context-changed', queueSync);
  queueSync();
}
