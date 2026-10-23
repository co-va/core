import { text, dataAttributes } from './html.js';

export function v2V({ data = '', aria = 'Действия раздела', hidden = false } = {}) {
  if (hidden) return '';
  return `<button type="button" class="v2-v" data-v2-v${dataAttributes(data)} aria-label="${text(aria)}">
    <svg class="v2-v__medallion" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M10 4.7C6.8 4.7 4.7 7.9 6.3 10.7L17.4 31.8C18.6 34.1 21.4 34.1 22.6 31.8L33.7 10.7C35.3 7.9 33.2 4.7 30 4.7H10Z" fill="#111111" stroke="#FFFF00" stroke-width="1.4"></path>
      <circle cx="20" cy="16" r="3.2" fill="#FFFF00"></circle>
    </svg>
  </button>`;
}
