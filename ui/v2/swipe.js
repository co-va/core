import { retainV2EdgeHost } from './lifecycle.js';

export function initV2Swipe(root, {
  onRight = null,
  onLeft = null,
  threshold = 28,
  maxDrag = 180,
  revealDeck = true,
  edgeWidth = 36,
} = {}) {
  const surface = root?.matches?.('[data-v2-z], [data-v2-z-layer]')
    ? root
    : root?.querySelector?.('[data-v2-z], [data-v2-z-layer]');
  if (!surface) return () => {};
  const app = surface.closest?.('[data-v2-app]');
  const stage = app?.querySelector?.('.v2-app__stage') || surface.parentElement;
  const isLayer = surface.matches?.('[data-v2-z-layer]');
  const isBaseZ = surface.matches?.('[data-v2-z]') && !isLayer;
  const front = app?.querySelector?.('[data-v2-front]');
  const dragSurface = isBaseZ && front ? front : surface;
  const dragProperty = isBaseZ && front ? '--v2-front-drag-x' : '--v2-drag-x';
  const hasDeck = revealDeck && isBaseZ && Boolean(app?.querySelector?.('[data-v2-card-deck][data-v2-deck-level="f"]'));
  const edgeHost = onRight ? app?.querySelector?.('[data-v2-edge-swipe]') : null;
  const gestureHost = edgeHost || stage || surface;
  const releaseEdgeHost = retainV2EdgeHost(edgeHost);
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let axis = 'pending';
  let suppressNextClick = false;

  const isTopmost = () => {
    const layers = [...(app?.querySelectorAll?.('[data-v2-z-layer]') || [])];
    if (isLayer) return layers.at(-1) === surface;
    return layers.length === 0;
  };

  const clear = () => {
    dragSurface.style.removeProperty(dragProperty);
    dragSurface.classList.remove('is-dragging');
    app?.classList.remove('is-revealing-deck');
    pointerId = null;
    dx = 0;
    axis = 'pending';
  };

  const down = (event) => {
    if (app?.classList.contains('has-v2-modal')) return;
    if (!isTopmost()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const stageRect = stage?.getBoundingClientRect?.() || surface.getBoundingClientRect?.();
    const leftEdge = Number(stageRect?.left || 0) + Number(edgeWidth || 36);
    const rightEdge = Number(stageRect?.right || 0) - Number(edgeWidth || 36);
    const wantsRight = Boolean(onRight) && (Boolean(edgeHost) || Number(event.clientX || 0) <= leftEdge);
    const wantsLeft = Boolean(onLeft) && !edgeHost && Number(event.clientX || 0) >= rightEdge;
    if (!wantsRight && !wantsLeft) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    axis = 'pending';
    suppressNextClick = false;
  };

  const move = (event) => {
    if (event.pointerId !== pointerId) return;
    const nextX = event.clientX - startX;
    const nextY = event.clientY - startY;
    if (axis === 'pending') {
      if (Math.max(Math.abs(nextX), Math.abs(nextY)) < 4) return;
      const horizontal = Math.abs(nextX) >= Math.abs(nextY) * .72;
      const allowedDirection = (nextX > 0 && onRight) || (nextX < 0 && onLeft);
      if (!horizontal || !allowedDirection) {
        clear();
        return;
      }
      axis = 'horizontal';
      gestureHost.setPointerCapture?.(event.pointerId);
    }
    const allowedX = nextX > 0 ? (onRight ? nextX : 0) : (onLeft ? nextX : 0);
    dx = Math.max(-maxDrag, Math.min(maxDrag, allowedX));
    if (hasDeck && dx > 0 && onRight && !app?.classList.contains('is-deck-open')) {
      app?.classList.add('is-revealing-deck');
    }
    dragSurface.classList.add('is-dragging');
    dragSurface.style.setProperty(dragProperty, `${dx}px`);
    if (Math.abs(nextX) > 7) suppressNextClick = true;
    event.preventDefault();
  };

  const up = (event) => {
    if (event.pointerId !== pointerId) return;
    const finalDx = dx;
    const finalAxis = axis;
    try {
      if (gestureHost.hasPointerCapture?.(event.pointerId)) gestureHost.releasePointerCapture?.(event.pointerId);
    } catch {}
    clear();
    if (finalAxis !== 'horizontal') return;
    if (finalDx >= threshold) onRight?.();
    else if (finalDx <= -threshold) onLeft?.();
  };

  const click = (event) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  };

  gestureHost.addEventListener('pointerdown', down);
  gestureHost.addEventListener('pointermove', move, { passive: false });
  gestureHost.addEventListener('pointerup', up);
  gestureHost.addEventListener('pointercancel', clear);
  gestureHost.addEventListener('click', click, true);
  return () => {
    gestureHost.removeEventListener('pointerdown', down);
    gestureHost.removeEventListener('pointermove', move);
    gestureHost.removeEventListener('pointerup', up);
    gestureHost.removeEventListener('pointercancel', clear);
    gestureHost.removeEventListener('click', click, true);
    releaseEdgeHost();
  };
}

