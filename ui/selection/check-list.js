import { escapeHtml } from '../utils/escape-html.js';

export function checkList(items = [], { className = '' } = {}) {
  const values = Array.isArray(items) ? items : [];
  return `<div class="ui-check-list${className ? ` ${escapeHtml(className)}` : ''}" data-check-list>${values.map((item = {}) => {
    const value = String(item.value ?? item.id ?? '');
    const label = String(item.label ?? item.title ?? value);
    const secondary = String(item.secondary ?? '');
    const checked = Boolean(item.checked);
    return `<label class="ui-check-list__item${checked ? ' is-checked' : ''}">
      <input type="checkbox" value="${escapeHtml(value)}"${checked ? ' checked' : ''}${item.data ? ` ${item.data}` : ''}>
      <span class="ui-check-list__mark" aria-hidden="true">${checked ? '✓' : ''}</span>
      <span class="ui-check-list__text"><strong>${escapeHtml(label)}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}</span>
    </label>`;
  }).join('')}</div>`;
}

export function compactCheck({ label = '', checked = false, data = '', aria = '', disabled = false } = {}) {
  return `<label class="ui-compact-check${disabled ? ' is-disabled' : ''}">
    <input type="checkbox"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}${data ? ` ${data}` : ''}${aria || label ? ` aria-label="${escapeHtml(aria || label)}"` : ''}>
    <span class="ui-compact-check__mark" aria-hidden="true"></span>
    <span class="ui-compact-check__label">${escapeHtml(label)}</span>
  </label>`;
}

export function collectCheckList(root, selector = '.ui-check-list input[type="checkbox"]') {
  return [...root.querySelectorAll(selector)].filter((input) => input.checked).map((input) => input.value).filter(Boolean);
}

export function initCheckList(root) {
  const sync = (input) => {
    const row = input.closest('.ui-check-list__item');
    row?.classList.toggle('is-checked', input.checked);
    const mark = row?.querySelector('.ui-check-list__mark');
    if (mark) mark.textContent = input.checked ? '✓' : '';
  };
  root.querySelectorAll('.ui-check-list input[type="checkbox"]').forEach((input) => {
    sync(input);
    input.addEventListener('change', () => sync(input));
  });
}
