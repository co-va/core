import { API_BASE } from './environment.js';
import { v2Sticker } from '../ui/ui.js';

const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const token = String(params.get('token') || '').trim();
const kind = String(params.get('kind') || 'platform').trim().toLowerCase() === 'account' ? 'account' : 'platform';

function loginUrl() {
  if (kind === 'account') return '/';
  return String(location.hostname || '').toLowerCase() === 'admin.va-tools.ru' ? '/admin/' : '/';
}

function render(title, message, actionLabel = 'Войти') {
  root.innerHTML = v2Sticker({
    title,
    body: `<p>${message}</p>`,
    action: `<a class="ui-button" href="${loginUrl()}">${actionLabel}</a>`,
    className: 'v2-sticker-screen--auth',
  });
}

async function confirm() {
  if (!token) {
    render('Email не подтверждён', 'Ссылка подтверждения недействительна или устарела.', 'Вернуться ко входу');
    return;
  }

  render('Подтверждение email', 'Проверяем ссылку…', 'Вернуться ко входу');
  try {
    const path = kind === 'account'
      ? '/online-booking/account/email-verification/confirm'
      : '/auth/email-verification/confirm';
    const response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.message || 'Ссылка подтверждения недействительна или устарела');
    render('Email подтверждён', 'Адрес подтверждён и сохранён в аккаунте.');
  } catch (error) {
    render(
      'Email не подтверждён',
      error instanceof Error ? error.message : 'Ссылка подтверждения недействительна или устарела.',
      'Вернуться ко входу',
    );
  }
}

confirm();
