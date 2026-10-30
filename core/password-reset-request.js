import { API_BASE } from './environment.js';
import { openNotice } from '../ui/ui.js';

const FORGOT_SELECTOR = [
  '[data-specialist-forgot]',
  '[data-booking-forgot]',
  '[data-global-account-forgot]',
  '[data-admin-forgot]',
].join(',');
const REGISTER_SELECTOR = [
  '[data-specialist-register]',
  '[data-booking-register]',
  '[data-global-account-register]',
].join(',');
const LOGIN_FORM_SELECTOR = [
  '#auth-form',
  '[data-booking-entry-form]',
  '[data-global-account-entry]',
].join(',');

function isAccountSurface(target) {
  return Boolean(target?.matches?.('[data-booking-forgot],[data-global-account-forgot]'));
}

function isAdminSurface(target) {
  return Boolean(target?.matches?.('[data-admin-forgot]'));
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
  const adminSurface = isAdminSurface(target);
  if ((!adminSurface && !phoneLike(identifier)) || (adminSurface && !identifier)) {
    focusIdentifier(target);
    openNotice({
      title: 'Восстановление пароля',
      message: adminSurface ? 'Укажите email администратора.' : 'Укажите номер телефона.',
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
  const form = document.querySelector('#admin-app [data-login-form]');
  if (!form || form.querySelector('[data-admin-forgot]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-button secondary';
  button.dataset.adminForgot = '';
  button.textContent = 'Забыли пароль?';
  form.append(button);
}

function ensureProfessionalRegisterButton(form) {
  if (!form?.matches?.('#auth-form') || form.querySelector(REGISTER_SELECTOR)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'v2-sticker-link';
  button.dataset.specialistRegister = '';
  button.textContent = 'Зарегистрироваться';
  const forgot = form.querySelector(FORGOT_SELECTOR);
  if (forgot) forgot.insertAdjacentElement('afterend', button);
  else form.append(button);
}

function normalizeIdentifierField(form) {
  if (!form || form.closest('#admin-app')) return;
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

function normalizeLoginForm(form) {
  if (!form || form.closest('#admin-app')) return;
  normalizeIdentifierField(form);
  ensureProfessionalRegisterButton(form);
  form.classList.add('shared-login-form');
  const screen = form.closest('.v2-sticker-screen');
  screen?.classList.add('v2-sticker-screen--auth', 'shared-login-screen');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#2F3338');
}

function normalizeLoginFields() {
  document.querySelectorAll(LOGIN_FORM_SELECTOR).forEach(normalizeLoginForm);
  document.querySelectorAll(FORGOT_SELECTOR).forEach((button) => {
    const form = button.closest('form');
    if (form?.matches?.(LOGIN_FORM_SELECTOR)) normalizeLoginForm(form);
    else normalizeIdentifierField(form);
  });
}

document.addEventListener('click', (event) => {
  const element = event.target instanceof Element ? event.target : null;
  const register = element?.closest?.('[data-specialist-register]');
  if (register) {
    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign('/invite/');
    return;
  }

  const target = element?.closest?.(FORGOT_SELECTOR);
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
