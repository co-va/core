import {
  beginGoogleCalendarConnection,
  connectYandexCalendar,
  disconnectAccountCalendar,
  getAccountCalendarStatus,
  setAccountCalendarExport,
  syncAccountCalendars,
} from '../core/calendar-sync/account.js';
import {
  entityVisualCard,
  normalizeEntityCardAppearance,
  modal,
  mountModal,
  field,
  passwordField,
  initPasswordFields,
  escapeHtml,
  openNotice,
} from '../ui/ui.js';
import { settingsPanel } from '../ui/settings/index.js';

const INTEGRATIONS_CARD_APPEARANCE = normalizeEntityCardAppearance({
  lines: [
    {}, {}, {}, {}, {}, {},
    { field:'title', zone:'full', align:'left', size:'l', color:'white', bold:true },
    { field:'subtitle', zone:'full', align:'left', size:'m', color:'white' },
    {},
  ],
});

function text(value) { return escapeHtml(String(value ?? '')); }
function showCalendarError(message) {
  openNotice({
    title:'Календарь не синхронизирован',
    message:String(message || 'Не удалось выполнить действие с календарём.'),
    action:'Закрыть',
    variant:'technical',
  });
}

export function accountIntegrationsCard() {
  return entityVisualCard({
    appearance: INTEGRATIONS_CARD_APPEARANCE,
    fields: [
      { value:'title', label:'Раздел', text:'Интеграции' },
      { value:'subtitle', label:'Календари', text:'Google · Яндекс' },
    ],
    interactive: true,
    data: 'data-account-integrations-card',
    aria: 'Открыть интеграции календарей',
  });
}

function calendarButtons(provider, state = {}) {
  const calendars = Array.isArray(state.calendars) ? state.calendars : [];
  if (!calendars.length) return '';
  return `<div data-calendar-list="${text(provider)}">${calendars.map((calendar) => {
    const prefix = calendar.export ? '✓ ' : '';
    const suffix = calendar.writable ? '' : ' · только чтение';
    return `<button type="button" class="app-settings-panel__button" data-calendar-export="${text(provider)}" data-calendar-id="${text(calendar.id)}"${calendar.writable ? '' : ' disabled'}>${text(`${prefix}${calendar.name}${suffix}`)}</button>`;
  }).join('')}</div>`;
}

function providerMarkup(provider, state = {}) {
  const title = provider === 'google' ? 'Google Calendar' : 'Яндекс Календарь';
  if (!state.available) {
    return `<section><strong>${text(title)}</strong>${settingsPanel([{ label: `${title} — недоступно`, disabled: true }])}</section>`;
  }
  if (state.connected) {
    const status = state.lastError
      ? `Ошибка: ${state.lastError}`
      : state.lastSyncAt ? `Синхронизировано ${new Date(state.lastSyncAt).toLocaleString('ru-RU')}` : 'Подключено';
    return `<section data-calendar-provider="${text(provider)}"><strong>${text(title)}</strong><div class="muted">${text(state.label || status)}</div><div class="muted">${text(status)}</div>${calendarButtons(provider, state)}${settingsPanel([
      { label:'Синхронизировать', data:`data-calendar-sync="${text(provider)}"` },
      { label:'Отключить', data:`data-calendar-disconnect="${text(provider)}"` },
    ])}</section>`;
  }
  if (provider === 'google') {
    return `<section data-calendar-provider="google"><strong>${text(title)}</strong>${settingsPanel([{ label:'Подключить Google', data:'data-calendar-google-connect' }])}</section>`;
  }
  return `<section data-calendar-provider="yandex"><strong>${text(title)}</strong><form data-calendar-yandex-form>${field({ label:'Логин Яндекса', name:'login', autocomplete:'username', required:true })}${passwordField({ label:'Пароль приложения Календаря', name:'password', autocomplete:'current-password', required:true })}${settingsPanel([{ label:'Подключить Яндекс', data:'data-calendar-yandex-connect' }])}<div class="muted" data-calendar-form-status></div></form></section>`;
}

function contentMarkup(status = {}) {
  return `<div class="calendar-integrations-content" data-calendar-integrations-content>${providerMarkup('google', status.google || {})}${providerMarkup('yandex', status.yandex || {})}</div>`;
}

export async function openAccountCalendarIntegrations() {
  let status = await getAccountCalendarStatus();
  const layer = mountModal(document.body, modal(contentMarkup(status), { variant:'q', title:'Интеграции' }));

  const redraw = () => {
    const current = layer?.querySelector('[data-calendar-integrations-content]');
    if (current) current.outerHTML = contentMarkup(status);
    bind();
  };

  const reload = async () => {
    status = await getAccountCalendarStatus();
    redraw();
  };

  const setBusy = (node, busy) => {
    if (!node) return;
    node.disabled = Boolean(busy);
    node.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  const bind = () => {
    initPasswordFields(layer);
    layer?.querySelector('[data-calendar-google-connect]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      try {
        setBusy(button, true);
        await beginGoogleCalendarConnection();
      } catch (error) {
        setBusy(button, false);
        showCalendarError(error instanceof Error ? error.message : 'Не удалось подключить Google Calendar.');
      }
    });

    const yandexForm = layer?.querySelector('[data-calendar-yandex-form]');
    yandexForm?.querySelector('[data-calendar-yandex-connect]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const statusNode = yandexForm.querySelector('[data-calendar-form-status]');
      const formData = new FormData(yandexForm);
      try {
        setBusy(button, true);
        if (statusNode) statusNode.textContent = '';
        await connectYandexCalendar({ login: formData.get('login'), password: formData.get('password') });
        await reload();
      } catch (error) {
        if (statusNode) statusNode.textContent = error instanceof Error ? error.message : 'Не удалось подключить Яндекс Календарь.';
        setBusy(button, false);
      }
    });

    layer?.querySelectorAll('[data-calendar-sync]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await syncAccountCalendars({ force:true });
        await reload();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось синхронизировать календарь.');
        setBusy(button, false);
      }
    }));

    layer?.querySelectorAll('[data-calendar-disconnect]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await disconnectAccountCalendar(button.dataset.calendarDisconnect || '');
        await reload();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось отключить календарь.');
        setBusy(button, false);
      }
    }));

    layer?.querySelectorAll('[data-calendar-export]').forEach((button) => button.addEventListener('click', async () => {
      try {
        setBusy(button, true);
        await setAccountCalendarExport(button.dataset.calendarExport || '', button.dataset.calendarId || '');
        await syncAccountCalendars({ force:true });
        await reload();
      } catch (error) {
        showCalendarError(error instanceof Error ? error.message : 'Не удалось выбрать календарь.');
        setBusy(button, false);
      }
    }));
  };

  bind();
  return layer;
}

export function bindAccountIntegrationsCard(root) {
  root?.querySelector('[data-account-integrations-card]')?.addEventListener('click', () => {
    void openAccountCalendarIntegrations().catch((error) => {
      showCalendarError(error instanceof Error ? error.message : 'Не удалось открыть интеграции.');
    });
  });
}
