import { modal, mountModal } from '../modals/index.js';
import { escapeHtml } from '../utils/escape-html.js';

/**
 * Canonical page header.
 * The optional meta slot accepts already assembled shared UI, including
 * headerControl().
 */
export function pageHeader(title, subtitle = '', meta = '') {
  return `<header class="page-header"><div class="page-header__main"><h1>${escapeHtml(title)}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}</div>${meta ? `<div class="page-header__meta">${meta}</div>` : ''}</header>`;
}

function isAddAction(action) {
  if (!action) return false;
  const label = String(action.label || '').trim().toLocaleLowerCase('ru-RU');
  const data = String(action.data || '');
  return action.kind === 'add'
    || label === '+'
    || label.startsWith('добав')
    || /data-(?:[a-z0-9-]*-)?add(?:-|\b)/i.test(data);
}

/**
 * Canonical workspace Header context.
 * A is photo metadata only. V is the independent floating section action.
 * C accepts add actions only; D remains the Messenger entry/action.
 */
export function workspaceHeaderContext({ title = '', a = null, v = null, c = null, d = null } = {}) {
  const cData = c?.data ? ` ${String(c.data).trim()}` : '';
  const dData = d?.data ? ` ${String(d.data).trim()}` : '';
  const vData = v?.data ? ` ${String(v.data).trim()}` : '';
  const cDisabled = c?.disabled ? ' disabled' : '';
  const vDisabled = v?.disabled ? ' disabled' : '';
  const aContext = a ? `<span hidden data-workspace-a-context data-workspace-a-label="${escapeHtml(a.label || '')}" data-workspace-a-image="${escapeHtml(a.image || '')}" data-workspace-a-image-position="${escapeHtml(a.imagePosition || '')}" data-workspace-a-initials="${escapeHtml(a.initials || '')}"></span>` : '';
  const vAction = v ? `<button type="button" class="workspace-header-context__v-action" data-workspace-v-action${vData} aria-label="${escapeHtml(v.aria || v.label || 'Действия раздела')}"${vDisabled}></button>` : '';
  const cAction = isAddAction(c) ? `<button type="button" class="workspace-header-context__c-action" data-v2-primary-action data-v2-primary-label="+" data-workspace-c-kind="add"${cData} aria-label="${escapeHtml(c?.aria || c?.label || 'Добавить')}"${cDisabled}></button>` : '';
  const dAction = d ? `<button type="button" class="workspace-header-context__d-action" data-workspace-d-action${dData} data-workspace-d-kind="${escapeHtml(d.kind || 'chat')}" aria-label="${escapeHtml(d.aria || 'Действие справа')}"></button>` : '';
  return `<div class="workspace-header-context" data-workspace-header-context data-workspace-title="${escapeHtml(title)}">${aContext}${vAction}${cAction}${dAction}</div>`;
}

/**
 * Canonical clickable control placed inside page headers.
 * It owns only the stable Header Control shell and knows nothing about the
 * UI content rendered inside it.
 */
export function headerControl(content = '', { data = '', aria = '', className = '', indicator = '⌄' } = {}) {
  const classes = ['header-control', className].filter(Boolean).map(escapeHtml).join(' ');
  const dataAttrs = data ? ` ${data}` : '';
  const ariaAttr = aria ? ` aria-label="${escapeHtml(aria)}"` : '';
  const indicatorMarkup = indicator === '' ? '' : `<span class="header-control__indicator" aria-hidden="true">${escapeHtml(indicator)}</span>`;
  return `<button type="button" class="${classes}" data-header-control${dataAttrs}${ariaAttr}><span class="header-control__content">${content}</span>${indicatorMarkup}</button>`;
}

/**
 * Canonical compact two-or-more option toggle for page headers.
 */
export function headerToggle({ items = [], activeId = '', data = 'data-header-toggle' } = {}) {
  const buttons = (Array.isArray(items) ? items : []).map((item) => {
    const id = String(item?.id || '');
    const active = id === String(activeId || '');
    return `<button type="button" class="header-toggle__item${active ? ' is-active' : ''}" ${data}="${escapeHtml(id)}" aria-pressed="${active}">${escapeHtml(item?.label || id)}</button>`;
  }).join('');
  return `<div class="header-toggle" role="group">${buttons}</div>`;
}

/**
 * Canonical grouping for more than one header control block.
 */
export function headerControlGroup(items = []) {
  return `<div class="header-control-group">${(Array.isArray(items) ? items : []).filter(Boolean).join('')}</div>`;
}

/**
 * Canonical manifestation of Header Control.
 * Every Header Control opens the same canonical bottom action shell; the caller only
 * supplies the UI content placed inside that shell.
 */
export function openHeaderControl(content = '', { title = '', className = '' } = {}) {
  return mountModal(document.body, modal(String(content || ''), {
    title,
    className,
    variant: 'x',
  }));
}
