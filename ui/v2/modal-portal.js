import { text } from './html.js';
import { v2ModalPortalGeometry, v2QModalPortalGeometry, currentVisualViewport } from './geometry.js';
import {
  activeV2ModalSurface,
  lockV2ModalSurface,
  unlockV2ModalSurface,
  lockV2StageInteraction,
  unlockV2StageInteraction,
} from './lifecycle.js';
import { initV2LayerDismissGesture } from './swipe.js';

export function v2Layer(content = '', { kind = 'standard', title = '', className = '' } = {}) {
  const allowed = new Set(['top', 'standard', 'bottom', 'technical']);
  const resolved = allowed.has(kind) ? kind : 'standard';
  const closeControl = resolved === 'technical'
    ? '<button type="button" class="v2-layer__close" data-v2-layer-close aria-label="Закрыть">×</button>'
    : '';
  const gestureZone = resolved === 'top' || resolved === 'bottom'
    ? `<span class="v2-layer__gesture-zone v2-layer__gesture-zone--${resolved}" data-v2-layer-gesture-zone aria-hidden="true"></span>`
    : '';
  return `<div class="v2-layer-backdrop" data-v2-layer data-v2-layer-kind="${resolved}"><section class="v2-layer v2-layer--${resolved} ${text(className)}" role="dialog" aria-modal="true" aria-label="${text(title)}" tabindex="-1">${closeControl}${gestureZone}${title ? `<header class="v2-layer__header"><h2>${text(title)}</h2></header>` : ''}${content}</section></div>`;
}

function mountV2ModalPortal(host, app = null) {
  if (!host) return null;

  const portal = document.createElement('div');
  portal.className = 'v2-layer-portal v2-layer-portal--viewport';
  portal.dataset.v2LayerPortal = '';
  document.body.appendChild(portal);
  let qLayer = false;

  const sync = () => {
    if (!portal.isConnected || !host.isConnected) return;
    const viewport = currentVisualViewport();
    const standardGeometry = v2ModalPortalGeometry(host.getBoundingClientRect(), viewport);
    let geometry = standardGeometry;
    if (qLayer && app) {
      const appRect = app.getBoundingClientRect();
      geometry = { left: appRect.left, top: appRect.top, width: appRect.width, height: appRect.height, bottom: appRect.bottom };
      const headerBottom = app.querySelector?.('[data-v2-header]')?.getBoundingClientRect?.().bottom;
      const qGeometry = v2QModalPortalGeometry(appRect, {
        offsetLeft: appRect.left,
        offsetTop: appRect.top,
        width: appRect.width,
        height: appRect.height,
      }, { headerBottom });
      portal.style.setProperty('--v2-q-top', `${Math.max(0, qGeometry.top - geometry.top)}px`);
      portal.style.setProperty('--v2-q-left', `${Math.max(0, qGeometry.left - geometry.left)}px`);
    } else {
      portal.style.removeProperty('--v2-q-top');
      portal.style.removeProperty('--v2-q-left');
    }
    portal.style.left = `${geometry.left}px`;
    portal.style.top = `${geometry.top}px`;
    portal.style.width = `${geometry.width}px`;
    portal.style.height = `${geometry.height}px`;
  };

  let settleTimers = [];
  const settle = () => {
    sync();
    requestAnimationFrame(sync);
    requestAnimationFrame(() => requestAnimationFrame(sync));
    settleTimers.forEach((timer) => window.clearTimeout(timer));
    settleTimers = [
      window.setTimeout(sync, 80),
      window.setTimeout(sync, 180),
      window.setTimeout(sync, 360),
    ];
  };

  settle();

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
  resizeObserver?.observe(host);
  window.addEventListener('resize', settle);
  window.visualViewport?.addEventListener('resize', settle);
  window.visualViewport?.addEventListener('scroll', settle);
  document.addEventListener('focusin', settle, true);
  document.addEventListener('focusout', settle, true);

  return {
    portal,
    sync: settle,
    setQLayer(value) {
      qLayer = Boolean(value);
      portal.classList.toggle('is-q', qLayer);
      settle();
    },
    dispose() {
      resizeObserver?.disconnect();
      settleTimers.forEach((timer) => window.clearTimeout(timer));
      settleTimers = [];
      window.removeEventListener('resize', settle);
      window.visualViewport?.removeEventListener('resize', settle);
      window.visualViewport?.removeEventListener('scroll', settle);
      document.removeEventListener('focusin', settle, true);
      document.removeEventListener('focusout', settle, true);
      if (portal.isConnected) portal.remove();
    },
  };
}

const modalHeaderLocks = new WeakMap();

