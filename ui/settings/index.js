import { button } from '../buttons/index.js';
import { escapeHtml } from '../utils/escape-html.js';

function text(value = '') {
  return escapeHtml(String(value ?? ''));
}

export function floatingSettingsButton({ data = 'data-floating-settings-button', aria = 'Настройки' } = {}) {
  const dataAttrs = String(data || '').trim();
  return `<button type="button" class="floating-settings-button"${dataAttrs ? ` ${dataAttrs}` : ''} aria-label="${text(aria)}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06L7.06 3.8l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 9c.13.36.34.7.6 1 .28.3.67.47 1.1.5h.1v4h-.1a1.7 1.7 0 0 0-1.7.5Z"></path></svg></button>`;
}

export function settingToggle({ label = '', checked = false, data = '', disabled = false } = {}) {
  return `<button type="button" class="app-setting-toggle${checked ? ' is-on' : ''}" ${data} aria-pressed="${checked ? 'true' : 'false'}"${disabled ? ' disabled' : ''}><span>${text(label)}</span><span class="app-setting-toggle__switch" aria-hidden="true"><span></span></span></button>`;
}

export function settingsPanel(items = []) {
  return `<div class="app-settings-panel">${(Array.isArray(items) ? items : []).filter(Boolean).map((item) => {
    if (item.type === 'toggle') return settingToggle(item);
    return button(text(item.label || ''), { className: 'app-settings-panel__button', data: item.data || '', aria: item.aria || item.label || '', variant: item.variant || '', disabled: Boolean(item.disabled) });
  }).join('')}</div>`;
}


export function notificationSettings(items = []) {
  return `<div class="app-notification-list">${(Array.isArray(items) ? items : []).filter(Boolean).map((item) => `
    <label class="app-notification-row${item.disabled ? ' is-disabled' : ''}">
      <input type="checkbox" ${item.data || ''} ${item.checked ? 'checked' : ''} ${item.disabled ? 'disabled' : ''}>
      <span><strong>${text(item.label || '')}</strong>${item.description ? `<small>${text(item.description)}</small>` : ''}</span>
    </label>`).join('')}
    <div class="muted" data-notification-status></div>
  </div>`;
}
