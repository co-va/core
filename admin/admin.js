import { apiRequest, clearAuthToken, getCurrentAccount, login } from '../core/auth.js';
import { renderDocumentRegistry } from './document-registry/view.js';
import { DOCUMENT_CATALOG } from './document-registry/catalog.js';
import { renderAdminTools } from './commercial-catalog.js';

const app = document.querySelector('#admin-app');
const state = {
  account: null,
  admin: null,
  tenants: [],
  capabilities: [],
  section: 'tenants',
};

let adminPollTimer = null;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

async function adminRequest(path, options = {}) {
  const response = await apiRequest(`/saas-admin${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка панели управления');
  return payload;
}

async function platformNoticeRequest(path, options = {}) {
  const response = await apiRequest(`/platform-notices${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка уведомлений');
  return payload;
}

function decodeBase64Url(value) {
  const padding = '='.repeat((4 - (String(value || '').length % 4)) % 4);
  const base64 = `${String(value || '').replaceAll('-', '+').replaceAll('_', '/')}${padding}`;
  const raw = atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

async function enableAdminPush(promptUser = false) {
  if (
    typeof navigator === 'undefined'
    || !('serviceWorker' in navigator)
    || !('PushManager' in window)
    || !('Notification' in window)
  ) return false;

  const configuration = await platformNoticeRequest('/push/configuration');
  if (!configuration?.enabled || !configuration?.publicKey) return false;

  if (Notification.permission === 'default' && promptUser) {
    await Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return false;

  const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(configuration.publicKey),
    });
  }
  await platformNoticeRequest('/push/subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription.toJSON()),
  });
  return true;
}

function startAdminPolling() {
  if (adminPollTimer) window.clearInterval(adminPollTimer);
  adminPollTimer = window.setInterval(async () => {
    try {
      await refreshData();
      if (state.section === 'tenants') renderTenants();
    } catch {
      // Фоновое обновление не должно мешать работе админки.
    }
  }, 30_000);
}

function renderLogin(message = '') {
  app.innerHTML = `
    <main class="admin-login">
      <section class="admin-login-card">
        <h1>Администрирование</h1>
        <p>Управление пользователями и рабочими пространствами</p>
        <form class="admin-form" data-login-form>
          <label class="admin-field"><span>Email</span><input name="email" type="email" autocomplete="username" required></label>
          <label class="admin-field"><span>Пароль</span><input name="password" type="password" autocomplete="current-password" required></label>
          <p class="admin-error" data-login-error>${escapeHtml(message)}</p>
          <button class="admin-button" type="submit">Войти</button>
        </form>
      </section>
    </main>`;

  const form = app.querySelector('[data-login-form]');
  const error = app.querySelector('[data-login-error]');
  const button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.textContent = '';
    button.disabled = true;
    const data = new FormData(form);
    try {
      state.account = await login(data.get('email'), data.get('password'));
      await loadAdmin();
    } catch (loginError) {
      error.textContent = loginError instanceof Error ? loginError.message : 'Не удалось войти';
      button.disabled = false;
    }
  });
}

async function loadAdmin() {
  state.admin = await adminRequest('/me');
  await adminRequest('/document-registry/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents: DOCUMENT_CATALOG }),
  });
  await refreshData();
  renderShell();
  startAdminPolling();
  void enableAdminPush(false).then((enabled) => {
    const pushButton = app.querySelector('[data-enable-admin-push]');
    if (enabled && pushButton) {
      pushButton.textContent = 'PUSH включён';
      pushButton.disabled = true;
    }
  }).catch(() => false);
}

async function refreshData() {
  const [tenants, capabilities] = await Promise.all([
    adminRequest('/tenants'),
    adminRequest('/capabilities'),
  ]);
  state.tenants = Array.isArray(tenants) ? tenants : [];
  state.capabilities = Array.isArray(capabilities) ? capabilities : [];
}

