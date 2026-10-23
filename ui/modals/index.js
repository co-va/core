import { escapeHtml } from '../utils/escape-html.js';
import { mountV2Layer, v2Layer } from '../v2/index.js';
import { v2QFrame } from '../v2/z-layout.js';

let modalLevel = 0;

const MODAL_VARIANTS = new Set(['q', 'x', 's', 'technical']);
const MODAL_SURFACES = new Set(['app']);
const X_ROLES = new Set(['action', 'editor', 'picker']);
const S_INTERACTIVE_CONTENT = /<(?:button|form|input|select|textarea)\b/i;

function v2Kind(variant = '') {
  if (variant === 'x') return 'bottom';
  if (variant === 's') return 'top';
  if (variant === 'technical') return 'technical';
  return 'standard';
}

function assertInformationalS(content = '') {
  if (!S_INTERACTIVE_CONTENT.test(String(content || ''))) return;
  throw new Error('S modal is informational only; use X for actions, editors and pickers.');
}

export function modal(content, { title = '', className = '', variant = 'q', surface = '', xRole = '' } = {}) {
  const resolvedVariant = MODAL_VARIANTS.has(variant) ? variant : 'q';
  if (resolvedVariant === 's') assertInformationalS(content);
  const kind = v2Kind(resolvedVariant);
  const variantClass = `modal--${kind}`;
  const surfaceClass = MODAL_SURFACES.has(surface) ? `modal--surface-${surface}` : '';
  const classes = ['modal-sheet', className, variantClass, surfaceClass].filter(Boolean).join(' ');
  if (resolvedVariant === 'q') content = v2QFrame(content, { header: title ? `<h2 class="v2-q-title">${escapeHtml(title)}</h2>` : '' });
  let html = v2Layer(content, {
    kind,
    title: '',
    className: classes,
  });
  if (resolvedVariant === 'q') html = html.replace('data-v2-layer ', 'data-v2-layer data-v2-q="true" ');
  if (resolvedVariant === 'x') {
    const resolvedRole = X_ROLES.has(xRole) ? xRole : 'editor';
    html = html.replace('data-v2-layer ', `data-v2-layer data-v2-x-role="${resolvedRole}" `);
  }
  if (title) html = html.replace('aria-label=""', `aria-label="${escapeHtml(title)}"`);
  html = html
    .replace('class="v2-layer-backdrop"', 'class="v2-layer-backdrop modal-backdrop" data-modal')
    .replace('class="v2-layer__close"', 'class="v2-layer__close modal-close" data-modal-close');
  if (resolvedVariant === 'x' || resolvedVariant === 's') {
    html = html.replace(/<button type="button" class="v2-layer__close modal-close"[^>]*>×<\/button>/, '');
  }
  return html;
}

export function mountModal(root, html) {
  const m = mountV2Layer(html, { root });
  if (!m) return null;
  modalLevel += 1;
  m.dataset.modalLevel = String(modalLevel);
  const layerZ = String(1200 + modalLevel);
  const portal = m.parentElement?.matches?.('[data-v2-layer-portal]') ? m.parentElement : null;
  if (portal) portal.style.zIndex = layerZ;
  else m.style.zIndex = layerZ;

  const close = m.v2Close || (() => m.remove());
  const originalClose = close;
  m.v2Close = () => {
    if (!m.isConnected) return;
    originalClose();
    if (!document.querySelector('[data-modal]')) modalLevel = 0;
  };

  m.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-modal-close]')) m.v2Close?.();
  });

  requestAnimationFrame(() => {
    const explicit = m.querySelector('[data-modal-autofocus]');
    const target = explicit || m.querySelector('.modal-sheet');
    target?.focus?.({ preventScroll: true });
  });
  return m;
}

export function openNotice({ title = 'Внимание', message = '', surface = 'app' } = {}) {
  const content = `<div class="modal-title"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p></div>`;
  return mountModal(document.body, modal(content, { variant: 's', surface, title }));
}
