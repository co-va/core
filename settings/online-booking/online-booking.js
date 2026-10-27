import { buildBookingLink } from '../../core/booking-link/index.js';
import { apiRequest, getCurrentAccount } from '../../core/auth.js';
import { ACCOUNT_APP_ORIGIN } from '../../core/environment.js';
import { loadOperationalState } from '../../core/runtime/operational-state.js';
import {
  getBookingSettings,
  normalizeBookingSettings,
  saveBookingSettings,
} from '../../core/booking-settings/index.js';
import {
  actionBlock,
  button,
  copyIconButton,
  copyTextToClipboard,
  emptyState,
  escapeHtml,
  field,
  modal,
  mountModal,
  openSharedProfileSettingsMenu,
  select,
  setCopyButtonCopied,
  textareaField,
  workspaceHeaderContext,
} from '../../ui/ui.js';

let publicRouteState = { profileSlug: '', workplaces: [] };

async function loadOwnerPublicRoute() {
  const response = await apiRequest('/online-booking/owner/route');
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось сформировать короткую ссылку онлайн-записи');
  return {
    profileSlug: String(payload?.profileSlug || '').trim(),
    workplaces: (Array.isArray(payload?.workplaces) ? payload.workplaces : []).map((item) => ({
      key: String(item?.key || ''),
      name: String(item?.name || ''),
      slug: String(item?.slug || '').trim(),
    })),
  };
}

function bookingLink(profileSlug, workplaceSlug = '') {
  return buildBookingLink({
    origin: ACCOUNT_APP_ORIGIN,
    profileSlug,
    workplaceSlug,
  });
}

function copyLinkField(label, value, kind) {
  return `<div class="field"><span>${escapeHtml(label)}</span><div class="input-action-row"><input type="text" value="${escapeHtml(value)}" readonly aria-label="${escapeHtml(label)}">${copyIconButton({ data: `data-copy-booking-link="${escapeHtml(kind)}"`, aria: `Скопировать: ${label}` })}</div></div>`;
}

function bindCopyButtons(root) {
  root.querySelectorAll('[data-copy-booking-link]').forEach((copyButton) => {
    copyButton.addEventListener('click', async () => {
      const value = copyButton.closest('.input-action-row')?.querySelector('input')?.value || '';
      if (!value) return;
      try {
        if (await copyTextToClipboard(value)) setCopyButtonCopied(copyButton);
      } catch {
        // Ссылка остаётся видимой для ручного копирования.
      }
    });
  });
}

function selectedWorkplaceLink(workplaces, key) {
  const selected = workplaces.find((item) => item.key === key) || null;
  if (!selected?.slug) return '';
  return copyLinkField(selected.name || 'Ссылка рабочего пространства', bookingLink(publicRouteState.profileSlug, selected.slug), 'workplace');
}

function settingsSignature(value) {
  return JSON.stringify(normalizeBookingSettings(value));
}

function welcomeDraft(form, baseSettings = getBookingSettings()) {
  const data = new FormData(form);
  return normalizeBookingSettings({
    ...baseSettings,
    welcomeTitle: data.get('welcomeTitle'),
    welcomeText: data.get('welcomeText'),
  });
}

function setWelcomeSaveVisible(host, visible) {
  const save = host?.querySelector('[data-online-booking-welcome-save]');
  const actions = save?.closest('.modal-actions');
  if (actions) actions.hidden = !visible;
}

function openWelcomeQ(root) {
  const saved = getBookingSettings();
  const content = `${workspaceHeaderContext({ title: 'Приветствие' })}
    <form class="form-grid" data-online-booking-welcome>
      ${field({ label: 'Заголовок', name: 'welcomeTitle', value: saved.welcomeTitle, maxlength: 90 })}
      ${textareaField({ label: 'Текст', name: 'welcomeText', value: saved.welcomeText, rows: 6, maxlength: 500 })}
      ${actionBlock(button('Сохранить', {
        type: 'submit',
        data: 'data-online-booking-welcome-save',
        aria: 'Сохранить приветствие',
      }))}
    </form>`;

  const layer = mountModal(root, modal(content, {
    title: 'Приветствие',
    variant: 'q',
    className: 'online-booking-welcome-q',
  }));
  if (!layer) return null;

  const form = layer.querySelector('[data-online-booking-welcome]');
  const updateDirty = () => {
    setWelcomeSaveVisible(layer, Boolean(form) && settingsSignature(welcomeDraft(form, saved)) !== settingsSignature(saved));
  };
  form?.addEventListener('input', updateDirty);
  form?.addEventListener('change', updateDirty);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form) return;
    saveBookingSettings(welcomeDraft(form, saved));
    layer.v2Close?.();
  });
  updateDirty();
  return layer;
}

function openOnlineBookingSettings(root) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки онлайн-записи',
    actions: [
      {
        id: 'welcome',
        label: 'Приветствие',
        onSelect: () => openWelcomeQ(root),
      },
    ],
  });
}

function mountScreen(root, body) {
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Онлайн-запись',
    v: {
      data: 'data-online-booking-settings',
      aria: 'Настройки онлайн-записи',
    },
  })}<div class="form-grid form-grid--relaxed">${body}</div>`;
  root.querySelector('[data-online-booking-settings]')?.addEventListener('click', () => openOnlineBookingSettings(root));
}

function renderReady(root) {
  const workplaces = publicRouteState.workplaces.filter((item) => item.key && item.slug);
  const options = [
    { value: '', label: 'Выбрать рабочее пространство' },
    ...workplaces.map((item) => ({ value: item.key, label: item.name || 'Без названия' })),
  ];

  mountScreen(root, `<div class="form-grid form-grid--relaxed">
    ${copyLinkField('Общая ссылка', bookingLink(publicRouteState.profileSlug), 'general')}
    ${select({
      label: 'Рабочее пространство',
      name: 'bookingWorkplace',
      value: '',
      options,
      aria: 'Выбрать рабочее пространство для онлайн-записи',
    })}
    <div data-workplace-booking-link></div>
  </div>`);

  bindCopyButtons(root);
  root.querySelector('input[name="bookingWorkplace"]')?.addEventListener('change', (event) => {
    const host = root.querySelector('[data-workplace-booking-link]');
    if (!host) return;
    host.innerHTML = selectedWorkplaceLink(workplaces, event.target.value);
    bindCopyButtons(host);
  });
}

function renderUnavailable(root, title, message) {
  mountScreen(root, emptyState(title, message));
}

export function render(root) {
  root.innerHTML = `${workspaceHeaderContext({ title: 'Онлайн-запись' })}${emptyState('Загрузка', 'Формируем ссылки онлайн-записи.')}`;

  void Promise.all([loadOperationalState({ full: true }), getCurrentAccount(), loadOwnerPublicRoute()])
    .then(([, account, publicRoute]) => {
      const tenantId = String(account?.tenant?.id || '');
      if (!tenantId || !publicRoute.profileSlug) {
        renderUnavailable(root, 'Ссылка недоступна', 'Не удалось определить адрес онлайн-записи.');
        return;
      }
      publicRouteState = publicRoute;
      renderReady(root);
    })
    .catch(() => renderUnavailable(root, 'Ссылка недоступна', 'Не удалось сформировать ссылку онлайн-записи.'));
}