function renderShell() {
  app.innerHTML = `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-brand">Панель <span>управления</span></div>
        <nav class="admin-nav">
          <button data-section="overview">Обзор</button>
          <button data-section="owner" class="owner-link">Моё пространство</button>
          <button data-section="document-registry">Реестр документов</button>
          <button data-section="tenants">Пользователи</button>
          <button data-section="capabilities">Инструменты</button>
        </nav>
        <div class="admin-sidebar-foot">Управление системой</div>
      </aside>
      <header class="admin-toolbar">
        <h1 data-toolbar-title>Пользователи</h1>
        <div class="admin-toolbar-user"><span>${escapeHtml(state.admin?.account?.email || '')}</span><button class="admin-button secondary" data-enable-admin-push>Включить PUSH</button><button class="admin-button secondary" data-logout>Выйти</button></div>
      </header>
      <main class="admin-main"><div class="admin-content" data-content></div></main>
    </div>`;

  app.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.section = button.dataset.section;
      renderCurrentSection();
    });
  });

  const pushButton = app.querySelector('[data-enable-admin-push]');
  const syncPushButton = (enabled = false) => {
    if (!pushButton) return;
    const supported = typeof Notification !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) {
      pushButton.hidden = true;
      return;
    }
    const active = enabled || Notification.permission === 'granted';
    pushButton.textContent = active ? 'PUSH включён' : 'Включить PUSH';
    pushButton.disabled = active;
  };
  syncPushButton(false);
  pushButton?.addEventListener('click', async () => {
    pushButton.disabled = true;
    pushButton.textContent = 'Включаем…';
    const enabled = await enableAdminPush(true).catch(() => false);
    syncPushButton(enabled);
    if (!enabled && Notification.permission !== 'granted') pushButton.disabled = false;
  });

  app.querySelector('[data-logout]').addEventListener('click', () => {
    if (adminPollTimer) window.clearInterval(adminPollTimer);
    adminPollTimer = null;
    clearAuthToken();
    state.account = null;
    state.admin = null;
    renderLogin();
  });
  renderCurrentSection();
}

function setActiveSection(title) {
  app.querySelector('[data-toolbar-title]').textContent = title;
  app.querySelectorAll('[data-section]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.section === state.section);
  });
}

function renderCurrentSection() {
  if (state.section === 'overview') return renderOverview();
  if (state.section === 'owner') return renderOwnerBook();
  if (state.section === 'document-registry') {
    return renderDocumentRegistry(app.querySelector('[data-content]'), {
      escapeHtml,
      setTitle: setActiveSection,
      loadHistory: () => adminRequest('/document-registry/history'),
    });
  }
  if (state.section === 'capabilities') return renderCapabilities();
  return renderTenants();
}

function renderOverview() {
  setActiveSection('Обзор');
  const content = app.querySelector('[data-content]');
  const regular = state.tenants.filter((item) => !item.isOwnerBook);
  const active = regular.filter((item) => item.status === 'ACTIVE' && item.ownerProfile).length;
  const pending = regular.filter((item) => !item.ownerProfile && item.invitation?.status === 'PENDING').length;
  content.innerHTML = `
    <div class="admin-heading"><div><h2>Обзор</h2><p>Состояние рабочих пространств</p></div></div>
    <div class="admin-stats">
      <div class="admin-stat"><strong>${regular.length}</strong><span>зарегистрировано</span></div>
      <div class="admin-stat"><strong>${active}</strong><span>активных</span></div>
      <div class="admin-stat"><strong>${pending}</strong><span>ожидают регистрации</span></div>
    </div>`;
}

function renderOwnerBook() {
  setActiveSection('Моё пространство');
  const owner = state.tenants.find((item) => item.isOwnerBook);
  const content = app.querySelector('[data-content]');
  if (!owner) {
    content.innerHTML = '<div class="admin-card" style="padding:20px">Личное рабочее пространство пока не определено.</div>';
    return;
  }
  content.innerHTML = `
    <div class="admin-heading"><div><h2>Моё пространство</h2><p>Личное рабочее пространство администратора остаётся отдельным от списка пользователей.</p></div></div>
    <div class="admin-card" style="padding:20px">
      <strong>${escapeHtml(owner.ownerProfile?.name || owner.tenantName)}</strong>
      <p style="color:#817a74">${escapeHtml(owner.ownerProfile?.email || '')}</p>
      <button class="admin-button" data-edit-owner>Настроить доступы</button>
    </div>`;
  content.querySelector('[data-edit-owner]').addEventListener('click', () => openAccessDrawer(owner.tenantId));
}

