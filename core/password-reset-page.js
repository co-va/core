import { clearAuthToken } from './auth.js';
import { API_BASE } from './environment.js';
import { initPasswordFields, passwordField } from '../ui/inputs/index.js';
import { openNotice } from '../ui/modals/index.js';
import { v2Sticker } from '../ui/v2/sticker.js';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const token = String(params.get('token') || '').trim();

function loginUrl() { return '/admin/'; }

function renderInvalid(message = 'Ссылка восстановления недействительна или истекла.') {
  root.innerHTML = v2Sticker({
    title: 'Восстановление пароля',
    body: `<p>${message}</p>`,
    action: `<a class="ui-button" href="${loginUrl()}">Вернуться ко входу</a>`,
    className: 'v2-sticker-screen--auth',
  });
}

function renderSuccess() {
  clearAuthToken();
  root.innerHTML = v2Sticker({
    title: 'Пароль изменён',
    body: '<p>Новый пароль сохранён. Войдите с ним в систему.</p>',
    action: `<a class="ui-button" href="${loginUrl()}">Войти</a>`,
    className: 'v2-sticker-screen--auth',
  });
}

function renderForm() {
  if (!token) {
    renderInvalid();
    return;
  }
  root.innerHTML = v2Sticker({
    title: 'Новый пароль',
    body: `<form class="auth-form" id="password-reset-form">
      ${passwordField({ label: 'Новый пароль', name: 'password', required: true, autocomplete: 'new-password' })}
      ${passwordField({ label: 'Повторите пароль', name: 'passwordConfirm', required: true, autocomplete: 'new-password' })}
      <p class="auth-error" data-password-reset-error role="alert"></p>
    </form>`,
    action: '<button class="ui-button" type="submit" form="password-reset-form">Сохранить</button>',
    className: 'v2-sticker-screen--auth',
  });
  initPasswordFields(root);

  const form = root.querySelector('#password-reset-form');
  const error = root.querySelector('[data-password-reset-error]');
  const submit = root.querySelector('button[type="submit"][form="password-reset-form"]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const confirmation = String(data.get('passwordConfirm') || '');
    error.textContent = '';
    if (password.length < 8) {
      error.textContent = 'Пароль должен содержать минимум 8 символов.';
      return;
    }
    if (password !== confirmation) {
      error.textContent = 'Пароли не совпадают.';
      return;
    }

    submit.disabled = true;
    try {
      const path = '/auth/password-reset/confirm';
      const response = await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || 'Ссылка восстановления недействительна или истекла');
      renderSuccess();
    } catch (requestError) {
      submit.disabled = false;
      error.textContent = requestError instanceof Error
        ? requestError.message
        : 'Не удалось изменить пароль.';
    }
  });
}

try {
  renderForm();
} catch {
  renderInvalid('Не удалось открыть восстановление пароля.');
  openNotice({ message: 'Не удалось открыть восстановление пароля.', variant: 'technical' });
}
