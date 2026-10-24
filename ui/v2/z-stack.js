import { text } from './html.js';
import { initV2Swipe } from './swipe.js';
import { bindV2ZDismissAffordance } from './z-affordance.js';
import { v2ZFrame } from './z-layout.js';

function syncV2ZStackInteraction(app, host) {
  if (!app || !host) return;
  const base = host.querySelector(':scope > [data-v2-z]:not([data-v2-z-layer])');
  const layers = [...host.querySelectorAll(':scope > [data-v2-z-layer]')];
  const active = layers.at(-1) || base || null;
  [base, ...layers].filter(Boolean).forEach((surface) => {
    const blocked = surface !== active;
    surface.inert = blocked;
    surface.classList.toggle('is-v2-obscured', blocked);
    const dismiss = surface.querySelector(':scope > [data-v2-z-header] > [data-v2-z-dismiss], :scope > [data-v2-q-header] > [data-v2-z-dismiss]');
    if (dismiss) dismiss.hidden = blocked || (surface !== base && surface.dataset.v2Dismissible === 'false');
  });
}

export function v2ZLayer(content = '', { className = '', dismissible = true } = {}) {
  return `<main class="v2-z v2-z--layer ${text(className)}" data-v2-z-layer data-v2-dismissible="${dismissible ? 'true' : 'false'}" style="padding-top:0">${v2ZFrame(content)}</main>`;
}

export function bindV2StableZFrame(node) {
  if (!node || node.dataset.v2StableZFrame === 'true') return node;
  const body = node.querySelector?.(':scope > [data-v2-z-body]');
  if (!body) return node;
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (!descriptor?.get || !descriptor?.set) return node;

  Object.defineProperty(node, 'innerHTML', {
    configurable: true,
    get() {
      return descriptor.get.call(body);
    },
    set(value) {
      descriptor.set.call(body, String(value ?? ''));
    },
  });
  node.dataset.v2StableZFrame = 'true';
  return node;
}

function nextLayerDepth(host, dismissible) {
  const layers = [...host.querySelectorAll(':scope > [data-v2-z-layer]')];
  if (!dismissible) return 1;
  const modeRootIndex = layers.findLastIndex((layer) => layer.dataset.v2ModeRoot === 'true');
  if (modeRootIndex >= 0) return layers.length - modeRootIndex + 1;
  return layers.length + 1;
}

export function mountV2ZLayer(root, html, { onClose = null, stack = false, dismissible = true } = {}) {
  const app = root?.closest?.('[data-v2-app]') || document.querySelector('[data-v2-app]');
  const stage = app?.querySelector?.('.v2-app__stage');
  const front = app?.querySelector?.('[data-v2-front]');
  const host = front || stage;
  if (!host) return null;
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  const node = template.content.firstElementChild;
  if (!node?.matches?.('[data-v2-z-layer]')) return null;
  bindV2StableZFrame(node);
  node.dataset.v2Dismissible = dismissible ? 'true' : 'false';
  if (!dismissible) node.dataset.v2ModeRoot = 'true';
  if (!stack) host.querySelectorAll('[data-v2-z-layer]').forEach((layer) => {
    if (typeof layer.v2Dispose === 'function') layer.v2Dispose();
    else layer.remove();
  });
  const depth = nextLayerDepth(host, dismissible);
  node.dataset.v2ZDepth = String(depth);
  node.style.setProperty('--v2-z-layer-shift', `${depth * 12}px`);
  host.appendChild(node);
  app?.classList.add('has-z-layer');
  syncV2ZStackInteraction(app, host);
  const notify = () => window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  const contextObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === 'childList'
      || (mutation.type === 'attributes' && [
        'class',
        'disabled',
        'aria-label',
        'data-v2-primary-visible',
        'data-v2-primary-label',
        'data-v2-primary-variant',
      ].includes(mutation.attributeName)))) {
      notify();
    }
  });
  contextObserver.observe(node, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'class',
      'disabled',
      'aria-label',
      'data-v2-primary-visible',
      'data-v2-primary-label',
      'data-v2-primary-variant',
    ],
  });
  let disposeSwipe = () => {};
  let disposeDismissAffordance = () => {};
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    contextObserver.disconnect();
    disposeSwipe();
    disposeDismissAffordance();
    if (node.isConnected) node.remove();
    app?.classList.toggle('has-z-layer', Boolean(host.querySelector('[data-v2-z-layer]')));
    syncV2ZStackInteraction(app, host);
    notify();
  };
  const close = () => {
    if (disposed) return;
    dispose();
    onClose?.();
  };
  if (dismissible) {
    node.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-v2-z-close]')) close();
    });
    disposeDismissAffordance = bindV2ZDismissAffordance(node, { onDismiss: close });
    disposeSwipe = initV2Swipe(node, { onRight: close, revealDeck: false, threshold: 28, edgeWidth: 36 });
  } else {
    const dismiss = node.querySelector(':scope > [data-v2-z-header] > [data-v2-z-dismiss], :scope > [data-v2-q-header] > [data-v2-z-dismiss]');
    if (dismiss) dismiss.hidden = true;
  }
  node.v2Dispose = dispose;
  node.v2Close = close;
  notify();
  return node;
}