function openDeleteTenantModal(tenantId) {
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant || tenant.isOwnerBook) return;

  const name = tenant.ownerProfile?.name || tenant.invitation?.name || tenant.tenantName || 'Пользователь';
  const email = tenant.ownerProfile?.email || tenant.invitation?.email || '';
  const backdrop = document.createElement('div');
  backdrop.className = 'admin-delete-backdrop';
  backdrop.innerHTML = `
    <section class="admin-delete-modal" role="dialog" aria-modal="true" aria-labelledby="admin-delete-title">
      <h2 id="admin-delete-title">Удалить пользователя?</h2>
      <p class="admin-delete-person"><strong>${escapeHtml(name)}</strong>${email ? `<span>${escapeHtml(email)}</span>` : ''}</p>
      <p class="admin-delete-copy">Будут полностью удалены профиль, рабочее пространство и все его тестовые данные. Отменить это действие будет невозможно.</p>
      <p class="admin-delete-error" data-delete-error></p>
      <div class="admin-delete-actions">
        <button type="button" class="admin-button secondary" data-delete-cancel>Отмена</button>
        <button type="button" class="admin-button danger" data-delete-confirm>Удалить</button>
      </div>
    </section>`;
  document.body.append(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelector('[data-delete-cancel]')?.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector('[data-delete-confirm]')?.addEventListener('click', async (event) => {
    const control = event.currentTarget;
    const errorNode = backdrop.querySelector('[data-delete-error]');
    control.disabled = true;
    control.textContent = 'Удаляем…';
    errorNode.textContent = '';
    try {
      await adminRequest(`/tenants/${encodeURIComponent(tenantId)}`, { method: 'DELETE' });
      close();
      await refreshData();
      renderTenants();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : 'Не удалось удалить пользователя';
      control.disabled = false;
      control.textContent = 'Удалить';
    }
  });
}

const INVITATION_TOOL_GROUP_LABELS = {
  profile: 'Профиль',
  work: 'Основные',
  people: 'Основные',
  finance: 'Финансы',
  journal: 'Журнал',
  settings: 'Настройки',
};

function invitationToolSelector() {
  const groups = new Map();
  state.capabilities.forEach((item) => {
    if (item.valueType !== 'BOOLEAN') return;
    const label = INVITATION_TOOL_GROUP_LABELS[item.groupKey] || item.groupKey || 'Инструменты';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  });
  return `<div class="admin-invite-tools" data-invite-tools>
    <div class="admin-invite-tools-head">
      <div><h4>Доступ по ссылке</h4><p class="admin-service-note">Выбери только те инструменты, которые должны быть доступны человеку в DEMO по этой ссылке.</p></div>
      <div class="admin-inline-actions">
        <button class="admin-button secondary" type="button" data-select-all-invite-tools>Выбрать всё</button>
        <button class="admin-button secondary" type="button" data-clear-invite-tools>Снять всё</button>
      </div>
    </div>
    ${[...groups.entries()].map(([group, items]) => `<section class="admin-invite-tool-group">
      <strong>${escapeHtml(group)}</strong>
      <div class="admin-invite-tool-list">
        ${items.map((item) => `<label class="admin-invite-tool">
          <input type="checkbox" value="${escapeHtml(item.key)}" data-invite-tool>
          <span>${escapeHtml(item.name)}</span>
        </label>`).join('')}
      </div>
    </section>`).join('')}
  </div>`;
}

function selectedInvitationTools(root) {
  return [...root.querySelectorAll('[data-invite-tool]:checked')]
    .map((input) => String(input.value || '').trim())
    .filter(Boolean);
}