export function initV2StickerSwipe(root, { onRight = null, onLeft = null, threshold = 64, maxDrag = 180 } = {}) {
  const surface = root?.matches?.('[data-v2-sticker]') ? root : root?.querySelector?.('[data-v2-sticker]');
  if (!surface) return () => {};
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let axis = 'pending';

  const reset = () => {
    surface.style.removeProperty('--v2-sticker-drag-x');
    surface.classList.remove('is-dragging');
    pointerId = null;
    dx = 0;
    axis = 'pending';
  };
  const down = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dx = 0;
    axis = 'pending';
  };
  const move = (event) => {
    if (event.pointerId !== pointerId) return;
    const nextX = event.clientX - startX;
    const nextY = event.clientY - startY;
    if (axis === 'pending') {
      if (Math.max(Math.abs(nextX), Math.abs(nextY)) < 12) return;
      axis = Math.abs(nextX) > Math.abs(nextY) * 1.25 ? 'horizontal' : 'vertical';
      if (axis === 'vertical') {
        pointerId = null;
        return;
      }
      surface.setPointerCapture?.(event.pointerId);
    }
    if (axis !== 'horizontal') return;
    const allowedX = nextX > 0 ? (onRight ? nextX : 0) : (onLeft ? nextX : 0);
    dx = Math.max(-maxDrag, Math.min(maxDrag, allowedX));
    if (dx !== 0) {
      surface.classList.add('is-dragging');
      surface.style.setProperty('--v2-sticker-drag-x', `${dx}px`);
    }
    event.preventDefault();
  };
  const up = (event) => {
    if (event.pointerId !== pointerId) return;
    const finalDx = dx;
    try {
      if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture?.(event.pointerId);
    } catch {}
    reset();
    if (finalDx >= threshold) onRight?.();
    else if (finalDx <= -threshold) onLeft?.();
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointermove', move, { passive: false });
  surface.addEventListener('pointerup', up);
  surface.addEventListener('pointercancel', reset);
  return () => {
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('pointermove', move);
    surface.removeEventListener('pointerup', up);
    surface.removeEventListener('pointercancel', reset);
  };
}


export function initV2LayerDismissGesture(node, {
  kind = 'standard',
  onBeforeDismiss = null,
  onDismiss = null,
  threshold = 64,
  maxDrag = 180,
} = {}) {
  if (!node || kind === 'technical') return () => {};
  const sheet = node.querySelector('.v2-layer');
  if (!sheet) return () => {};
  const vertical = kind === 'top' || kind === 'bottom';
  const target = vertical ? sheet.querySelector('[data-v2-layer-gesture-zone]') : sheet;
  if (!target) return () => {};

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let delta = 0;
  let axis = 'pending';
  let dismissing = false;

  const reset = () => {
    sheet.classList.remove('is-dragging');
    sheet.style.removeProperty('--v2-layer-drag-x');
    sheet.style.removeProperty('--v2-layer-drag-y');
    pointerId = null;
    delta = 0;
    axis = 'pending';
  };

  const down = (event) => {
    if (dismissing) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (!vertical && event.target.closest?.('input,select,textarea,[contenteditable="true"],[data-v2-layer-gesture-ignore]')) return;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    delta = 0;
    axis = 'pending';
  };

  const move = (event) => {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (axis === 'pending') {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return;
      axis = vertical
        ? (Math.abs(dy) >= Math.abs(dx) * 1.08 ? 'vertical' : 'horizontal')
        : (Math.abs(dx) >= Math.abs(dy) * 1.08 ? 'horizontal' : 'vertical');
      if ((vertical && axis !== 'vertical') || (!vertical && axis !== 'horizontal')) {
        pointerId = null;
        return;
      }
      target.setPointerCapture?.(event.pointerId);
    }
    const raw = vertical ? dy : dx;
    const allowed = kind === 'top' ? Math.min(0, raw) : Math.max(0, raw);
    delta = Math.max(-maxDrag, Math.min(maxDrag, allowed));
    if (delta === 0) return;
    sheet.classList.add('is-dragging');
    sheet.style.setProperty(vertical ? '--v2-layer-drag-y' : '--v2-layer-drag-x', `${delta}px`);
    event.preventDefault();
    event.stopPropagation();
  };

  const up = (event) => {
    if (event.pointerId !== pointerId) return;
    target.releasePointerCapture?.(event.pointerId);
    const passed = kind === 'top' ? delta <= -threshold : delta >= threshold;
    pointerId = null;
    if (!passed) {
      reset();
      return;
    }
    if (onBeforeDismiss?.() === false) {
      reset();
      return;
    }
    dismissing = true;
    sheet.classList.remove('is-dragging');
    sheet.classList.add('is-dismissing');
    sheet.style.setProperty(vertical ? '--v2-layer-drag-y' : '--v2-layer-drag-x', kind === 'top' ? '-110%' : '110%');
    window.setTimeout(() => onDismiss?.(), 150);
  };

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move, { passive: false });
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', reset);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', reset);
  };
}
