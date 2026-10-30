import {
  getNotificationCatalog,
  getNotificationDeliveryRouting,
  getNotificationRouting,
  getNotificationServiceRouting,
  saveNotificationDeliveryRouting,
  saveNotificationRouting,
  setNotificationEnabled,
  setNotificationServiceEnabled,
} from '../../core/notifications/routing.js';
import {
  button,
  emptyState,
  escapeHtml,
  field,
  modal,
  mountModal,
  mountV2ZLayer,
  page,
  select,
  smallActionButton,
  textareaField,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { messageBubble } from '../../ui/chat/index.js';

const EXTERNAL_CHANNEL_OPTIONS = Object.freeze([
  { value: 'TELEGRAM', label: 'Telegram' },
  { value: 'EMAIL', label: 'Email' },
  { value: '', label: 'Не использовать' },
]);

const ROUTING_MODE_OPTIONS = Object.freeze([
  { value: 'always', label: 'Во все выбранные каналы' },
  { value: 'fallback', label: 'По очереди, если предыдущий не доставлен' },
]);

const PREVIEW_VALUES = Object.freeze({
  date: '18 октября',
  time: '14:30',
  workplace: 'Рабочее пространство',
  amount: '5 000 ₽',
  document: 'Согласие на обработку данных',
  person: { name: 'Александр', surname: 'Иванов' },
});

function text(value = '') {
  return String(value ?? '').trim();
}

function policyFor(routing, event) {
  const source = Array.isArray(routing) ? routing.find((item) => item?.eventType === event.type) : null;
  return {
    enabled: source?.enabled === true,
    titleTemplate: text(source?.titleTemplate) || text(event.defaultTitle) || event.title,
    bodyTemplate: text(source?.bodyTemplate) || text(event.defaultBody),
  };
}

function externalChannelValues(policy = {}) {
  const values = [];
  for (const value of Array.isArray(policy.channels) ? policy.channels : []) {
    const channel = String(value || '').trim().toUpperCase();
    if (!['TELEGRAM', 'EMAIL'].includes(channel) || values.includes(channel)) continue;
    values.push(channel);
  }
  while (values.length < 2) values.push('');
  return values.slice(0, 2);
}

function selectedExternalChannels(form) {
  const data = new FormData(form);
  const values = ['channel1', 'channel2']
    .map((name) => String(data.get(name) || '').trim().toUpperCase())
    .filter((value) => ['TELEGRAM', 'EMAIL'].includes(value));
  return [...new Set(values)];
}

function openPushInfo() {
  const content = '<div class="modal-title"><h2>Push</h2><p>Push отправляется всегда отдельно. Последовательность применяется только к Telegram и Email.</p></div>';
  return mountModal(document.body, modal(content, {
    title: 'О Push',
    variant: 's',
    surface: 'app',
  }));
}

async function openDeliverySettings() {
  const policy = await getNotificationDeliveryRouting();
  const channels = externalChannelValues(policy);
  const pushInfo = `<div class="field-inline-label"><span>Push — всегда</span>${smallActionButton({
    icon: 'info',
    data: 'data-notification-push-info',
    aria: 'О Push',
  })}</div>`;
  const body = `<div data-notification-delivery-settings>
    <form class="form-grid" data-notification-delivery-form>
      ${pushInfo}
      ${select({
        label: 'Порядок отправки',
        name: 'mode',
        value: policy?.mode === 'fallback' ? 'fallback' : 'always',
        options: ROUTING_MODE_OPTIONS,
      })}
      ${select({ label: 'Канал 1', name: 'channel1', value: channels[0], options: EXTERNAL_CHANNEL_OPTIONS })}
      ${select({ label: 'Канал 2', name: 'channel2', value: channels[1], options: EXTERNAL_CHANNEL_OPTIONS })}
      <div class="muted" data-notification-delivery-status aria-live="polite"></div>
      ${button('Сохранить', { type: 'submit' })}
    </form>
  </div>`;
  const layer = mountModal(document.body, modal(body, {
    title: 'Настройки уведомлений',
    variant: 'x',
    className: 'modal--form-sheet',
  }));
  if (!layer) return null;

  layer.querySelector('[data-notification-push-info]')?.addEventListener('click', openPushInfo);
  const form = layer.querySelector('[data-notification-delivery-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const status = layer.querySelector('[data-notification-delivery-status]');
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Сохраняем…';
    try {
      const data = new FormData(form);
      await saveNotificationDeliveryRouting({
        mode: String(data.get('mode') || 'always'),
        channels: ['PUSH', ...selectedExternalChannels(form)],
      });
      layer.v2Close?.();
    } catch (error) {
      if (submit) submit.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
    }
  });
  return layer;
}

