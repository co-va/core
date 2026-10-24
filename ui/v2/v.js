import { text, dataAttributes } from './html.js';

export function v2V({ data = '', aria = 'Действия раздела', hidden = false } = {}) {
  if (hidden) return '';
  return `<button type="button" class="v2-v" data-v2-v${dataAttributes(data)} aria-label="${text(aria)}">
    <svg class="v2-v__medallion" viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="v2-v-glass" x1="8" y1="4" x2="30" y2="35" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#353535" stop-opacity=".78"></stop>
          <stop offset=".42" stop-color="#111111" stop-opacity=".86"></stop>
          <stop offset="1" stop-color="#000000" stop-opacity=".94"></stop>
        </linearGradient>
        <radialGradient id="v2-v-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(22 27) rotate(-90) scale(17 16)">
          <stop offset="0" stop-color="#FFFF00" stop-opacity=".58"></stop>
          <stop offset=".45" stop-color="#FFFF00" stop-opacity=".18"></stop>
          <stop offset="1" stop-color="#FFFF00" stop-opacity="0"></stop>
        </radialGradient>
        <linearGradient id="v2-v-edge" x1="8" y1="5" x2="31" y2="33" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#5A5A5A" stop-opacity=".9"></stop>
          <stop offset=".42" stop-color="#FFFF00" stop-opacity=".72"></stop>
          <stop offset="1" stop-color="#8A7600" stop-opacity=".42"></stop>
        </linearGradient>
      </defs>
      <path d="M10 4.7C6.8 4.7 4.7 7.9 6.3 10.7L17.4 31.8C18.6 34.1 21.4 34.1 22.6 31.8L33.7 10.7C35.3 7.9 33.2 4.7 30 4.7H10Z" fill="url(#v2-v-glass)" stroke="url(#v2-v-edge)" stroke-width="1"></path>
      <path d="M10 4.7C6.8 4.7 4.7 7.9 6.3 10.7L17.4 31.8C18.6 34.1 21.4 34.1 22.6 31.8L33.7 10.7C35.3 7.9 33.2 4.7 30 4.7H10Z" fill="url(#v2-v-glow)"></path>
      <path d="M8.7 9.1C9.4 7.9 10.5 7.3 12 7.3H28.1" fill="none" stroke="#FFFF00" stroke-opacity=".26" stroke-width=".75" stroke-linecap="round"></path>
      <path d="M17.8 30.1C18.8 32 21.2 32 22.2 30.1" fill="none" stroke="#FFFF00" stroke-opacity=".2" stroke-width=".7" stroke-linecap="round"></path>
    </svg>
  </button>`;
}
