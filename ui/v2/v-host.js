import { v2V } from './v.js';

function rootApp(root) {
  return root?.matches?.('[data-v2-app]')
    ? root
    : root?.closest?.('[data-v2-app]') || root?.querySelector?.('[data-v2-app]');
}

function activeWorkspaceSurface(app) {
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

  const sync = () => {
    queued = false;
    if (!app.isConnected) return;
    const nextSource = activeWorkspaceSurface(app)?.querySelector?.('[data-workspace-v-action]') || null;
    if (nextSource === source && control?.isConnected) {
      syncControlState(control, source);
      return;
    }
    source = nextSource;
    control = source && !source.hidden
      ? setV2V(app, { aria: source.getAttribute('aria-label') || 'Действия раздела' })
      : clearV2V(app);
    if (control) {
      syncControlState(control, source);
      control.addEventListener('click', () => {
        if (!source?.isConnected || source.disabled) return;
        source.click();
      });
    }
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(app, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled', 'aria-label'] });
  sync();
  return () => {
    observer.disconnect();
    clearV2V(app);
  };
}
