import { v2V } from './v.js';

function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

function activeQSurface(app) {
  if (!app?.classList?.contains('has-v2-q-modal')) return null;
  const qLayers = [...document.querySelectorAll('[data-v2-layer][data-v2-q="true"]')]
    .filter((layer) => layer?.isConnected);
  return qLayers.at(-1) || null;
}

function activeWorkspaceSurface(app) {
  const qSurface = activeQSurface(app);
  if (qSurface) return qSurface;
  const layers = [...(app?.querySelectorAll?.('[data-v2-z-layer]') || [])];
  return layers.at(-1) || app?.querySelector?.('[data-v2-front] > [data-v2-z]') || null;
}

function syncControlState(control, source) {
  if (!control || !source) return;
  const disabled = Boolean(source.disabled);
  const aria = source.getAttribute('aria-label') || 'Действия раздела';
  if (control.disabled !== disabled) control.disabled = disabled;
  if (control.getAttribute('aria-label') !== aria) control.setAttribute('aria-label', aria);
}

export function setV2V(root, options = null) {
  const app = rootApp(root);
  const host = app?.querySelector?.(':scope > [data-v2-v-host]');
  if (!host) return null;
  if (!options) {
    if (!host.firstChild && host.hidden) return null;
    if (host.firstChild) host.innerHTML = '';
    if (!host.hidden) host.hidden = true;
    return null;
  }
  host.innerHTML = v2V(options);
  host.hidden = false;
  return host.querySelector?.('[data-v2-v]') || null;
}

export function clearV2V(root) {
  return setV2V(root, null);
}

export function bindV2VContext(root) {
  const app = rootApp(root);
  if (!app || typeof MutationObserver !== 'function') return () => {};
  let source = null;
  let control = null;
  let queued = false;
  let externalSurface = null;
  let externalObserver = null;

  const hostControl = () => app.querySelector?.(':scope > [data-v2-v-host] [data-v2-v]') || null;

  const observeExternalSurface = (surface, schedule) => {
    const next = surface && !app.contains(surface) ? surface : null;
    if (next === externalSurface) return;
    externalObserver?.disconnect();
    externalObserver = null;
    externalSurface = next;
    if (!externalSurface) return;
    externalObserver = new MutationObserver(schedule);
    externalObserver.observe(externalSurface, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'disabled', 'aria-label'],
    });
  };

  const sync = () => {
    queued = false;
    if (!app.isConnected) return;
    const surface = activeWorkspaceSurface(app);
    observeExternalSurface(surface, schedule);
    const nextSource = surface?.querySelector?.('[data-workspace-v-action]') || null;
    const currentControl = hostControl();

    if (currentControl && currentControl !== control) {
      source = nextSource;
      control = null;
      return;
    }

    if (!nextSource || nextSource.hidden) {
      if (control?.isConnected) clearV2V(app);
      source = nextSource;
      control = null;
      return;
    }

    if (nextSource === source && control?.isConnected) {
      syncControlState(control, source);
      return;
    }

    source = nextSource;
    control = setV2V(app, { aria: source.getAttribute('aria-label') || 'Действия раздела' });
    if (control) {
      syncControlState(control, source);
      control.addEventListener('click', () => {
        if (!source?.isConnected || source.disabled) return;
        source.click();
      });
    }
  };

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'aria-label'],
  });
  window.addEventListener('book:v2-context-changed', schedule);
  sync();
  return () => {
    observer.disconnect();
    externalObserver?.disconnect();
    externalObserver = null;
    externalSurface = null;
    window.removeEventListener('book:v2-context-changed', schedule);
    if (control?.isConnected && hostControl() === control) clearV2V(app);
    source = null;
    control = null;
  };
}
