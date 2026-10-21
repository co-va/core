export function v2ModalPortalGeometry(hostRect = {}, viewport = {}) {
  const viewportLeft = Number(viewport.offsetLeft ?? 0);
  const viewportTop = Number(viewport.offsetTop ?? 0);
  const viewportWidth = Math.max(0, Number(viewport.width ?? 0));
  const viewportHeight = Math.max(0, Number(viewport.height ?? 0));
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;

  const hostLeft = Number(hostRect.left ?? viewportLeft);
  const hostTop = Number(hostRect.top ?? viewportTop);
  const hostWidth = Math.max(0, Number(hostRect.width ?? 0));
  const hostRight = Number(hostRect.right ?? (hostLeft + hostWidth));

  const left = Math.max(viewportLeft, hostLeft);
  const right = Math.min(viewportRight, hostRight);
  const top = Math.max(viewportTop, hostTop);
  const width = Math.max(0, right - left);
  const height = Math.max(0, viewportBottom - top);

  return { left, top, width, height, bottom: top + height };
}

export function v2QModalPortalGeometry(hostRect = {}, viewport = {}, {
  hostIsZ = false,
  edge = 16,
  headerHeight = 72,
} = {}) {
  const base = v2ModalPortalGeometry(hostRect, viewport);
  if (hostIsZ) return base;

  const safeEdge = Math.max(0, Number(edge) || 0);
  const safeHeaderHeight = Math.max(0, Number(headerHeight) || 0);
  const viewportTop = Number(viewport.offsetTop ?? 0);
  const right = base.left + base.width;
  const left = Math.min(right, base.left + safeEdge);
  const top = Math.min(base.bottom, Math.max(base.top, viewportTop + safeHeaderHeight));

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, base.bottom - top),
    bottom: base.bottom,
  };
}

function cssPixelValue(name) {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function currentVisualViewport() {
  const vv = window.visualViewport;
  const stableHeight = cssPixelValue('--app-stable-vh');
  const stableWidth = cssPixelValue('--app-stable-vw');
  return {
    offsetLeft: Number(vv?.offsetLeft ?? 0),
    offsetTop: Number(vv?.offsetTop ?? 0),
    width: Number(vv?.width || stableWidth || window.innerWidth || 0),
    height: Number(vv?.height || stableHeight || window.innerHeight || 0),
  };
}
