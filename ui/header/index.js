import { button } from '../buttons/index.js';
import { modal, mountModal } from '../modals/index.js';
import { actionBlock } from '../page/page.js';
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
 * It supplies A/B/D metadata to the shared workspace shell without drawing a
 * second visible header inside Z. C is reserved for add-only actions. Legacy
 * completion actions supplied through c are rendered by the existing shared
 * bottom action owner inside the current Z/Q instead of being promoted to C.
 */
export function workspaceHeaderContext({ title = '', a = null, c = null, d = null } = {}) {
  const actionData = a?.data ? ` ${String(a.data).trim()}` : '';
  const cData = c?.data ? ` ${String(c.data).trim()}` : '';
  const dData = d?.data ? ` ${String(d.data).trim()}` : '';
  const actionDisabled = a?.disabled ? ' disabled' : '';
  const cDisabled = c?.disabled ? ' disabled' : '';
  const action = a ? `<button type="button" class="workspace-header-context__action" data-workspace-context-action${actionData} data-workspace-a-kind="${escapeHtml(a.kind || 'settings')}" data-workspace-a-label="${escapeHtml(a.label || '')}" data-workspace-a-image="${escapeHtml(a.image || '')}" data-workspace-a-image-position="${escapeHtml(a.imagePosition || '')}" data-workspace-a-initials="${escapeHtml(a.initials || '')}" data-workspace-a-settings-tag="${a.settingsTag ? 'true' : 'false'}" aria-label="${escapeHtml(a.aria || 'Настройки контекста')}"${actionDisabled}></button>` : '';
  const cIsAdd = isAddAction(c);
  const cAction = cIsAdd ? `<button type="button" class="workspace-header-context__c-action" data-v2-primary-action data-v2-primary-label="+" data-workspace-c-kind="add"${cData} aria-label="${escapeHtml(c?.aria || c?.label || 'Добавить')}"${cDisabled}></button>` : '';
  const dAction = d ? `<button type="button" class="workspace-header-context__d-action" data-workspace-d-action${dData} data-workspace-d-kind="${escapeHtml(d.kind || 'chat')}" aria-label="${escapeHtml(d.aria || 'Действие справа')}"></button>` : '';
  const bottomAction = c && !cIsAdd
    ? actionBlock(button(c.label || '', {
        data: String(c.data || ''),
        aria: c.aria || c.label || 'Действие',
        variant: c.variant || '',
        disabled: Boolean(c.disabled),
      }))
    : '';
  return `<div class="workspace-header-context" data-workspace-header-context data-workspace-title="${escapeHtml(title)}">${action}${cAction}${dAction}</div>${bottomAction}`;
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
