import { workspaceHeaderContext } from '../../ui/ui.js';
import { getProfile } from '../profile/data.js';

function crop(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 50;
}

export function serviceHeaderContext({
  title = '',
  settingsData = '',
  settingsAria = 'Настройки',
  hideD = false,
  c = null,
  d = null,
} = {}) {
  const profile = getProfile();
  const name = [profile.name, profile.surname].filter(Boolean).join(' ') || 'Профиль';
  return workspaceHeaderContext({
    title,
    a: {
      kind: 'avatar',
      image: String(profile.photo || ''),
      imagePosition: `${crop(profile.photoCropX)}% ${crop(profile.photoCropY)}%`,
      initials: name.slice(0, 1).toUpperCase() || '?',
    },
    v: settingsData ? { data: settingsData, aria: settingsAria } : null,
    hideD,
    c,
    d,
  });
}

export function notifyServiceContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}
