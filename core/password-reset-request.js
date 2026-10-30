import { API_BASE } from './environment.js';
import { openNotice } from '../ui/ui.js';

const FORGOT_SELECTOR = [
  '[data-specialist-forgot]',
  '[data-booking-forgot]',
  '[data-global-account-forgot]',
  '[data-admin-forgot]',
].join(',');

function isAccountSurface(target) {
  return Boolean(target?.matches?.('[data-booking-forgot],[data-global-account-forgot]'));
}

function identifierFrom(target) {
  const form = target?.closest?.('form');
  if (!form) return '';
  const data = new FormData(form);
  return String(data.get('identifier') || data.get('phone') || data.get('email') || '').trim();
}

function focusIdentifier(target) {
  const form = target?.closest?.('form');
  form?.querySelector?.('[name="identifier"],[name="phone"],[name="email"]')?.focus?.();
}

function phoneLike(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return !String(value || '').includes('@') && digits.length >= 10 && digits.length <= 15;
}

async function requestReset(target) {
  const identifier = identifierFrom(target);
  if (!phoneLike(identifier)) {
    focusIdentifier(target);
    openNotice({
      title: 'Восстановление пароля',
      message: 'Укажите номер телефона.',
      action: 'Закрыть',
    });
    return;
  }

  const accountSurface = isAccountSurface(target);
  const path = accountSurface
    ? '/online-booking/account/password-reset/request'
    : '/auth/password-reset/request';
  const body = accountSurface
    ? { identifier }
    : {
        identifier,
        surface: String(location.hostname || '').toLowerCase() === 'admin.va-tools.ru' ? 'admin' : 'app',
      };

  target.disabled = true;
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('request failed');
    openNotice({
      title: 'Восстановление пароля',
      message: 'Если аккаунт найден и его email подтверждён, ссылка для смены пароля отправлена. Она действует 30 минут.',
      action: 'Закрыть',
    });
  } catch {
    openNotice({
      title: 'Восстановление пароля',
      message: 'Сервис восстановления сейчас недоступен. Повторите попытку позже.',
      action: 'Закрыть',
      variant: 'technical',
    });
  } finally {
    target.disabled = false;
  }
}

function ensureAdminForgotButton() {
  const form = document.querySelector('[data-login-form]');
  if (!form || form.querySelector('[data-admin-forgot]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-button secondary';
  button.dataset.adminForgot = '';
  button.textContent = 'Забыли пароль?';
  form.append(button);
}

function normalizeIdentifierField(form) {
  if (!form) return;
  const input = form.querySelector('[name="identifier"],[name="phone"],[name="email"]');
  if (!input) return;
  input.type = 'tel';
  input.inputMode = 'tel';
  input.autocomplete = 'tel';
  input.setAttribute('aria-label', 'Телефон');
  const host = input.closest('.field');
  const label = host?.querySelector(':scope > span');
  if (label) label.textContent = input.required ? 'Телефон *' : 'Телефон';
}

function normalizeLoginFields() {
  document.querySelectorAll('#auth-form, [data-login-form]').forEach(normalizeIdentifierField);
  document.querySelectorAll(FORGOT_SELECTOR).forEach((button) => normalizeIdentifierField(button.closest('form')));
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest(FORGOT_SELECTOR) : null;
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void requestReset(target);
}, true);

ensureAdminForgotButton();
normalizeLoginFields();
const observer = new MutationObserver(() => {
  ensureAdminForgotButton();
  normalizeLoginFields();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