function retainModalHeaderTarget(target) {
  if (!target) return () => {};
  const next = (modalHeaderLocks.get(target) || 0) + 1;
  modalHeaderLocks.set(target, next);
  target.classList.add('is-modal-locked');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = Math.max(0, (modalHeaderLocks.get(target) || 1) - 1);
    if (count) modalHeaderLocks.set(target, count);
    else {
      modalHeaderLocks.delete(target);
      target.classList.remove('is-modal-locked');
    }
  };
}

function lockModalHeader(app) {
  const header = app?.querySelector?.('[data-v2-header]');
  if (!header) return () => {};
  header.inert = true;
  const release = retainModalHeaderTarget(header);
  return () => {
    release();
    if (!modalHeaderLocks.has(header)) header.inert = false;
  };
}

function applicationLayers() {
  return [...document.querySelectorAll('[data-v2-layer]:not([data-v2-layer-kind="technical"])')];
}

function qLayerKey(layer) {
  if (layer?.dataset?.v2Q !== 'true') return '';
  const explicit = String(layer.dataset.v2QKey || '').trim();
  if (explicit) return explicit;
  return String(layer.querySelector(':scope > .v2-layer')?.getAttribute('aria-label') || '').trim();
}

function applicationLayerKey(layer) {
  if (!layer) return '';
  const explicit = String(layer.dataset.v2LayerKey || '').trim();
  if (explicit) return explicit;
  if (layer.dataset.v2Q === 'true') {
    const key = qLayerKey(layer);
    return key ? `q:${key}` : '';
  }
  const kind = String(layer.dataset.v2LayerKind || '').trim();
  const label = String(layer.querySelector(':scope > .v2-layer')?.getAttribute('aria-label') || '').trim();
  if (kind === 'bottom') return label ? `${kind}:${xLayerRole(layer)}:${label}` : '';
  return label ? `${kind}:${label}` : '';
}

function xLayerRole(layer) {
  if (layer?.dataset?.v2LayerKind !== 'bottom') return '';
  const role = String(layer.dataset.v2XRole || '').trim();
  return role === 'action' || role === 'picker' ? role : 'editor';
}

function canOpenApplicationModal(node) {
  const key = applicationLayerKey(node);
  if (!key) return true;
  return !applicationLayers().some((layer) => applicationLayerKey(layer) === key);
}

function applyXTransitionPolicy(node) {
  if (node?.dataset?.v2LayerKind !== 'bottom') return;
  const parent = applicationLayers().at(-1);
  if (parent?.dataset?.v2LayerKind !== 'bottom') return;
  if (xLayerRole(parent) === 'action') parent.v2Close?.();
}