function renderTenants() {
  setActiveSection('Пользователи');
  const content = app.querySelector('[data-content]');
  const tenants = state.tenants.filter((item) => !item.isOwnerBook);
  content.innerHTML = `
    <div class="admin-heading"><div><h2>Пользователи</h2><p>Здесь только люди, их режим и доступ. Регистрацию больше не нужно вести через email.</p></div></div>
    <section class="admin-invite-panel">
      <div class="admin-invite-head">
        <div>
          <h3>Регистрационная ссылка</h3>
          <p class="admin-service-note">Имя и email заранее не нужны. Настрой доступ, создай одноразовую ссылку и отправь её человеку любым способом.</p>
        </div>
      </div>
      <details class="admin-invite-access">
        <summary>Настроить доступ по ссылке</summary>
        ${invitationToolSelector()}
      </details>
      <div class="admin-invite-primary-actions">
        <button class="admin-button" type="button" data-create-invite-link>Создать ссылку</button>
      </div>
      <div class="admin-invite-link" data-invite-link hidden>
        <label class="admin-field">
          <span>Ссылка для регистрации</span>
          <input type="text" readonly data-invite-link-value>
        </label>
        <button class="admin-button secondary" type="button" data-copy-invite-link>Копировать</button>
      </div>
      <p class="admin-inline-message" data-invite-message></p>
    </section>
    <div class="admin-card">
      <table class="admin-table">
        <thead><tr><th>Пользователь</th><th>Email</th><th>Режим</th><th>Состояние</th></tr></thead>
        <tbody>${tenants.map(tenantRow).join('') || '<tr><td colspan="4">Пока нет созданных профилей.</td></tr>'}</tbody>
      </table>
    </div>`;

  const message = content.querySelector('[data-invite-message]');
  const createLinkButton = content.querySelector('[data-create-invite-link]');
  const inviteLinkBox = content.querySelector('[data-invite-link]');
  const inviteLinkInput = content.querySelector('[data-invite-link-value]');
  const copyLinkButton = content.querySelector('[data-copy-invite-link]');

  content.querySelector('[data-select-all-invite-tools]')?.addEventListener('click', () => {
    content.querySelectorAll('[data-invite-tool]').forEach((input) => { input.checked = true; });
  });
  content.querySelector('[data-clear-invite-tools]')?.addEventListener('click', () => {
    content.querySelectorAll('[data-invite-tool]').forEach((input) => { input.checked = false; });
  });

  createLinkButton?.addEventListener('click', async () => {
    message.textContent = '';
    message.classList.remove('error');
    const tools = selectedInvitationTools(content);
    if (!tools.length) {
      content.querySelector('.admin-invite-access')?.setAttribute('open', '');
      message.textContent = 'Выбери хотя бы один инструмент или нажми «Выбрать всё».';
      message.classList.add('error');
      return;
    }
    createLinkButton.disabled = true;
    createLinkButton.textContent = 'Создаём…';
    try {
      const result = await adminRequest('/invitations/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools }),
      });
      const url = String(result?.url || '').trim();
      if (!url) throw new Error('Ссылка не получена');
      inviteLinkInput.value = url;
      inviteLinkBox.hidden = false;
      message.textContent = 'Ссылка готова. Она действует 7 дней и используется один раз.';
      await refreshData();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось создать ссылку';
      message.classList.add('error');
    } finally {
      createLinkButton.disabled = false;
      createLinkButton.textContent = 'Создать ссылку';
    }
  });

  copyLinkButton?.addEventListener('click', async () => {
    const url = String(inviteLinkInput?.value || '').trim();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inviteLinkInput.focus();
      inviteLinkInput.select();
      document.execCommand('copy');
    }
    copyLinkButton.textContent = 'Скопировано';
    window.setTimeout(() => { copyLinkButton.textContent = 'Копировать'; }, 1200);
  });

  content.querySelectorAll('[data-tenant]').forEach((row) => {
    row.addEventListener('click', () => openAccessDrawer(row.dataset.tenant));
  });

  content.querySelectorAll('[data-delete-tenant]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const tenantId = button.dataset.deleteTenant;
      if (tenantId) openDeleteTenantModal(tenantId);
    });
  });
}

