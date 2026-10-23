import { text, dataAttributes } from './html.js';

function defaultChatBadge() {
  if (typeof globalThis === 'undefined') return 0;
  const value = Number(globalThis.__VA_TOOLS_ACCOUNT_UNREAD__?.total || 0);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function avatarControl(slot = {}) {
  if (!slot || slot.hidden) return '';
  const label = text(slot.label || '');
  const image = String(slot.image || '').trim();
  const initials = text(slot.initials || (slot.label || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase());
  const body = image
    ? `<span class="v2-header__avatar" style="--v2-avatar:url('${text(image)}');--v2-avatar-position:${text(slot.imagePosition || '50% 50%')}" aria-hidden="true"></span>`
    : `<span class="v2-header__avatar v2-header__avatar--initials" aria-hidden="true">${initials || label.slice(0, 1)}</span>`;
  return `<div class="v2-header__slot v2-header__slot--a"><div class="v2-header__control v2-header__control--avatar" aria-hidden="true">${body}</div></div>`;
}

function actionControl(slot = {}, role = '') {
  if (!slot || slot.hidden) return '';
  const label = text(slot.label || '');
  const kind = slot.kind || 'text';
  const aria = text(slot.aria || slot.label || role);
  const badgeValue = slot.badge == null && kind === 'chat' ? defaultChatBadge() : Number(slot.badge || 0);
  const badge = badgeValue > 0 ? `<span class="v2-header__badge">${Math.min(99, badgeValue)}</span>` : '';
  const variant = slot.variant === 'danger' ? 'danger' : (slot.variant === 'white' || slot.variant === 'secondary' ? 'white' : '');
  const variantClass = variant ? ` v2-header__control--${variant}` : '';
  let body = label;
  if (kind === 'mode') {
    body = '<span class="v2-header__icon v2-header__icon--mode" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h12M13 4l3 3-3 3M20 17H8M11 14l-3 3 3 3"></path></svg></span>';
  } else if (kind === 'chat') {
    body = '<span class="v2-header__icon v2-header__icon--chat" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 4c-4.7 0-8 2.8-8 6.7 0 2.5 1.4 4.6 3.8 5.8L7.2 20l3.6-2.1c.4.1.8.1 1.2.1 4.7 0 8-2.8 8-7.3S16.7 4 12 4Z"></path></svg></span>';
  } else if (kind === 'contacts') {
    body = '<span class="v2-header__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="2.2"></circle><path d="M3.8 14.5c.7-2.1 1.8-3.1 3.2-3.1s2.5 1 3.2 3.1M13 7h7M13 12h7M13 17h7"></path></svg></span>';
  } else if (kind === 'attachment') {
    body = '<span class="v2-header__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m8.5 12.5 6.2-6.2a3.2 3.2 0 0 1 4.5 4.5l-8.3 8.3a5 5 0 0 1-7.1-7.1l8.1-8.1"></path></svg></span>';
  } else if (kind === 'settings') {
    body = '<span class="v2-header__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"></path></svg></span>';
  } else if (kind === 'back') {
    body = '<span class="v2-header__back" aria-hidden="true">‹</span>';
  }
  return `<div class="v2-header__slot v2-header__slot--${role}"><button type="button" class="v2-header__control v2-header__control--${kind}${variantClass}"${dataAttributes(slot.data)} aria-label="${aria}"${slot.disabled ? ' disabled' : ''}>${body}${badge}</button></div>`;
}

export function v2Header({ a = null, b = '', c = null, d = null } = {}) {
  const title = b && typeof b === 'object'
    ? `<button type="button" class="v2-header__title v2-header__title-control"${dataAttributes(b.data)} aria-label="${text(b.aria || b.label || '')}">${text(b.label || '')}</button>`
    : `<h1 class="v2-header__title">${text(b)}</h1>`;
  const headerClasses = ['v2-header', c && !c.hidden ? 'has-c' : '', d && !d.hidden ? 'has-d' : ''].filter(Boolean).join(' ');
  return `<header class="${headerClasses}" data-v2-header>
    ${avatarControl(a)}
    ${title}
    ${actionControl(c, 'c')}
    ${actionControl(d, 'd')}
  </header>`;
}
