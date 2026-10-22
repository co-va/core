import { setAuthToken } from '../core/auth.js';
import { API_BASE } from '../core/environment.js';
import { documentTile, documentTiles, openDocumentViewer } from '../ui/documents/index.js';
import { escapeHtml } from '../ui/utils/escape-html.js';

const state = document.querySelector('#invite-state');
const token = new URLSearchParams(location.search).get('token') || '';

async function post(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка сервера');
  return payload;
}

function renderError(message) {
  state.innerHTML = '<h1>Ссылка недоступна</h1><p data-error></p>';
  state.querySelector('[data-error]').textContent = message || 'Не удалось открыть регистрационную ссылку.';
}

function renderPublicStart() {
  state.innerHTML = `
    <h1>Создайте профиль</h1>
    <p>Укажите email. После этого откроются документы и основные данные для регистрации.</p>
    <form class="invite-form" data-public-form>
      <label class="invite-field"><span>Email</span><input name="email" type="email" autocomplete="email" required autofocus></label>
      <p class="invite-error" data-public-error role="alert"></p>
      <button class="invite-button" type="submit">Продолжить</button>
    </form>
    <p>Уже зарегистрированы? <a href="../">Войти</a></p>`;

  const form = state.querySelector('[data-public-form]');
  const error = state.querySelector('[data-public-error]');
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    button.disabled = true;
    button.textContent = 'Открываем регистрацию…';
    try {
      const registration = await post('/tenant-invitations/public', { email });
      location.replace(`./?token=${encodeURIComponent(registration.token)}`);
    } catch (startError) {
      error.textContent = startError instanceof Error ? startError.message : 'Не удалось открыть регистрацию';
      button.disabled = false;
      button.textContent = 'Продолжить';
    }
  });
}

function registrationDocuments(documents = []) {
  return documentTiles(documents.map((item) => documentTile({
    title: item.title || 'Документ',
    version: item.version || 1,
    openData: `data-document-open="${escapeHtml(item.key)}"`,
    toggleData: `data-document-toggle="${escapeHtml(item.key)}"${item.required ? ' data-required-document-toggle' : ''}`,
    toggleChecked: false,
    aria: `Открыть ${item.title || 'документ'}`,
    toggleAria: `Подтвердить ${item.title || 'документ'}`,
  })), { layout: 'rail', className: 'invite-documents' });
}

function registrationFacts(invitation) {
  const documents = Array.isArray(invitation.documents) ? invitation.documents : [];
  return documents.map((documentItem) => ({
    key: documentItem.key,
    version: documentItem.version,
    accepted: state.querySelector(`[data-document-toggle="${CSS.escape(documentItem.key)}"]`)?.getAttribute('aria-pressed') === 'true',
  }));
}

function renderForm(invitation) {
  const documents = Array.isArray(invitation.documents) ? invitation.documents : [];
  state.innerHTML = `
    <h1>Создайте учётную запись</h1>
    <p>Сначала подтвердите документы, затем укажите основные данные. 14 дней DEMO начнутся только после открытия вашего профиля.</p>
    <div class="invite-meta">
      <strong data-name></strong>
      <span data-email></span>
      <span>DEMO · 14 дней с первого входа в приложение</span>
    </div>

    <form class="invite-form" data-form>
      <section class="invite-legal">
        <div class="invite-legal__heading">
          <h2>Документы и согласия</h2>
          <p>Подтвердите обязательные документы. Отдельное согласие на рекламные и маркетинговые сообщения можно дать здесь же.</p>
        </div>
        ${registrationDocuments(documents)}
      </section>

      <section data-registration-data hidden>
        <div class="invite-legal__heading">
          <h2>Основные данные</h2>
          <p>Имя и номер телефона обязательны. Фамилию можно добавить сейчас или позже в профиле.</p>
        </div>

        <label class="invite-field"><span>Имя</span><input name="name" type="text" autocomplete="given-name" required></label>
        <label class="invite-field"><span>Фамилия</span><input name="surname" type="text" autocomplete="family-name"></label>
        <label class="invite-field"><span>Телефон</span><input name="phone" type="tel" autocomplete="tel" required></label>

        ${invitation.requiresEmail ? `<label class="invite-field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>` : ''}

        <label class="invite-field"><span>Пароль</span><input name="password" type="password" minlength="10" autocomplete="new-password" required></label>
        <label class="invite-field"><span>Повторите пароль</span><input name="passwordConfirm" type="password" minlength="10" autocomplete="new-password" required></label>

        <p class="invite-error" data-form-error role="alert"></p>
        <button class="invite-button" type="submit">Создать учётную запись</button>
      </section>
    </form>`;

  state.querySelector('[data-name]').textContent = invitation.name || 'Новое рабочее пространство';
  state.querySelector('[data-email]').textContent = invitation.email || '';
  const registrationName = state.querySelector('[name="name"]');
  if (registrationName && invitation.name) registrationName.value = invitation.name;

  state.querySelectorAll('[data-document-open]').forEach((control) => {
    control.addEventListener('click', () => {
      const item = documents.find((documentItem) => String(documentItem.key) === String(control.dataset.documentOpen));
      if (!item) return;
      openDocumentViewer({ title: item.title || 'Документ', version: item.version || 1, content: item.content || '' });
    });
  });

  const form = state.querySelector('[data-form]');
  const error = state.querySelector('[data-form-error]');
  const button = form.querySelector('button[type="submit"]');
  const registrationData = form.querySelector('[data-registration-data]');
  const requiredToggles = [...form.querySelectorAll('[data-required-document-toggle]')];

  const syncReady = () => {
    const legalReady = requiredToggles.every((control) => control.getAttribute('aria-pressed') === 'true');
    registrationData.hidden = !legalReady;
  };

  form.querySelectorAll('[data-document-toggle]').forEach((control) => {
    control.addEventListener('click', () => {
      const checked = control.getAttribute('aria-pressed') !== 'true';
      control.setAttribute('aria-pressed', checked ? 'true' : 'false');
      control.classList.toggle('is-on', checked);
      syncReady();
    });
  });
  syncReady();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (registrationData.hidden) return;
    error.textContent = '';

    const data = new FormData(form);
    const password = String(data.get('password') || '');
    const confirm = String(data.get('passwordConfirm') || '');
    if (password.length < 10) {
      error.textContent = 'Пароль должен содержать минимум 10 символов.';
      return;
    }
    if (password !== confirm) {
      error.textContent = 'Пароли не совпадают.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Создаём учётную запись…';
    try {
      const account = await post('/tenant-invitations/accept', {
        token,
        password,
        email: invitation.requiresEmail ? data.get('email') : undefined,
        name: data.get('name'),
        surname: data.get('surname'),
        phone: data.get('phone'),
        documents: registrationFacts(invitation),
      });
      setAuthToken(account.accessToken);
      state.innerHTML = '<h1>Учётная запись создана</h1><p class="invite-success">Открываем приложение…</p>';
      window.setTimeout(() => location.replace('../'), 350);
    } catch (acceptError) {
      error.textContent = acceptError instanceof Error ? acceptError.message : 'Не удалось завершить регистрацию';
      button.disabled = false;
      button.textContent = 'Создать учётную запись';
      syncReady();
    }
  });
}

if (!token) {
  renderPublicStart();
} else {
  try {
    const invitation = await post('/tenant-invitations/inspect', { token });
    renderForm(invitation);
  } catch (error) {
    renderError(error instanceof Error ? error.message : 'Не удалось проверить ссылку');
  }
}
