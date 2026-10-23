import { v2ZDismissAffordance } from './z-affordance.js';

const Z_HEADER_STYLE = [
  'position:relative',
  'z-index:20',
  'box-sizing:border-box',
  'min-height:40px',
  'margin:0 -18px',
  'padding:0 18px 8px 0',
  'display:flex',
  'flex:0 0 auto',
  'flex-direction:column',
  'background:var(--v2-white,#fff)',
].join(';');

const Z_HEADER_CONTENT_STYLE = [
  'box-sizing:border-box',
  'min-width:0',
  'padding-left:18px',
  'display:flex',
  'flex-direction:column',
  'gap:8px',
].join(';');

const Z_BODY_STYLE = [
  'min-width:0',
  'min-height:0',
  'box-sizing:border-box',
  'flex:1 1 auto',
  'overflow-y:auto',
  'overscroll-behavior:contain',
  '--v2-z-body-section-gap:20px',
].join(';');

const Z_BODY_SECTIONS_STYLE = [
  'min-width:0',
  'box-sizing:border-box',
  'display:flex',
  'flex-direction:column',
  'gap:var(--v2-z-body-section-gap,20px)',
].join(';');

const Z_BODY_SECTION_STYLE = [
  'min-width:0',
  'box-sizing:border-box',
].join(';');

const Z_BODY_KINDS = new Set(['content', 'full', 'list']);
const Z_HEADER_OWNER_BOUND = new WeakSet();

function surfaceHeader(content = '', { kind = 'z', dismiss = true } = {}) {
  const data = kind === 'q' ? 'data-v2-q-header' : 'data-v2-z-header';
  const contentData = kind === 'q' ? 'data-v2-q-header-content' : 'data-v2-z-header-content';
  return `<div ${data} style="${Z_HEADER_STYLE}">${dismiss ? v2ZDismissAffordance() : ''}<div ${contentData} style="${Z_HEADER_CONTENT_STYLE}">${content}</div></div>`;
}

function surfaceBody(content = '', { kind = 'z' } = {}) {
  const data = kind === 'q' ? 'data-v2-q-body' : 'data-v2-z-body';
  return `<div ${data} style="${Z_BODY_STYLE}">${content}</div>`;
}

export function v2ZHeader(content = '') {
  return surfaceHeader(content, { kind: 'z' });
}

export function v2ZBody(content = '') {
  return surfaceBody(content, { kind: 'z' });
}

export function v2QHeader(content = '') {
  return surfaceHeader(content, { kind: 'q' });
}

export function v2QBody(content = '') {
  return surfaceBody(content, { kind: 'q' });
}

export function v2ZBodySection(content = '', { kind = 'content' } = {}) {
  const normalizedKind = Z_BODY_KINDS.has(kind) ? kind : 'content';
  return `<section data-v2-z-body-section="${normalizedKind}" style="${Z_BODY_SECTION_STYLE}">${String(content || '')}</section>`;
}

export function v2ZBodySections(sections = []) {
  const values = (Array.isArray(sections) ? sections : [sections])
    .map((section) => section && typeof section === 'object' && !Array.isArray(section)
      ? { content: section.content ?? '', kind: section.kind ?? 'content' }
      : { content: section ?? '', kind: 'content' })
    .filter((section) => String(section.content || '').trim());
  const listIndex = values.findIndex((section) => section.kind === 'list');
  if (listIndex >= 0 && listIndex !== values.length - 1) {
    throw new Error('Z Body list section must be terminal.');
  }
  return `<div data-v2-z-body-sections style="${Z_BODY_SECTIONS_STYLE}">${values.map((section) => v2ZBodySection(section.content, { kind: section.kind })).join('')}</div>`;
}

export function v2ZFrame(content = '', { header = '', dismiss = true } = {}) {
  return `${surfaceHeader(header, { kind: 'z', dismiss })}${v2ZBody(content)}`;
}

export function v2QFrame(content = '', { header = '' } = {}) {
  return `${v2QHeader(header)}${v2QBody(content)}`;
}

function resolveZSurface(root) {
  if (!root) return null;
  if (root.matches?.('[data-v2-z],[data-v2-z-layer]')) return root;
  return root.closest?.('[data-v2-z],[data-v2-z-layer]') || null;
}

function bindV2ZHeaderOwner(root) {
  if (!root || Z_HEADER_OWNER_BOUND.has(root) || typeof root.replaceChildren !== 'function') return;
  const replaceChildren = root.replaceChildren.bind(root);
  root.replaceChildren = (...children) => {
    clearV2ZHeaderRows(root);
    return replaceChildren(...children);
  };
  Z_HEADER_OWNER_BOUND.add(root);
}

export function setV2ZHeaderRows(root, rows = []) {
  const surface = resolveZSurface(root);
  const host = surface?.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-header-content]');
  if (!host) return [];
  bindV2ZHeaderOwner(root);
  const values = (Array.isArray(rows) ? rows : [rows]).filter((row) => String(row || '').trim());
  host.innerHTML = values.map((row, index) => `<div data-v2-z-header-row="${index}" style="min-width:0">${row}</div>`).join('');
  host.querySelectorAll(':scope > [data-v2-z-header-row] > *').forEach((node) => {
    node.style.margin = '0';
  });
  return [...host.querySelectorAll(':scope > [data-v2-z-header-row]')];
}

export function clearV2ZHeaderRows(root) {
  const surface = resolveZSurface(root);
  const host = surface?.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-header-content]');
  if (host) host.replaceChildren();
}