function renderTemplate(template, values = PREVIEW_VALUES) {
  return String(template || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = String(path || '').split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : '', values);
    return String(value ?? '');
  });
}

function previewMarkup(titleTemplate, bodyTemplate) {
  const title = renderTemplate(titleTemplate);
  const body = renderTemplate(bodyTemplate);
  return `<div data-notification-preview>${messageBubble({
    direction: 'outbound',
    body: [title, body].filter(Boolean).join('\n\n'),
  }, { viewer: 'profile' })}</div>`;
}

function editorSignature(form) {
  if (!form) return '';
  const data = new FormData(form);
  return JSON.stringify([
    String(data.get('titleTemplate') || ''),
    String(data.get('bodyTemplate') || ''),
  ]);
}

function editorMarkup(event, current) {
  const variableText = (Array.isArray(event.variables) ? event.variables : [])
    .map((value) => `{{${escapeHtml(value)}}}`)
    .join(', ');
  return `${workspaceHeaderContext({ title: event.title })}
    ${v2Section('Предпросмотр', previewMarkup(current.titleTemplate, current.bodyTemplate))}
    ${v2Section('Сообщение', `
      <form class="form-grid" data-notification-policy-form>
        ${field({ label: 'Заголовок сообщения', name: 'titleTemplate', value: current.titleTemplate, required: true })}
        ${textareaField({ label: 'Текст сообщения', name: 'bodyTemplate', value: current.bodyTemplate, rows: 7, required: true })}
        ${variableText ? `<div class="muted">Доступно: ${variableText}</div>` : ''}
        <div class="muted" data-notification-editor-status aria-live="polite"></div>
        <button type="button" class="v2-workspace-source-hidden" data-v2-primary-action data-v2-primary-label="Сохранить" data-v2-primary-visible="false" aria-label="Сохранить сообщение">Сохранить</button>
      </form>
    `)}`;
}

function openEditor(root, routing, event) {
  const current = policyFor(routing, event);
  const layer = mountV2ZLayer(root, v2ZLayer(editorMarkup(event, current), { className: 'notification-editor-z' }), { stack: true });
  if (!layer) return null;

  const form = layer.querySelector('[data-notification-policy-form]');
  const preview = layer.querySelector('[data-notification-preview]');
  const primary = layer.querySelector('[data-v2-primary-action]');
  const status = layer.querySelector('[data-notification-editor-status]');
  const initial = editorSignature(form);

  const redraw = () => {
    if (!form) return;
    const data = new FormData(form);
    if (preview) {
      preview.innerHTML = messageBubble({
        direction: 'outbound',
        body: [
          renderTemplate(data.get('titleTemplate')),
          renderTemplate(data.get('bodyTemplate')),
        ].filter(Boolean).join('\n\n'),
      }, { viewer: 'profile' });
    }
    if (primary) primary.dataset.v2PrimaryVisible = editorSignature(form) !== initial ? 'true' : 'false';
    window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  };

  form?.addEventListener('input', redraw);
  primary?.addEventListener('click', () => form?.requestSubmit());
  form?.addEventListener('submit', async (submitEvent) => {
    submitEvent.preventDefault();
    if (!form) return;
    if (primary) primary.disabled = true;
    if (status) status.textContent = 'Сохраняем…';
    const data = new FormData(form);
    try {
      await saveNotificationRouting(event.type, {
        titleTemplate: data.get('titleTemplate'),
        bodyTemplate: data.get('bodyTemplate'),
      });
      layer.v2Close?.();
      await render(root);
    } catch (error) {
      if (primary) primary.disabled = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Не удалось сохранить сообщение';
      window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
    }
  });
  redraw();
  return layer;
}

function groupedEvents(catalog = []) {
  const groups = new Map();
  for (const event of Array.isArray(catalog) ? catalog : []) {
    const group = text(event?.group) || 'Другие';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(event);
  }
  return groups;
}

