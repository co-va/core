import { apiRequest } from '../core/auth.js';

const app = document.querySelector('#admin-app');
let scheduled = false;
let renderVersion = 0;

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

function toolsView() {
  return app?.querySelector('[data-toolbar-title]')?.textContent?.trim() === 'Инструменты';
}

function professionalHeading(content) {
  if (content.querySelector('[data-professional-tools-heading]')) return;
  const heading = content.querySelector('.admin-heading');
  if (!heading) return;
  const marker = document.createElement('div');
  marker.className = 'admin-heading';
  marker.dataset.professionalToolsHeading = '';
  marker.innerHTML = '<div><h3>Профессионалы</h3><p>Инструменты рабочего контура.</p></div>';
  heading.insertAdjacentElement('afterend', marker);
}

function toolRow(tool) {
  return `<label class="admin-invite-tool">
    <input type="checkbox" data-account-tool="${escapeHtml(tool.key)}"${tool.enabled ? ' checked' : ''}>
    <span><strong>${escapeHtml(tool.name)}</strong>${tool.description ? `<small style="display:block;color:#817a74">${escapeHtml(tool.description)}</small>` : ''}</span>
  </label>`;
}

async function mountAccountTools() {
  scheduled = false;
  if (!toolsView()) return;
  const content = app?.querySelector('[data-content]');
  if (!content) return;
  professionalHeading(content);
  if (content.querySelector('[data-account-tools-panel]')) return;

  const version = ++renderVersion;
  const panel = document.createElement('section');
  panel.className = 'admin-card';
  panel.dataset.accountToolsPanel = '';
  panel.style.padding = '18px';
  panel.style.marginTop = '18px';
  panel.innerHTML = '<strong>Конечные пользователи</strong><p class="admin-service-note">Загрузка инструментов…</p>';
  content.append(panel);

  try {
    const tools = await adminRequest('/account-tools');
    if (version !== renderVersion || !panel.isConnected || !toolsView()) return;
    const list = Array.isArray(tools) ? tools : [];
    panel.innerHTML = `
      <div class="admin-heading" style="margin-bottom:12px">
        <div><h3>Конечные пользователи</h3><p>Глобальная доступность инструментов личного контура.</p></div>
      </div>
      <div data-account-tools-list>${list.map(toolRow).join('') || '<p class="admin-service-note">Инструменты пока не добавлены.</p>'}</div>
      <p class="admin-inline-message" data-account-tools-message></p>`;

    const message = panel.querySelector('[data-account-tools-message]');
    panel.querySelectorAll('[data-account-tool]').forEach((input) => {
      input.addEventListener('change', async () => {
        const next = input.checked;
        input.disabled = true;
        if (message) {
          message.textContent = '';
          message.classList.remove('error');
        }
        try {
          const result = await adminRequest(`/account-tools/${encodeURIComponent(input.dataset.accountTool || '')}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
          });
          input.checked = Boolean(result?.enabled);
          if (message) message.textContent = `${result?.name || 'Инструмент'}: ${result?.enabled ? 'включён' : 'выключен'}`;
        } catch (error) {
          input.checked = !next;
          if (message) {
            message.textContent = error instanceof Error ? error.message : 'Не удалось изменить инструмент';
            message.classList.add('error');
          }
        } finally {
          input.disabled = false;
        }
      });
    });
  } catch (error) {
    if (!panel.isConnected) return;
    panel.innerHTML = `<strong>Конечные пользователи</strong><p class="admin-inline-message error">${escapeHtml(error instanceof Error ? error.message : 'Не удалось загрузить инструменты')}</p>`;
  }
}

function scheduleMount() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => void mountAccountTools());
}

if (app) {
  new MutationObserver(scheduleMount).observe(app, { childList: true, subtree: true });
  scheduleMount();
}