function tenantRow(item) {
  const pending = !item.ownerProfile && item.invitation?.status === 'PENDING';
  const name = item.ownerProfile?.name || item.invitation?.name || item.tenantName;
  const email = item.ownerProfile?.email || item.invitation?.email || '';
  const mode = String(item.access?.commercialMode || 'DEMO');
  const statusClass = item.status === 'SUSPENDED' ? 'suspended' : pending ? 'pending' : 'active';
  const statusLabel = item.status === 'SUSPENDED' ? 'Отключён' : pending ? 'Ждёт регистрации' : item.ownerProfile ? 'Активен' : 'Создан';
  const modeClass = mode === 'LIVE' ? 'active' : 'pending';
  const testerBadge = item.isTester ? ' <span class="admin-pill pending">Тестировщик</span>' : '';
  const remove = `<button class="admin-button danger" data-delete-tenant="${escapeHtml(item.tenantId)}">Удалить</button>`;
  return `<tr data-tenant="${escapeHtml(item.tenantId)}"><td><strong>${escapeHtml(name)}</strong>${testerBadge}</td><td>${email ? escapeHtml(email) : '—'}</td><td><span class="admin-pill ${modeClass}">${escapeHtml(mode)}</span></td><td><span class="admin-pill ${statusClass}">${statusLabel}</span> ${remove}</td></tr>`;
}

function renderCapabilities() {
  setActiveSection('Инструменты');
  renderAdminTools(app.querySelector('[data-content]'));
}

