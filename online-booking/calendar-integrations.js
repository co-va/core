import {
  beginGoogleCalendarConnection,
  connectYandexCalendar,
  disconnectAccountCalendar,
  getAccountCalendarStatus,
  setAccountCalendarExport,
  syncAccountCalendars,
} from '../core/calendar-sync/account.js';
import {
  emptyState,
  field,
  initPasswordFields,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  openNotice,
  passwordField,
  workspaceHeaderContext,
} from '../ui/ui.js';
import { settingsPanel } from '../ui/settings/index.js';

function providerTitle(provider) {
  return provider === 'google' ? 'Google Calendar' : 'Яндекс Календарь';
}

function providerSubtitle(state = {}) {
  if (state.lastError) return 'Ошибка синхронизации';
  if (state.connected) return 'Подключён';
  if (!state.available) return 'Связь недоступна';
  return 'Не подключён';
}

function providerMiniCard(provider, state = {}) {
  return miniCard({
    title: providerTitle(provider),
    value: state.connected ? String(state.label || '') : '',
    subtitle: providerSubtitle(state),
    interactive: true,
    data: `data-account-calendar-open="${provider}"`,
    aria: `Открыть ${providerTitle(provider)}`,
  });
}

function showCalendarError(message) {
  openNotice({
    title: 'Календарь не синхронизирован',
    message: String(message || 'Не удалось выполнить действие с календарём.'),
    action: 'Закрыть',
    variant: 'technical',
  });
}

function calendarButtons(provider, state = {}) {
  const calendars = Array.isArray(state.calendars) ? state.calendars : [];
  if (!calendars.length) return '';
  return settingsPanel(calendars.map((calendar) => ({
    label: `${calendar.export ? '✓ ' : ''}${calendar.name}${calendar.writable ? '' : ' · только чтение'}`,
    data: `data-calendar-export="${provider}" data-calendar-id="${String(calendar.id || '')}"`,
    disabled: !calendar.writable,
  })));
}

function providerEditor(provider, state = {}) {
  const title = providerTitle(provider);
  if (state.connected) {
    const synced = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString('ru-RU') : '';
    return `<div class="form-grid" data-account-calendar-editor="${provider}">
      <div class="muted">${state.lastError ? `Ошибка: ${String(state.lastError)}` : synced ? `Синхронизировано ${synced}` : 'Подключено'}</div>
      ${calendarButtons(provider, state)}
      ${settingsPanel([
        { label: 'Синхронизировать', data: `data-calendar-sync="${provider}"` },
        { label: 'Отключить', data: `data-calendar-disconnect="${provider}"` },
      ])}
    </div>`;
  }
  if (!state.available) return emptyState('Связь недоступна', `${title} сейчас нельзя подключить.`);
  if (provider === 'google') {
    return settingsPanel([{ label: 'Подключить Google', data: 'data-calendar-google-connect' }]);
  }
  return `<form class="form-grid" data-calendar-yandex-form>
    ${field({ label: 'Логин Яндекса', name: 'login', autocomplete: 'username', required: true })}
    ${passwordField({ label: 'Пароль приложения Календаря', name: 'password', autocomplete: 'current-password', required: true })}
    ${settingsPanel([{ label: 'Подключить Яндекс', data: 'data-calendar-yandex-connect' }])}
    <div class="muted" data-calendar-form-status></div>
  </form>`;
}

async function openProvider(root, provider, initialState = {}) {
  let state = initialState;
  const layer = mountModal(document.body, modal(providerEditor(provider, state), {
    variant: 'x',
    title: providerTitle(provider),
    className: 'modal--form-sheet',
    xRole: 'editor',
  }));
  if (!layer) return null;

  const refreshBase = async () => {
    await renderAccountCalendarIntegrations(root);
  };
  const setBusy = (node, busy) => {
    if (!node) return;
    node.disabled = Boolean(busy);
    node.setAttribute('aria-busy', busy ? 'true' : 'false');
  };
  const reloadEditor = async () => {
    const status = await getAccountCalendarStatus();
    state = status?.[provider] || {};
    const body = layer.querySelector('[data-v2-q-body], .v2-layer__body, .modal-body') || layer;
    const editor = body.querySelector('[data-account-calendar-editor], [data-calendar-yandex-form], .app-empty-state, .app-settings-panel');
    if (editor) editor.outerHTML = providerEditor(provider, state);
    bind();
    await refreshBase();
  };

  const bind = () => {
    initPasswordFields(layer);
    layer.querySelector('[data-calendar-google-connect]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      try {
        setBusy(button, true);
        await beginGoogleCalendarConnection();
      } catch (error) {
        setBusy(button, false);
        showCalendarError(error instanceof Error ? error.message : 'Не удалось подключить Google Calendar.');
      }
    });

    const yandexForm = layer.querySelector('[data-calendar-yandex-form]');
    yandexForm?.querySelector('[data-calendar-yandex-connect]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const statusNode = yandexForm.querySelector('[data-calendar-form-status]');
      const formData = new FormData(yandexForm);
      try {
        setBusy(button, true);
        if (statusNode) statusNode.textContent = '';
        await connectYandexCalendar({ login: formData.get('login'), password: formData.get('password') });
        await reloadEditor();
      } catch (error) {
        if (statusNode) statusNode.textContent = error instanceof Error ? error.message : 'Не удалось подключить Яндекс Календарь.';
        setBusy(button, false);
      }
    });

    layer.querySelectorAll('[data-calendar-sync]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await syncAccountCalendars({ force: true });
        await reloadEditor();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось синхронизировать календарь.');
        setBusy(button, false);
      }
    }));

    layer.querySelectorAll('[data-calendar-disconnect]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await disconnectAccountCalendar(provider);
        layer.v2Close?.();
        await refreshBase();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось отключить календарь.');
        setBusy(button, false);
      }
    }));

    layer.querySelectorAll('[data-calendar-export]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await setAccountCalendarExport(provider, button.dataset.calendarId || '');
        await syncAccountCalendars({ force: true });
        await reloadEditor();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось выбрать календарь.');
        setBusy(button, false);
      }
    }));
  };

  bind();
  return layer;
}

export async function renderAccountCalendarIntegrations(root) {
  if (!root) return;
  root.innerHTML = `${workspaceHeaderContext({ title: 'Интеграции' })}<div data-account-calendar-list>${emptyState('Загрузка', 'Проверяем интеграции.')}</div>`;
  try {
    const status = await getAccountCalendarStatus();
    const providers = [];
    if (status?.google?.platformEnabled) providers.push(['google', status.google]);
    if (status?.yandex?.platformEnabled) providers.push(['yandex', status.yandex]);
    const host = root.querySelector('[data-account-calendar-list]');
    if (!host) return;
    host.innerHTML = providers.length
      ? miniCardRail(providers.map(([provider, state]) => providerMiniCard(provider, state)))
      : emptyState('Интеграции недоступны', 'Доступные подключения появятся здесь.');
    host.querySelectorAll('[data-account-calendar-open]').forEach((card) => card.addEventListener('click', () => {
      const provider = String(card.dataset.accountCalendarOpen || '');
      const state = status?.[provider] || {};
      void openProvider(root, provider, state);
    }));
  } catch (error) {
    root.innerHTML = `${workspaceHeaderContext({ title: 'Интеграции' })}${emptyState('Связь недоступна', error instanceof Error ? error.message : 'Не удалось проверить интеграции.')}`;
  }
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}