export function mountV2Layer(html, { root = null } = {}) {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  const node = template.content.firstElementChild;
  if (!node?.matches('[data-v2-layer]')) return null;
  const kind = node.dataset.v2LayerKind || 'standard';
  const technical = kind === 'technical';
  const qLayer = node.dataset.v2Q === 'true';

  if (!technical && !canOpenApplicationModal(node)) return null;

  const host = technical ? document.body : activeV2ModalSurface(root);
  if (!host) return null;
  if (!technical) applyXTransitionPolicy(node);
  const app = technical ? null : host.closest?.('[data-v2-app]');
  const lockedStage = technical ? null : lockV2StageInteraction(app);
  const releaseHeaderLock = technical ? () => {} : lockModalHeader(app);
  const portalOwner = technical ? null : mountV2ModalPortal(host, app);
  portalOwner?.setQLayer?.(qLayer);
  const mountHost = portalOwner?.portal || host;
  node.classList.add(technical ? 'v2-layer-backdrop--technical' : 'v2-layer-backdrop--contained');
  if (!technical && host.matches?.('[data-v2-z], [data-v2-z-layer]')) lockV2ModalSurface(host);
  mountHost.appendChild(node);
  node.v2Portal = portalOwner?.portal || null;
  if (qLayer) {
    app?.classList.add('has-v2-q-modal');
    window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  }

  let disposeGesture = () => {};
  let veilDismissTimer = 0;
  let veilDismissing = false;
  let veilPointerId = null;
  let veilPointerX = 0;
  let veilPointerY = 0;
  let veilPointerMoved = false;
  const stopPointerPropagation = (event) => event.stopPropagation();
  ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach((type) => {
    node.addEventListener(type, stopPointerPropagation);
  });

  const nativeRemove = node.remove.bind(node);
  let closed = false;

  const isTopApplicationLayer = () => technical || applicationLayers().at(-1) === node;

  const eventIsOwnedByModal = (event) => {
    const foreignLayer = event.target.closest?.('[data-v2-layer]');
    if (foreignLayer && foreignLayer !== node) return true;
    const sheet = node.querySelector(':scope > .v2-layer');
    if (sheet?.contains(event.target)) return true;
    return false;
  };

  const resetVeilPointer = () => {
    veilPointerId = null;
    veilPointerX = 0;
    veilPointerY = 0;
    veilPointerMoved = false;
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (veilDismissTimer) window.clearTimeout(veilDismissTimer);
    veilDismissTimer = 0;
    resetVeilPointer();
    document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    document.removeEventListener('pointermove', handleOutsidePointerMove, true);
    document.removeEventListener('pointerup', handleOutsidePointerUp, true);
    document.removeEventListener('pointercancel', handleOutsidePointerCancel, true);
    document.removeEventListener('click', handleOutsideClick, true);
    disposeGesture();
    if (node.isConnected) nativeRemove();
    portalOwner?.dispose();
    if (!technical && host.matches?.('[data-v2-z], [data-v2-z-layer]')) unlockV2ModalSurface(host);
    if (!technical) unlockV2StageInteraction(app, lockedStage);
    const anotherQ = qLayer && applicationLayers().some((layer) => layer.dataset.v2Q === 'true');
    releaseHeaderLock();
    if (qLayer && !anotherQ) app?.classList.remove('has-v2-q-modal');
    if (qLayer) window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  };

  const dismissThroughVeil = () => {
    if (closed || veilDismissing) return;
    const sheet = node.querySelector(':scope > .v2-layer');
    if (!sheet) {
      close();
      return;
    }
    veilDismissing = true;
    sheet.classList.remove('is-dragging');
    sheet.classList.add('is-dismissing');
    if (kind === 'top') sheet.style.setProperty('--v2-layer-drag-y', '-110%');
    else if (kind === 'bottom') sheet.style.setProperty('--v2-layer-drag-y', '110%');
    else sheet.style.setProperty('--v2-layer-drag-x', '110%');
    veilDismissTimer = window.setTimeout(close, 150);
  };

  const handleOutsidePointerDown = (event) => {
    if (closed || technical || !isTopApplicationLayer() || eventIsOwnedByModal(event)) return;
    veilPointerId = event.pointerId;
    veilPointerX = event.clientX;
    veilPointerY = event.clientY;
    veilPointerMoved = false;
    // The veil owns the complete pointer sequence. The modal remains mounted and
    // the underlying stage remains inert until pointerup/click have been consumed.
    event.stopImmediatePropagation();
  };

  const handleOutsidePointerMove = (event) => {
    if (closed || technical || veilPointerId == null || event.pointerId !== veilPointerId) return;
    const dx = event.clientX - veilPointerX;
    const dy = event.clientY - veilPointerY;
    if ((dx * dx) + (dy * dy) > 100) veilPointerMoved = true;
    event.stopImmediatePropagation();
  };

  const handleOutsidePointerUp = (event) => {
    if (closed || technical || veilPointerId == null || event.pointerId !== veilPointerId) return;
    const shouldDismiss = !veilPointerMoved;
    resetVeilPointer();
    event.preventDefault();
    event.stopImmediatePropagation();
    if (shouldDismiss) dismissThroughVeil();
  };

  const handleOutsidePointerCancel = (event) => {
    if (closed || technical || veilPointerId == null || event.pointerId !== veilPointerId) return;
    resetVeilPointer();
    event.stopImmediatePropagation();
  };

  const handleOutsideClick = (event) => {
    if (closed || technical || !isTopApplicationLayer() || eventIsOwnedByModal(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    dismissThroughVeil();
  };

  const requestBack = () => qLayer && typeof node.v2Back === 'function' && node.v2Back() === true;

  node.v2Close = close;
  node.remove = close;
  document.addEventListener('pointerdown', handleOutsidePointerDown, true);
  document.addEventListener('pointermove', handleOutsidePointerMove, true);
  document.addEventListener('pointerup', handleOutsidePointerUp, true);
  document.addEventListener('pointercancel', handleOutsidePointerCancel, true);
  document.addEventListener('click', handleOutsideClick, true);
  disposeGesture = initV2LayerDismissGesture(node, {
    kind,
    onBeforeDismiss: () => !requestBack(),
    onDismiss: () => node.v2Close?.(),
  });
  node.addEventListener('click', (event) => {
    if (event.target.closest('[data-v2-layer-close]')) node.v2Close?.();
    if (qLayer && event.target.closest('[data-v2-z-dismiss]') && !requestBack()) node.v2Close?.();
  });
  return node;
}