function formatAdminMoment(value, fallback = '—') {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return fallback;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function orderedCapabilityCatalog(tenant) {
  const byKey = new Map(state.capabilities.map((item) => [item.key, item]));
  const order = Array.isArray(tenant.access?.capabilityOrder) ? tenant.access.capabilityOrder : [];
  const result = order.map((key) => byKey.get(key)).filter(Boolean);
  state.capabilities.forEach((item) => {
    if (!result.some((entry) => entry.key === item.key)) result.push(item);
  });
  return result;
}

function capabilityOrderRow(capability, resolved) {
  const orderable = capability.valueType === 'BOOLEAN';
  return `<div class="admin-capability-order-row" draggable="${orderable}" data-capability-row="${escapeHtml(capability.key)}" data-capability-orderable="${orderable}">
    <div class="admin-capability-move">
      <button type="button" data-capability-up aria-label="Поднять">↑</button>
      <button type="button" data-capability-down aria-label="Опустить">↓</button>
    </div>
    <div class="admin-capability-control">${capabilityEditor(capability, resolved)}</div>
  </div>`;
}

function openAccessDrawer(tenantId) {
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  if (!tenant) return;
  const resolved = new Map((tenant.access?.capabilities || []).map((item) => [item.key, item]));
  const capabilities = orderedCapabilityCatalog(tenant);
  const mode = String(tenant.access?.commercialMode || 'DEMO');
  const demoActivated = tenant.access?.demoActivatedAt || tenant.invitation?.activatedAt || '';
  const demoExpires = tenant.access?.demoExpiresAt || tenant.invitation?.demoExpiresAt || '';
  const backdrop = document.createElement('div');
  backdrop.className = 'admin-drawer-backdrop';
  backdrop.innerHTML = `
    <aside class="admin-drawer">
      <div class="admin-drawer-head">
        <div><h3>${escapeHtml(tenant.ownerProfile?.name || tenant.invitation?.name || tenant.tenantName || 'Пользователь')}</h3><p>${escapeHtml(tenant.ownerProfile?.email || tenant.invitation?.email || '')}</p></div>
        <button class="admin-close" data-close aria-label="Закрыть">×</button>
      </div>

      <section class="admin-section">
        <h4>Режим</h4>
        <div class="admin-mode-card">
          <strong>${escapeHtml(mode)}</strong>
          ${mode === 'DEMO' ? `<span>${demoActivated ? `DEMO началось ${escapeHtml(formatAdminMoment(demoActivated))}` : 'DEMO ещё не началось'}</span><span>${demoExpires ? `DEMO до ${escapeHtml(formatAdminMoment(demoExpires))}` : 'Срок появится после активации'}</span>` : '<span>Рабочий режим LIVE активен.</span>'}
        </div>
      </section>

      <section class="admin-section">
        <h4>Роль доступа</h4>
        <div class="admin-capability">
          <div>
            <strong data-tester-label>${tenant.isTester ? 'Тестировщик' : 'Пользователь'}</strong>
            <small>Назначается администратором. Не зависит от ссылки или DEMO/LIVE.</small>
          </div>
          <button type="button" class="admin-toggle${tenant.isTester ? ' is-on' : ''}"
            role="switch" aria-label="Тестировщик" aria-checked="${tenant.isTester ? 'true' : 'false'}"
            data-tester-toggle></button>
        </div>
      </section>

      <section class="admin-section">
        <h4>Инструменты пользователя</h4>
        <p class="admin-service-note">Здесь можно вручную включить, выключить и расположить инструменты конкретного пользователя.</p>
        <div data-capability-order-list>
          ${capabilities.map((capability) => capabilityOrderRow(capability, resolved.get(capability.key))).join('')}
        </div>
      </section>

      <section class="admin-section">
        <h4>Состояние пространства</h4>
        <button class="admin-button ${tenant.status === 'SUSPENDED' ? '' : 'danger'}" data-status>${tenant.status === 'SUSPENDED' ? 'Включить пространство' : 'Отключить пространство'}</button>
      </section>

      ${tenant.ownerProfile?.email ? `
      <section class="admin-section">
        <h4>Техническое письмо</h4>
        <p class="admin-service-note">Это служебная отправка уже зарегистрированному пользователю: ${escapeHtml(tenant.ownerProfile.email)}</p>
        <form class="admin-form" data-technical-email-form>
          <label class="admin-field"><span>Тема</span><input name="subject" maxlength="200" required></label>
          <label class="admin-field"><span>Текст</span><textarea name="body" rows="6" maxlength="20000" required></textarea></label>
          <div><button class="admin-button secondary" type="submit">Отправить письмо</button></div>
          <p class="admin-inline-message" data-technical-email-message></p>
        </form>
      </section>` : ''}

      <div class="admin-actions"><button class="admin-button secondary" data-close>Закрыть</button><button class="admin-button" data-save>Сохранить изменения</button></div>
      <p class="admin-inline-message" data-save-message></p>
    </aside>`;
  document.body.append(backdrop);

  const close = () => backdrop.remove();
  backdrop.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', close));
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });

  const capabilityList = backdrop.querySelector('[data-capability-order-list]');
  const originalOrder = capabilities.filter((item) => item.valueType === 'BOOLEAN').map((item) => item.key).join('|');
  const moveCapability = (row, direction) => {
    const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!sibling) return;
    if (direction < 0) capabilityList.insertBefore(row, sibling);
    else capabilityList.insertBefore(sibling, row);
  };
  capabilityList?.querySelectorAll('[data-capability-row]').forEach((row) => {
    if (row.dataset.capabilityOrderable !== 'true') {
      row.querySelector('[data-capability-up]')?.setAttribute('disabled', 'disabled');
      row.querySelector('[data-capability-down]')?.setAttribute('disabled', 'disabled');
      return;
    }
    row.querySelector('[data-capability-up]')?.addEventListener('click', () => moveCapability(row, -1));
    row.querySelector('[data-capability-down]')?.addEventListener('click', () => moveCapability(row, 1));
    row.addEventListener('dragstart', (event) => {
      row.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', row.dataset.capabilityRow || '');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      const dragging = capabilityList.querySelector('.is-dragging');
      if (!dragging || dragging === row) return;
      const rect = row.getBoundingClientRect();
      capabilityList.insertBefore(dragging, event.clientY < rect.top + rect.height / 2 ? row : row.nextSibling);
    });
  });

  const testerToggle = backdrop.querySelector('[data-tester-toggle]');
  testerToggle?.addEventListener('click', () => {
    const enabled = testerToggle.getAttribute('aria-checked') !== 'true';
    testerToggle.setAttribute('aria-checked', String(enabled));
    testerToggle.classList.toggle('is-on', enabled);
    backdrop.querySelector('[data-tester-label]').textContent = enabled ? 'Тестировщик' : 'Пользователь';
  });

  backdrop.querySelectorAll('[data-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.toggle('is-on');
      button.dataset.current = button.classList.contains('is-on') ? 'true' : 'false';
    });
  });

  backdrop.querySelector('[data-status]')?.addEventListener('click', async () => {
    const next = tenant.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    try {
      await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      await refreshData();
      close();
      renderCurrentSection();
    } catch (error) {
      const message = backdrop.querySelector('[data-save-message]');
      message.textContent = error instanceof Error ? error.message : 'Не удалось изменить состояние';
      message.classList.add('error');
    }
  });

  const technicalEmailForm = backdrop.querySelector('[data-technical-email-form]');
  technicalEmailForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const buttonNode = technicalEmailForm.querySelector('button[type="submit"]');
    const message = technicalEmailForm.querySelector('[data-technical-email-message]');
    const data = new FormData(technicalEmailForm);
    message.textContent = '';
    message.classList.remove('error');
    buttonNode.disabled = true;
    buttonNode.textContent = 'Отправляем…';
    try {
      const result = await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/technical-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: data.get('subject'), body: data.get('body') }),
      });
      message.textContent = `Письмо отправлено на ${result.recipientEmail}.`;
      technicalEmailForm.reset();
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось отправить письмо';
      message.classList.add('error');
    } finally {
      buttonNode.disabled = false;
      buttonNode.textContent = 'Отправить письмо';
    }
  });

  backdrop.querySelector('[data-save]')?.addEventListener('click', async () => {
    const changes = [];
    backdrop.querySelectorAll('[data-capability]').forEach((element) => {
      const key = element.dataset.capability;
      const type = element.dataset.type;
      if (type === 'BOOLEAN') {
        const current = element.dataset.current === 'true';
        const original = element.dataset.original === 'true';
        if (current !== original) changes.push({ key, enabled: current });
      } else {
        const raw = element.value.trim();
        const current = raw === '' ? null : Number(raw);
        const originalRaw = element.dataset.original;
        const original = originalRaw === '' ? null : Number(originalRaw);
        if (current !== original) changes.push({ key, limit: current });
      }
    });

    const orderKeys = [...capabilityList.querySelectorAll('[data-capability-row][data-capability-orderable="true"]')]
      .map((row) => row.dataset.capabilityRow);
    const orderChanged = orderKeys.join('|') !== originalOrder;
    const testerChanged = (testerToggle?.getAttribute('aria-checked') === 'true') !== Boolean(tenant.isTester);
    const message = backdrop.querySelector('[data-save-message]');
    if (!changes.length && !orderChanged && !testerChanged) {
      message.textContent = 'Изменений нет.';
      return;
    }

    try {
      if (changes.length || testerChanged) {
        await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/access`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities: changes, ...(testerChanged ? { isTester: testerToggle.getAttribute('aria-checked') === 'true' } : {}) }),
        });
      }
      if (orderChanged) {
        await adminRequest(`/tenants/${encodeURIComponent(tenantId)}/capability-order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys: orderKeys }),
        });
      }
      message.textContent = 'Изменения сохранены.';
      message.classList.remove('error');
      await refreshData();
      window.setTimeout(() => { close(); renderCurrentSection(); }, 300);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось сохранить инструменты';
      message.classList.add('error');
    }
  });
}

function capabilityEditor(capability, resolved) {
  if (capability.valueType === 'LIMIT') {
    const value = resolved?.limit == null ? '' : String(resolved.limit);
    return `<label class="admin-capability"><div>${escapeHtml(capability.name)}<small>${escapeHtml(capability.key)} · пусто = без ограничения</small></div><input class="admin-limit" type="number" min="0" data-capability="${escapeHtml(capability.key)}" data-type="LIMIT" data-original="${escapeHtml(value)}" value="${escapeHtml(value)}" placeholder="∞"></label>`;
  }
  const enabled = resolved?.enabled !== false;
  return `<div class="admin-capability"><div>${escapeHtml(capability.name)}<small>${escapeHtml(capability.key)}</small></div><button type="button" class="admin-toggle ${enabled ? 'is-on' : ''}" data-toggle data-capability="${escapeHtml(capability.key)}" data-type="BOOLEAN" data-original="${enabled}" data-current="${enabled}" aria-label="${escapeHtml(capability.name)}"></button></div>`;
}

try {
  state.account = await getCurrentAccount();
  if (!state.account) {
    renderLogin();
  } else {
    await loadAdmin();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : 'Нет доступа к панели управления';
  clearAuthToken();
  renderLogin(message);
}