function eventRow(event, policy) {
  return `<div class="app-notification-row" data-notification-row="${escapeHtml(event.type)}">
    <input type="checkbox" data-notification-enabled="${escapeHtml(event.type)}" aria-label="Отправлять: ${escapeHtml(event.title)}" ${policy.enabled ? 'checked' : ''}>
    <span data-notification-open="${escapeHtml(event.type)}" role="button" tabindex="0" aria-label="Редактировать: ${escapeHtml(event.title)}">
      <strong>${escapeHtml(event.title)}</strong>
      ${event.description ? `<small>${escapeHtml(event.description)}</small>` : ''}
    </span>
  </div>`;
}

function serviceControlMarkup(policy) {
  return v2Section('Сервисные уведомления', `<div class="app-notification-list">
    <div class="app-notification-row">
      <input type="checkbox" data-notification-service-enabled aria-label="Все сервисные уведомления" ${policy?.enabled !== false ? 'checked' : ''}>
      <span>
        <strong>Все сервисные уведомления</strong>
        <small>Общее включение и выключение SERVICE</small>
      </span>
    </div>
  </div>`);
}

function catalogMarkup(catalog, routing) {
  return [...groupedEvents(catalog).entries()].map(([group, events]) => v2Section(
    group,
    `<div class="app-notification-list">${events.map((event) => eventRow(event, policyFor(routing, event))).join('')}</div>`,
  )).join('');
}

function bindCatalog(root, host, catalog, routing, servicePolicy) {
  const byType = new Map(catalog.map((event) => [event.type, event]));
  const serviceToggle = host.querySelector('[data-notification-service-enabled]');
  const eventToggles = [...host.querySelectorAll('[data-notification-enabled]')];

  const syncServiceState = () => {
    const enabled = serviceToggle?.checked !== false;
    eventToggles.forEach((checkbox) => {
      checkbox.disabled = !enabled;
    });
  };

  serviceToggle?.addEventListener('change', async () => {
    const previous = !serviceToggle.checked;
    serviceToggle.disabled = true;
    try {
      const saved = await setNotificationServiceEnabled(serviceToggle.checked);
      servicePolicy.enabled = saved?.enabled !== false;
      serviceToggle.checked = servicePolicy.enabled;
    } catch {
      serviceToggle.checked = previous;
    } finally {
      serviceToggle.disabled = false;
      syncServiceState();
    }
  });

  eventToggles.forEach((checkbox) => {
    checkbox.addEventListener('click', (event) => event.stopPropagation());
    checkbox.addEventListener('change', async () => {
      const type = checkbox.dataset.notificationEnabled || '';
      const previous = !checkbox.checked;
      checkbox.disabled = true;
      try {
        const saved = await setNotificationEnabled(type, checkbox.checked);
        const policy = routing.find((item) => item?.eventType === type);
        if (policy) policy.enabled = saved?.enabled === true;
        else routing.push(saved);
      } catch {
        checkbox.checked = previous;
      } finally {
        checkbox.disabled = serviceToggle?.checked === false;
      }
    });
  });

  const open = (node) => {
    const event = byType.get(node.dataset.notificationOpen || '');
    if (event) openEditor(root, routing, event);
  };
  host.querySelectorAll('[data-notification-open]').forEach((node) => {
    node.addEventListener('click', () => open(node));
    node.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      open(node);
    });
  });

  syncServiceState();
}

export async function render(root) {
  root.innerHTML = page([
    workspaceHeaderContext({
      title: 'Уведомления',
      v: {
        data: 'data-notification-delivery-settings-open',
        aria: 'Настройки доставки уведомлений',
      },
    }),
    '<div data-notification-routing></div>',
  ]);
  root.querySelector('[data-notification-delivery-settings-open]')?.addEventListener('click', () => void openDeliverySettings());

  const host = root.querySelector('[data-notification-routing]');
  if (host) host.innerHTML = emptyState('Загрузка', 'Загружаем уведомления.');

  try {
    const [catalog, routing, servicePolicy] = await Promise.all([
      getNotificationCatalog(),
      getNotificationRouting(),
      getNotificationServiceRouting(),
    ]);
    if (!host) return;
    host.innerHTML = `${serviceControlMarkup(servicePolicy)}${catalogMarkup(catalog, routing)}`;
    bindCatalog(root, host, catalog, routing, servicePolicy);
  } catch (error) {
    if (host) host.innerHTML = emptyState('Настройки недоступны', error instanceof Error ? error.message : 'Не удалось загрузить уведомления.');
  }
}
