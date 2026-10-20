import { escapeHtml } from '../utils/escape-html.js';

export function page(blocks = []) {
  return `<div class="ui-page" style="display:flex;flex-direction:column;gap:20px;min-width:0">${blocks.filter(Boolean).join('')}</div>`;
}

export function details(items = [], { variant = '' } = {}) {
  const values = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!values.length) return '';
  if (variant === 'split') {
    return `<div class="entity-details entity-details--split">${values.map(({ left = '—', right = '—' }) => `<div><strong>${escapeHtml(left === '' || left == null ? '—' : left)}</strong><strong>${escapeHtml(right === '' || right == null ? '—' : right)}</strong></div>`).join('')}</div>`;
  }
  return `<div class="entity-details">${values.map(({ label = '', value = '—' }) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value === '' || value == null ? '—' : value)}</strong></div>`).join('')}</div>`;
}

export function agreementBlock(items = []) {
  return `<section class="agreements-summary">${items.map(({ label, value, checked, data = '', aria = '', interactive = false, openData = '', toggleData = '', openAria = '', toggleAria = '' }) => {
    const isChecked = typeof checked === 'boolean' ? checked : value === true || value === 'Дано';
    const status = `<strong class="agreement-status" aria-label="${isChecked ? 'Дано' : 'Не дано'}">${isChecked ? '☑' : '□'}</strong>`;
    if (openData || toggleData) {
      return `<div class="agreement-choice"><button type="button" class="agreement-choice__document"${openData ? ` ${openData}` : ''}${openAria ? ` aria-label="${escapeHtml(openAria)}"` : ''}><span>${escapeHtml(label)}</span></button><button type="button" class="agreement-choice__toggle"${toggleData ? ` ${toggleData}` : ''}${toggleAria ? ` aria-label="${escapeHtml(toggleAria)}"` : ''}>${status}</button></div>`;
    }
    const content = `<span>${escapeHtml(label)}</span>${status}`;
    if (interactive || data) return `<button type="button"${data ? ` ${data}` : ''}${aria ? ` aria-label="${escapeHtml(aria)}"` : ''}>${content}</button>`;
    return `<div>${content}</div>`;
  }).join('')}</section>`;
}

export function actionBlock(content = '', { className = '' } = {}) {
  return `<div class="profile-actions modal-actions${className ? ` ${escapeHtml(className)}` : ''}">${content}</div>`;
}

export function sortedTableRows(rows = [], key = '', descending = false) {
  return [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? ''), 'ru', { numeric: true }) * (descending ? -1 : 1));
}

export function dataTable({ columns = [], rows = [], caption = '', sortKey = '', descending = false } = {}) {
  const values = sortKey ? sortedTableRows(rows, sortKey, descending) : rows;
  return `<div class="ui-data-table" tabindex="0" role="region" aria-label="${escapeHtml(caption)}"><table>
    <caption>${escapeHtml(caption)}</caption><thead><tr>${columns.map(c => `<th scope="col" aria-sort="${sortKey === c.key ? descending ? 'descending' : 'ascending' : 'none'}"><button type="button" data-table-sort="${escapeHtml(c.key)}">${escapeHtml(c.label)}${sortKey === c.key ? descending ? ' ↓' : ' ↑' : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${values.map(row => `<tr>${columns.map(c => `<td>${escapeHtml(row[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function bindDataTable(root, onSort) {
  root.querySelectorAll('[data-table-sort]').forEach(button => button.addEventListener('click', () => onSort(button.dataset.tableSort)));
}
