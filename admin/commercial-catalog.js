import { apiRequest } from '../core/auth.js';

let catalogCache = null;
let catalogPromise = null;
let toolReadinessCache = [];
let toolReadinessPromise = null;
let accountToolsCache = [];

const READINESS = Object.freeze({
  NOT_READY: 'Не готово',
  TESTING: 'Проверка',
  READY: 'Готово',
});

export const TOOL_MAP = Object.freeze({
  cabinet: [
    { id: 'people', label: 'Клиенты', readinessKey: 'cabinet.people' },
    {
      id: 'journal', label: 'Журнал', nesting: 'modes', items: [
        { label: 'День', kind: 'mode', readinessKey: 'cabinet.journal.day', items: [
          { label: 'События', kind: 'check', readinessKey: 'cabinet.journal.day.events' },
          { label: 'Заметки', kind: 'check', readinessKey: 'cabinet.journal.day.notes' },
          { label: 'Запись', kind: 'check', readinessKey: 'cabinet.journal.day.record' },
        ] },
        { label: 'Месяц', kind: 'mode', readinessKey: 'cabinet.journal.month' },
        { label: 'График (режим месяца)', kind: 'mode', readinessKey: 'cabinet.timetable' },
        { label: 'Список', kind: 'mode', readinessKey: 'cabinet.journal.list' },
      ],
    },
    {
      id: 'profile', label: 'Профиль', nesting: 'composition', items: [
        { label: 'Данные профиля', kind: 'composition', readinessKey: 'cabinet.profile.data' },
        { label: 'Рабочие пространства', kind: 'composition', readinessKey: 'cabinet.profile.workspaces' },
      ],
    },
    {
      id: 'service', label: 'Сервис', nesting: 'modes', capabilityKey: 'services.access', items: [
        { label: 'Процедуры', kind: 'mode', readinessKey: 'cabinet.service.procedures' },
        { label: 'Товары', kind: 'mode', readinessKey: 'cabinet.service.products' },
      ],
    },
    {
      id: 'loyalty', label: 'Лояльность', nesting: 'e', items: [
        { label: 'Депозит', kind: 'e', readinessKey: 'cabinet.loyalty.deposit' },
        { label: 'Личный счёт', kind: 'e', readinessKey: 'cabinet.loyalty.personal-account' },
        { label: 'Сертификат', kind: 'e', readinessKey: 'cabinet.loyalty.certificate' },
        { label: 'Абонемент', kind: 'e', readinessKey: 'cabinet.loyalty.subscription' },
        { label: 'Реферальная программа', kind: 'e', readinessKey: 'cabinet.loyalty.referral' },
        { label: 'Бонусная программа', kind: 'e', readinessKey: 'cabinet.loyalty.bonus' },
      ],
    },
    {
      id: 'finance', label: 'Финансы', nesting: 'e', items: [
        { label: 'Касса', kind: 'e', nesting: 'composition', items: [
          { label: 'Кошельки', kind: 'composition', readinessKey: 'cabinet.finance.cash.wallets' },
          { label: 'Займы', kind: 'composition', readinessKey: 'cabinet.finance.cash.loans' },
          { label: 'Инвестиции', kind: 'composition', readinessKey: 'cabinet.finance.cash.investments' },
        ] },
        { label: 'ДДС', kind: 'e', readinessKey: 'cabinet.finance.dds' },
        { label: 'Z-отчёт', kind: 'e', readinessKey: 'cabinet.finance.z-report' },
      ],
    },
    {
      id: 'inventory', label: 'Склад', nesting: 'e', items: [
        { label: 'Остатки', kind: 'e', readinessKey: 'cabinet.inventory.stock' },
        { label: 'Движения', kind: 'e', readinessKey: 'cabinet.inventory.movements' },
        { label: 'Заказ', kind: 'e', readinessKey: 'cabinet.inventory.order' },
        { label: 'Инвентаризация', kind: 'e', readinessKey: 'cabinet.inventory.stocktake' },
      ],
    },
    {
      id: 'settings', label: 'Настройки', nesting: 'e', items: [
        { label: 'Перенос данных', kind: 'e', readinessKey: 'cabinet.settings.data-transfer' },
        { label: 'Онлайн-запись', kind: 'e', readinessKey: 'cabinet.settings.online-booking' },
        { label: 'Уведомления', kind: 'e', readinessKey: 'cabinet.settings.notifications' },
        { label: 'Интеграции', kind: 'e', readinessKey: 'cabinet.settings.integrations' },
        { label: 'Документы', kind: 'e', readinessKey: 'cabinet.settings.documents' },
        { label: 'Ярлыки', kind: 'e', readinessKey: 'cabinet.settings.tags' },
      ],
    },
    { id: 'chat', label: 'Чат', readinessKey: 'cabinet.chat' },
  ],
  records: [
    { id: 'profile', label: 'Профиль', readinessKey: 'records.profile' },
    {
      id: 'journal', label: 'Журнал', nesting: 'modes', items: [
        { label: 'День', kind: 'mode', readinessKey: 'records.journal.day', items: [
          { label: 'События', kind: 'check', readinessKey: 'records.journal.day.events' },
          { label: 'Заметки', kind: 'check', readinessKey: 'records.journal.day.notes' },
          { label: 'Запись', kind: 'check', readinessKey: 'records.journal.day.record' },
        ] },
        { label: 'Месяц', kind: 'mode', readinessKey: 'records.journal.month' },
        { label: 'Список', kind: 'mode', readinessKey: 'records.journal.list' },
      ],
    },
    { id: 'contacts', label: 'Контакты', readinessKey: 'records.contacts' },
    {
      id: 'integrations', label: 'Интеграции', nesting: 'e', items: [
        { label: 'Google Календарь', kind: 'check', readinessKey: 'records.integrations.google-calendar', accountToolKey: 'account.calendar.google' },
        { label: 'Яндекс Календарь', kind: 'check', readinessKey: 'records.integrations.yandex-calendar', accountToolKey: 'account.calendar.yandex' },
      ],
    },
    { id: 'chat', label: 'Чат', readinessKey: 'records.chat' },
  ],
});

// The product on the right is a commercial condition for an existing tool row,
// not an additional tool or an independently rendered list.
export const TOOL_COMMERCIAL_BINDINGS = Object.freeze({
  'cabinet.profile.workspaces': 'capacity.workplace.extra',
  'cabinet.finance': 'folder.finance',
  'cabinet.finance.cash': 'tool.finance.cash',
  'cabinet.finance.dds': 'tool.finance.dds',
  'cabinet.finance.cash.investments': 'tool.finance.investment',
  'cabinet.finance.z-report': 'tool.finance.z-report',
  'cabinet.inventory': 'tool.inventory',
});

// Binding to the existing capability model. Catalog hierarchy and labels stay owned by TOOL_MAP.
export const TOOL_CAPABILITY_BINDINGS = Object.freeze({
  'cabinet.people': ['people.access'],
  'cabinet.profile.data': ['profile.access'],
  'cabinet.journal.day': ['journal.day.access'],
  'cabinet.journal.month': ['journal.month.access'],
  'cabinet.timetable': ['timetable.access'],
  'cabinet.journal.list': ['journal.list.access'],
  'cabinet.profile.workspaces': ['workplaces.access', 'workplaces.max'],
  'cabinet.loyalty.deposit': ['loyalty.deposit.access'],
  'cabinet.loyalty.personal-account': ['loyalty.personal_account.access'],
  'cabinet.loyalty.certificate': ['loyalty.certificate.access'],
  'cabinet.loyalty.subscription': ['loyalty.subscription.access'],
  'cabinet.loyalty.referral': ['loyalty.referral.access'],
  'cabinet.loyalty.bonus': ['loyalty.bonus.access'],
  'cabinet.inventory.stock': ['inventory.stock.access'],
  'cabinet.inventory.movements': ['inventory.movements.access'],
  'cabinet.inventory.order': ['inventory.order.access'],
  'cabinet.inventory.stocktake': ['inventory.stocktake.access'],
  'cabinet.settings.data-transfer': ['data_transfer.access'],
  'cabinet.service': ['services.access'],
  'cabinet.chat': ['chat.access'],
  'cabinet.finance.cash.wallets': ['finance.cash.access'],
  'cabinet.finance.cash.loans': ['finance.special.access'],
  'cabinet.finance.cash.investments': ['finance.investment.self.access', 'finance.investment.raise.access', 'finance.investment.external.access'],
  'cabinet.finance.dds': ['finance.dds.access', 'finance.income_expense.access', 'finance.articles.access'],
  'cabinet.finance.z-report': ['finance.z_report.access'],
  'cabinet.settings.online-booking': ['online_booking.access'],
  'cabinet.settings.notifications': ['notifications.access'],
  'cabinet.settings.integrations': ['integrations.access'],
  'cabinet.settings.documents': ['documents.access'],
  'cabinet.settings.tags': ['tags.access'],
});

const TYPE_LABELS = Object.freeze({
  SYSTEM: 'Системное',
  TOOL: 'Инструмент',
  FOLDER: 'Папка',
  PACKAGE: 'Пакет',
  CAPACITY: 'Ёмкость',
  ADDON: 'Дополнение',
});

const EVENT_LABELS = Object.freeze({
  CATALOG_PRODUCT_UPDATED: 'Изменены коммерческие условия',
  CATALOG_PACKAGE_CREATED: 'Создан пакет',
  CATALOG_PUBLISHED: 'Опубликована версия каталога',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

async function jsonRequest(path, options = {}) {
  const response = await apiRequest(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка панели управления');
  return payload;
}

function commercialRequest(path = '', options = {}) {
  return jsonRequest(`/saas-admin/commercial-catalog${path}`, options);
}

function toolReadinessRequest(path = '', options = {}) {
  return jsonRequest(`/saas-admin/tool-readiness${path}`, options);
}

function accountToolsRequest(path = '', options = {}) {
  return jsonRequest(`/saas-admin/account-tools${path}`, options);
}

async function loadCatalog() {
  if (catalogCache) return catalogCache;
  if (!catalogPromise) {
    catalogPromise = commercialRequest()
      .then((catalog) => {
        catalogCache = catalog;
        return catalog;
      })
      .finally(() => { catalogPromise = null; });
  }
  return catalogPromise;
}

async function loadToolReadiness() {
  if (toolReadinessCache.length) return toolReadinessCache;
  if (!toolReadinessPromise) {
    toolReadinessPromise = toolReadinessRequest()
      .then((items) => {
        toolReadinessCache = Array.isArray(items) ? items : [];
        return toolReadinessCache;
      })
      .finally(() => { toolReadinessPromise = null; });
  }
  return toolReadinessPromise;
}

function readinessByKey(items = []) {
  return new Map((Array.isArray(items) ? items : []).map((item) => [String(item.key || ''), item]));
}

function readinessValue(item) {
  const value = String(item?.status || 'NOT_READY');
  return READINESS[value] ? value : 'NOT_READY';
}

function structureLabel(item) {
  const count = Array.isArray(item.items) ? item.items.length : 0;
  if (!count) return '';
  if (item.nesting === 'e') return `E × ${count}`;
  if (item.nesting === 'modes') return `Режимы × ${count}`;
  if (item.nesting === 'composition') return `Состав × ${count}`;
  return '';
}

function childKindLabel(item) {
  if (item.kind === 'e') return 'E';
  if (item.kind === 'mode') return 'Режим';
  return '';
}

function readinessOptions(value) {
  return Object.entries(READINESS)
    .map(([key, label]) => `<option value="${key}"${key === value ? ' selected' : ''}>${escapeHtml(label)}</option>`)
    .join('');
}

function readinessSelect(readinessKey, byKey, className) {
  const value = readinessValue(byKey.get(readinessKey));
  return `<span class="admin-tool-readiness-editor"><select class="${className} admin-tool-readiness-select" data-readiness-key="${escapeHtml(readinessKey)}" data-previous="${value}" title="Статус управляет доступом">${readinessOptions(value)}</select></span>`;
}

function aggregateKeys(item) {
  // Parent count follows its immediate children: Finance is E × 3, whereas
  // Cash is Composition × 3. A nested E counts ready when any member is ready.
  return (item.items || []).map((child) => child.readinessKey ||
    (child.items?.length ? aggregateKeys(child).join(',') : null)).filter(Boolean);
}

function isReadinessGroupReady(keyGroup, byKey) {
  return String(keyGroup).split(',').some((key) => readinessValue(byKey.get(key)) === 'READY');
}

function aggregateStatus(item, byKey) {
  const keys = aggregateKeys(item);
  const ready = keys.filter((key) => isReadinessGroupReady(key, byKey)).length;
  return { ready, total: keys.length, keys };
}

function childRow(child, byKey) {
  if (Array.isArray(child.items) && child.items.length) {
    const count = aggregateStatus(child, byKey);
    return `<details class="admin-tool-child-composition">
      <summary class="admin-tool-child admin-tool-child--summary">
        <span class="admin-tool-child-mark">${escapeHtml(childKindLabel(child))}</span>
        <span class="admin-tool-child-name">${escapeHtml(child.label)}</span>
        <span class="admin-tool-child-type">${escapeHtml(structureLabel(child))}</span>
        <span class="admin-tool-readiness" data-readiness-count="${count.total}" data-readiness-keys="${escapeHtml(count.keys.join('|'))}">${count.ready}/${count.total} готово</span>
        <span class="admin-tool-child-arrow" aria-hidden="true">⌄</span>
      </summary>
      <div class="admin-tool-grandchildren">${child.items.map((nested) => childRow(nested, byKey)).join('')}</div>
    </details>`;
  }
  const availability = child.accountToolKey
    ? `<label class="admin-tool-account-control"><input type="checkbox" data-account-tool="${escapeHtml(child.accountToolKey)}" disabled><span data-account-tool-state>—</span></label>`
    : '';
  return `<div class="admin-tool-child">
    <span class="admin-tool-child-mark">${escapeHtml(childKindLabel(child))}</span>
    <span class="admin-tool-child-name">${escapeHtml(child.label)}</span>
    <span class="admin-tool-child-type">${availability}</span>
    ${readinessSelect(child.readinessKey, byKey, 'admin-tool-child-status')}
    <span class="admin-tool-child-arrow"></span>
  </div>`;
}

function toolStatus(item, byKey, compact = false) {
  const items = Array.isArray(item.items) ? item.items : [];
  if (items.length) {
    const aggregate = aggregateStatus(item, byKey);
    const fullStatus = `${aggregate.ready}/${aggregate.total} готово`;
    return `<span class="admin-tool-readiness" data-readiness-count="${aggregate.total}" data-readiness-keys="${escapeHtml(aggregate.keys.join('|'))}" title="${fullStatus}">${compact ? `${aggregate.ready}/${aggregate.total}` : fullStatus}</span>`;
  }
  return readinessSelect(item.readinessKey, byKey, 'admin-tool-readiness');
}

function toolRow(item, byKey) {
  const items = Array.isArray(item.items) ? item.items : [];
  const type = structureLabel(item);
  const status = toolStatus(item, byKey);

  if (!items.length) {
    return `<div class="admin-tool-row admin-tool-row--leaf">
      <span class="admin-tool-mark">F</span>
      <strong class="admin-tool-name">${escapeHtml(item.label)}</strong>
      <span class="admin-tool-type"></span>
      ${status}
      <span class="admin-tool-arrow"></span>
    </div>`;
  }

  return `<details class="admin-tool-row admin-tool-row--expandable">
    <summary class="admin-tool-summary">
      <span class="admin-tool-mark">F</span>
      <strong class="admin-tool-name">${escapeHtml(item.label)}</strong>
      <span class="admin-tool-type">${escapeHtml(type)}</span>
      ${status}
      <span class="admin-tool-arrow" aria-hidden="true">⌄</span>
    </summary>
    <div class="admin-tool-children">${items.map((child) => childRow(child, byKey)).join('')}</div>
  </details>`;
}

function renderArchitecture(area, readiness = []) {
  const byKey = readinessByKey(readiness);
  const rows = TOOL_MAP[area] || TOOL_MAP.cabinet;
  return `<div class="admin-tool-map" data-admin-tool-map="${escapeHtml(area)}">${rows.map((item) => toolRow(item, byKey)).join('')}</div>`;
}

function hydrateReadiness(root, items = []) {
  const byKey = readinessByKey(items);
  root.querySelectorAll('[data-readiness-key]').forEach((select) => {
    const value = readinessValue(byKey.get(String(select.dataset.readinessKey || '')));
    select.value = value;
    select.dataset.previous = value;
    select.disabled = false;
    select.title = 'Статус управляет доступом';
  });
  root.querySelectorAll('[data-readiness-count]').forEach((node) => {
    const total = Number(node.dataset.readinessCount || 0);
    const keys = String(node.dataset.readinessKeys || '').split('|').filter(Boolean);
    const ready = keys.filter((key) => isReadinessGroupReady(key, byKey)).length;
    node.title = `${ready}/${total} готово`;
    node.textContent = node.closest('.admin-tool-register-table')
      ? `${ready}/${total}` : node.title;
  });
}

function hydrateAllReadiness(content, items = []) {
  content.querySelectorAll('[data-admin-tool-map]').forEach((root) => hydrateReadiness(root, items));
}

function hydrateAccountTools(content, tools = []) {
  accountToolsCache = Array.isArray(tools) ? tools : [];
  const byKey = new Map(accountToolsCache.map((tool) => [String(tool.key || ''), tool]));
  content.querySelectorAll('[data-account-tool]').forEach((input) => {
    const tool = byKey.get(String(input.dataset.accountTool || ''));
    const state = input.closest('.admin-tool-account-control')?.querySelector('[data-account-tool-state]');
    input.checked = Boolean(tool?.enabled);
    input.disabled = !tool;
    input.dataset.previous = String(Boolean(tool?.enabled));
    if (state) state.textContent = tool ? (tool.enabled ? 'Включено' : 'Выключено') : 'Недоступно';
  });
}

function bindReadiness(content) {
  content.querySelectorAll('[data-readiness-key]').forEach((select) => {
    select.addEventListener('click', (event) => event.stopPropagation());
    select.addEventListener('change', async () => {
      const key = String(select.dataset.readinessKey || '');
      if (!key) return;
      const previous = String(select.dataset.previous || 'NOT_READY');
      const next = String(select.value || 'NOT_READY');
      select.disabled = true;
      try {
        const items = await toolReadinessRequest(`/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });
        toolReadinessCache = Array.isArray(items) ? items : [];
        hydrateAllReadiness(content, toolReadinessCache);
        document.dispatchEvent(new CustomEvent('admin:tool-readiness-changed'));
      } catch (error) {
        select.value = previous;
        select.dataset.previous = previous;
        select.title = error instanceof Error ? error.message : 'Не удалось изменить статус';
      } finally {
        if (select.isConnected) select.disabled = false;
      }
    });
  });
}

function bindAccountTools(content) {
  content.querySelectorAll('[data-account-tool]').forEach((input) => {
    input.addEventListener('change', async () => {
      const key = String(input.dataset.accountTool || '');
      if (!key) return;
      const previous = input.dataset.previous === 'true';
      const state = input.closest('.admin-tool-account-control')?.querySelector('[data-account-tool-state]');
      input.disabled = true;
      if (state) state.textContent = 'Сохраняем…';
      try {
        const result = await accountToolsRequest(`/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: input.checked }),
        });
        input.checked = Boolean(result?.enabled);
        input.dataset.previous = String(Boolean(result?.enabled));
        if (state) state.textContent = result?.enabled ? 'Включено' : 'Выключено';
      } catch (error) {
        input.checked = previous;
        if (state) state.textContent = error instanceof Error ? error.message : 'Ошибка';
      } finally {
        input.disabled = false;
      }
    });
  });
}

function bindArchitecture(content) {
  bindReadiness(content);
  bindAccountTools(content);
}

// Tools are one flat, document-style registry. F/E are structural labels, not separate folders.
const INLINE_COMMERCIAL_KEYS = Object.freeze({
  'cabinet.people': 'tool.people',
  'cabinet.journal': 'tool.journal',
  'cabinet.timetable': 'tool.timetable',
  'cabinet.profile': 'system.profile',
  'cabinet.profile.workspaces': 'system.workplace',
  'cabinet.service': 'tool.services',
  'cabinet.loyalty.deposit': 'tool.loyalty.deposit',
  'cabinet.loyalty.personal-account': 'tool.loyalty.personal-account',
  'cabinet.loyalty.certificate': 'tool.loyalty.certificate',
  'cabinet.loyalty.subscription': 'tool.loyalty.subscription',
  'cabinet.loyalty.referral': 'tool.loyalty.referral',
  'cabinet.loyalty.bonus': 'tool.loyalty.bonus',
  'cabinet.finance': 'folder.finance',
  'cabinet.finance.cash': 'tool.finance.cash',
  'cabinet.finance.dds': 'tool.finance.dds',
  'cabinet.finance.cash.investments': 'tool.finance.investment',
  'cabinet.finance.z-report': 'tool.finance.z-report',
  'cabinet.inventory': 'tool.inventory',
  'cabinet.settings.online-booking': 'tool.online-booking',
  'cabinet.settings.documents': 'tool.documents',
  'cabinet.settings.tags': 'tool.tags',
  'cabinet.settings.notifications': 'tool.notifications',
  'cabinet.settings.integrations': 'tool.integrations',
});

function flatToolKey(area, item, parentKey) {
  if (item.readinessKey) return item.readinessKey;
  if (item.id) return area + '.' + item.id;
  if (parentKey === 'cabinet.finance' && item.label === 'Касса') return 'cabinet.finance.cash';
  return parentKey + '.' + String(item.label || '').toLowerCase().replace(/[^a-zа-яё0-9]+/g, '-');
}

function toolDisplayName(item) {
  if (item.readinessKey === 'cabinet.profile.workspaces') return 'Рабочее пространство';
  return String(item.label || '').startsWith('График (') ? 'График' : item.label;
}

function toolRegisterRows(area, items, byKey, depth = 0, ancestorIds = [], parentKey = '') {
  return items.map((item, index) => {
    const key = flatToolKey(area, item, parentKey);
    const id = (ancestorIds[ancestorIds.length - 1] || area) + '-' + index;
    const children = Array.isArray(item.items) ? item.items : [];
    const isCabinetJournal = area === 'cabinet' && item.id === 'journal';
    const groupedChildren = isCabinetJournal
      ? children.filter((child) => child.readinessKey !== 'cabinet.timetable').map((child) => (
        child.readinessKey === 'cabinet.journal.month'
          ? { ...child, items: children.filter((nested) => nested.readinessKey === 'cabinet.timetable') }
          : child
      ))
      : children;
    const expandable = groupedChildren.length > 0;
    const canPrice = area === 'cabinet' && INLINE_COMMERCIAL_KEYS[key];
    const price = canPrice ? '<div class="admin-tool-registry-price"><input type="number" min="0" step="0.01" inputmode="decimal" data-commercial-price aria-label="Цена ' +
      escapeHtml(toolDisplayName(item)) + '" disabled><span>₽</span></div>' : '—';
    const payment = canPrice ? '<select data-commercial-mode aria-label="Оплата ' + escapeHtml(toolDisplayName(item)) +
      '" disabled><option value="free">Бесплатно</option><option value="paid">Платно</option></select>' : '—';
    const readiness = item.readinessKey
      ? readinessSelect(item.readinessKey, byKey, 'admin-tool-child-status')
      : expandable
        ? toolStatus(item, byKey, true)
        : '—';
    // Structural type is independent of the readiness state.
    const marker = depth === 0 ? 'F' : item.kind === 'e' ? 'E'
      : item.kind === 'mode' ? 'R' : 'K';
    const markerTitle = marker === 'F' ? 'Основная карточка'
      : marker === 'E' ? 'Вложенная карточка'
      : marker === 'R' ? 'Режим' : 'Компонент';
    const toggle = expandable
      ? '<button type="button" class="admin-tool-registry-expand" data-tool-expand="' + escapeHtml(id) +
        '" aria-expanded="true" aria-label="Свернуть или раскрыть ' + escapeHtml(toolDisplayName(item)) + '">⌄</button>'
      : '';
    const name = escapeHtml(toolDisplayName(item));
    const accountControl = item.accountToolKey
      ? '<label class="admin-tool-account-control"><input type="checkbox" data-account-tool="' +
        escapeHtml(item.accountToolKey) + '" disabled><span data-account-tool-state>—</span></label>'
      : '';
    const row = '<tr data-tool-id="' + escapeHtml(id) + '" data-tool-ancestors="' +
      escapeHtml(ancestorIds.join(' ')) + '"' +
      (canPrice ? ' data-commercial-key="' + escapeHtml(INLINE_COMMERCIAL_KEYS[key]) + '"' : '') +
      '><td class="admin-tool-registry-expand-cell">' + toggle + '</td>' +
      '<td><div class="admin-tool-registry-name" data-tool-depth="' + depth + '" style="--tool-depth:' + depth + '">' +
      '<span class="admin-tool-registry-label">' + name + '</span>' + accountControl + '</div></td>' +
      '<td class="admin-tool-registry-kind"><span class="' + (marker === 'F' || marker === 'E' ? 'is-card' : 'is-plain') + '" title="' + markerTitle +
      '" aria-label="' + markerTitle + '">' + marker + '</span></td>' +
      '<td>' + readiness + '</td><td>' + payment + '</td><td><div class="admin-tool-registry-cost">' + price +
      '<small class="admin-tool-registry-save-state" aria-live="polite"></small></div></td></tr>';
    return row + (expandable
      ? toolRegisterRows(area, groupedChildren, byKey, depth + 1, [...ancestorIds, id], key)
      : '');
  }).join('');
}

function renderToolRegister(area, label, suffix) {
  const items = TOOL_MAP[area] || [];
  const columns = '<colgroup><col class="admin-tool-col-expand"><col class="admin-tool-col-name">' +
    '<col class="admin-tool-col-kind"><col class="admin-tool-col-status">' +
    '<col class="admin-tool-col-payment"><col class="admin-tool-col-price"></colgroup>';
  return '<section class="admin-users-section admin-tool-register-section">' +
    '<div class="admin-tool-register-sticky">' +
    '<h2 class="admin-users-section-title">' + label +
      ' <span class="admin-registry-app">/ ' + suffix + '</span></h2>' +
    '<div class="admin-tool-register-head-scroll">' +
    '<table class="admin-table admin-tool-register-table admin-tool-register-head-table">' + columns +
    '<thead><tr><th scope="col" class="admin-tool-registry-expand-header">' +
      '<button type="button" class="admin-tool-registry-expand admin-tool-registry-expand-all"' +
      ' data-tool-expand-all aria-expanded="true" aria-label="Свернуть все строки ' + label + '" title="Свернуть всё">⌄</button></th>' +
      '<th>Инструменты</th>' +
      '<th scope="col" title="F — основная карточка, E — вложенная карточка, R — режим, K — компонент">Тип</th>' +
      '<th>Готовность</th><th>Оплата</th><th>Цена, ₽</th></tr></thead></table></div></div>' +
    '<div class="admin-card admin-tool-register-card"><div class="admin-tool-register-scroll">' +
    '<table class="admin-table admin-tool-register-table admin-tool-register-body-table" data-admin-tool-map="' + area + '">' +
    columns + '<tbody>' + toolRegisterRows(area, items, readinessByKey(toolReadinessCache)) +
    '</tbody></table></div></div></section>';
}

function syncToolHierarchy(section) {
  const expandButtons = [...section.querySelectorAll('[data-tool-expand]')];
  const closed = new Set(expandButtons.filter((button) => button.getAttribute('aria-expanded') === 'false')
    .map((button) => button.dataset.toolExpand));
  section.querySelectorAll('[data-tool-ancestors]').forEach((row) => {
    row.hidden = String(row.dataset.toolAncestors || '').split(' ').some((id) => closed.has(id));
  });
  const expandAll = section.querySelector('[data-tool-expand-all]');
  if (expandAll) {
    const allExpanded = expandButtons.every((button) => button.getAttribute('aria-expanded') === 'true');
    expandAll.setAttribute('aria-expanded', String(allExpanded));
    expandAll.setAttribute('aria-label', allExpanded ? 'Свернуть все строки' : 'Раскрыть все строки');
    expandAll.title = allExpanded ? 'Свернуть всё' : 'Раскрыть всё';
  }
}

function hydrateInlineCommercial(content, products) {
  const indexed = new Map((Array.isArray(products) ? products : []).map((product) => [product.key, product]));
  content.querySelectorAll('[data-commercial-key]').forEach((row) => {
    const product = indexed.get(row.dataset.commercialKey);
    const price = row.querySelector('[data-commercial-price]');
    const mode = row.querySelector('[data-commercial-mode]');
    if (!product || !price || !mode) return;
    row.dataset.saleable = String(Boolean(product.isSaleable));
    price.value = rubles(product.priceMinor);
    price.dataset.previous = price.value;
    mode.value = product.isFree ? 'free' : 'paid';
    mode.dataset.previous = mode.value;
    price.disabled = false;
    mode.disabled = false;
  });
}

function bindInlineCommercial(content) {
  const pending = new WeakMap();
  content.querySelectorAll('[data-commercial-key]').forEach((row) => {
    const price = row.querySelector('[data-commercial-price]');
    const mode = row.querySelector('[data-commercial-mode]');
    const message = row.querySelector('.admin-tool-registry-save-state');
    if (!price || !mode) return;
    const save = async (event) => {
      const isPrice = event.currentTarget === price;
      if (pending.has(row)) {
        // A later edit is written after the current request, never raced over it.
        try { await pending.get(row); } catch { /* The first handler shows the error. */ }
        if (!row.isConnected) return;
      }
      const rub = Number(String(price.value).replace(',', '.'));
      if (isPrice && (!Number.isFinite(rub) || rub < 0 || !Number.isInteger(Math.round(rub * 100)))) {
        price.value = price.dataset.previous || '0';
        if (message) message.textContent = 'Неверная цена';
        return;
      }
      const data = isPrice
        ? { priceMinor: Math.round(rub * 100) }
        : { isFree: mode.value === 'free', isSaleable: mode.value === 'paid' };
      price.disabled = true;
      mode.disabled = true;
      if (message) message.textContent = 'Сохранение…';
      const request = commercialRequest('/' + encodeURIComponent(row.dataset.commercialKey), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      pending.set(row, request);
      try {
        const catalog = await request;
        catalogCache = catalog;
        const updated = catalog?.products?.find((item) => item.key === row.dataset.commercialKey);
        if (updated) {
          row.dataset.saleable = String(Boolean(updated.isSaleable));
          price.dataset.previous = rubles(updated.priceMinor);
          mode.dataset.previous = updated.isFree ? 'free' : 'paid';
        }
        if (message) message.textContent = 'Сохранено';
      } catch (error) {
        price.value = price.dataset.previous || '0';
        mode.value = mode.dataset.previous || 'free';
        if (message) message.textContent = error instanceof Error ? error.message : 'Ошибка сохранения';
      } finally {
        if (pending.get(row) === request) pending.delete(row);
        price.disabled = false;
        mode.disabled = false;
      }
    };
    price.addEventListener('change', save);
    mode.addEventListener('change', save);
  });
}

export function renderAdminTools(content) {
  if (!content) return;
  content.innerHTML = '<div class="admin-users-layout admin-tool-register-layout">' +
    renderToolRegister('cabinet', 'Кабинет', 'Professional') +
    renderToolRegister('records', 'Записи', 'User') +
    '<div class="admin-tool-register-footer"><span data-commercial-publication></span>' +
    '<button type="button" class="admin-button secondary" data-commercial-publish disabled>Опубликовать изменения</button>' +
    '<span data-commercial-publish-message aria-live="polite"></span></div></div>';
  bindArchitecture(content);
  content.querySelectorAll('.admin-tool-register-section').forEach((section) => {
    const bodyScroll = section.querySelector('.admin-tool-register-scroll');
    const headScroll = section.querySelector('.admin-tool-register-head-scroll');
    // Keep the sticky header columns aligned when the narrow viewport scrolls horizontally.
    bodyScroll?.addEventListener('scroll', () => {
      if (headScroll) headScroll.scrollLeft = bodyScroll.scrollLeft;
    }, { passive: true });
    section.querySelectorAll('[data-tool-expand]').forEach((button) => {
      button.addEventListener('click', () => {
        button.setAttribute('aria-expanded', String(button.getAttribute('aria-expanded') !== 'true'));
        syncToolHierarchy(section);
      });
    });
    section.querySelector('[data-tool-expand-all]')?.addEventListener('click', (event) => {
      const expand = event.currentTarget.getAttribute('aria-expanded') !== 'true';
      section.querySelectorAll('[data-tool-expand]').forEach((button) => {
        button.setAttribute('aria-expanded', String(expand));
      });
      syncToolHierarchy(section);
    });
    syncToolHierarchy(section);
  });
  bindInlineCommercial(content);
  void loadToolReadiness().then((items) => {
    if (content.isConnected) hydrateAllReadiness(content, items);
  }).catch(() => {});
  void accountToolsRequest().then((tools) => {
    if (content.isConnected) hydrateAccountTools(content, tools);
  }).catch(() => {});
  void loadCatalog().then((catalog) => {
    if (!content.isConnected) return;
    hydrateInlineCommercial(content, catalog?.products);
    const publication = content.querySelector('[data-commercial-publication]');
    if (publication) publication.textContent = catalog?.publication
      ? 'Каталог: версия ' + catalog.publication.version : 'Каталог ещё не опубликован';
    const publish = content.querySelector('[data-commercial-publish]');
    if (publish) publish.disabled = false;
  }).catch(() => {
    const message = content.querySelector('[data-commercial-publish-message]');
    if (message) message.textContent = 'Коммерческие условия недоступны';
  });
  content.querySelector('[data-commercial-publish]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const message = content.querySelector('[data-commercial-publish-message]');
    try {
      await commercialRequest('/publish', { method: 'POST' });
      catalogCache = null;
      const current = await loadCatalog();
      const publication = content.querySelector('[data-commercial-publication]');
      if (publication) publication.textContent = 'Каталог: версия ' + current?.publication?.version;
      if (message) message.textContent = 'Опубликовано';
    } catch (error) {
      if (message) message.textContent = error instanceof Error ? error.message : 'Ошибка публикации';
    } finally {
      button.disabled = false;
    }
  });
}

function sectionFor(product) {
  if (product.key.startsWith('tool.finance.') || product.key === 'folder.finance') return 'Финансы';
  if (product.key.includes('inventory')) return 'Склад';
  if (product.type === 'PACKAGE' || product.source === 'CUSTOM') return 'Пакеты';
  return 'База';
}

function rubles(priceMinor) {
  return (Number(priceMinor || 0) / 100).toFixed(2).replace('.00', '');
}

function productRow(product, products) {
  const canCompose = product.type === 'FOLDER' || product.type === 'PACKAGE';
  const included = new Set((product.includedProducts || []).map((item) => item.key));
  const candidates = products.filter((item) => item.key !== product.key && item.isActive && item.type !== 'SYSTEM' && item.type !== 'CAPACITY');

  return `<div class="commercial-product" data-commercial-product="${escapeHtml(product.key)}" data-free="${product.isFree}" data-saleable="${product.isSaleable}">
    <div class="commercial-product-main"><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(TYPE_LABELS[product.type] || product.type)}${product.description ? ` · ${escapeHtml(product.description)}` : ''}</small></div>
    <div class="commercial-product-price"><input class="admin-input" type="number" min="0" step="1" value="${escapeHtml(rubles(product.priceMinor))}" data-commercial-price><span>₽</span></div>
    <button type="button" class="admin-button secondary commercial-toggle" data-commercial-free aria-pressed="${product.isFree}">${product.isFree ? 'Бесплатно' : 'Платно'}</button>
    <button type="button" class="admin-button secondary commercial-toggle" data-commercial-saleable aria-pressed="${product.isSaleable}">${product.isSaleable ? 'Продаётся' : 'Не продаётся'}</button>
    ${canCompose ? `<div class="commercial-composition"><div class="commercial-composition-title">Состав</div>${candidates.map((item) => `<button type="button" class="admin-button secondary commercial-member" data-commercial-member="${escapeHtml(item.key)}" aria-pressed="${included.has(item.key)}">${included.has(item.key) ? '✓ ' : '+ '}${escapeHtml(item.name)}</button>`).join('')}</div>` : ''}
    <div class="commercial-composition"><button type="button" class="admin-button" data-commercial-save>Сохранить</button><span class="admin-inline-message" data-commercial-message></span></div>
  </div>`;
}

function packageComposer(products) {
  const candidates = products.filter((item) => item.isActive && item.type !== 'SYSTEM' && item.type !== 'PACKAGE');
  return `<section class="admin-card" style="padding:18px">
    <form class="commercial-package-form" data-commercial-package-form>
      <label class="admin-field"><span>Название</span><input name="name" required></label>
      <label class="admin-field"><span>Тип</span><select name="type"><option value="PACKAGE">Пакет</option><option value="FOLDER">Папка</option></select></label>
      <label class="admin-field"><span>Цена, ₽</span><input name="price" type="number" min="0" step="1" value="0"></label>
      <button class="admin-button" type="submit">Создать</button>
      <div class="commercial-package-members">${candidates.map((item) => `<button type="button" class="admin-button secondary commercial-member" data-new-package-member="${escapeHtml(item.key)}" aria-pressed="false">+ ${escapeHtml(item.name)}</button>`).join('')}</div>
      <p class="admin-inline-message" data-package-message></p>
    </form>
  </section>`;
}

function auditHtml(events) {
  if (!Array.isArray(events) || !events.length) return '<div class="admin-card" style="padding:18px">Пока нет коммерческих действий.</div>';
  return `<div class="admin-card" style="padding:18px"><div class="commercial-audit">${events.slice(0, 30).map((event) => {
    const moment = new Date(event.occurredAt);
    const date = Number.isNaN(moment.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(moment);
    const meta = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
    const detail = meta.key || meta.name || (meta.version ? `Версия ${meta.version}` : event.entityId || '');
    return `<div class="commercial-audit-row"><span>${escapeHtml(date)}</span><div><strong>${escapeHtml(EVENT_LABELS[event.eventType] || event.eventType)}</strong>${detail ? `<div>${escapeHtml(detail)}</div>` : ''}</div></div>`;
  }).join('')}</div></div>`;
}

async function renderCommerce(content) {
  content.innerHTML = '<div class="admin-card" style="padding:18px">Загружаем…</div>';
  try {
    const [catalog, audit] = await Promise.all([loadCatalog(), commercialRequest('/audit/events?limit=100')]);
    const products = Array.isArray(catalog.products) ? catalog.products : [];
    const groups = new Map();
    products.forEach((product) => {
      const section = sectionFor(product);
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(product);
    });
    const publication = catalog.publication;
    content.innerHTML = `<div class="commercial-toolbar commercial-page-toolbar">
      <div class="commercial-publication">${publication ? `Опубликована версия ${escapeHtml(publication.version)}` : 'Каталог ещё не опубликован'}</div>
      <button type="button" class="admin-button" data-commercial-publish>Опубликовать текущие условия</button>
    </div>
    <div class="commercial-catalog-stack">
      ${['База', 'Финансы', 'Склад', 'Пакеты'].filter((name) => groups.has(name)).map((name) => `<section class="commercial-catalog-section"><h3>${name}</h3><div class="admin-card">${groups.get(name).map((product) => productRow(product, products)).join('')}</div></section>`).join('')}
      ${packageComposer(products)}
      <section class="commercial-catalog-section"><h3>История коммерческих действий</h3>${auditHtml(audit)}</section>
    </div>`;
    bindCatalog(content);
  } catch (error) {
    content.innerHTML = `<div class="admin-card" style="padding:18px"><strong>Не удалось открыть коммерцию</strong><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`;
  }
}

function bindToggle(button, labelOn, labelOff, owner, dataKey) {
  button?.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    button.textContent = next ? labelOn : labelOff;
    owner.dataset[dataKey] = String(next);
  });
}

function bindMember(button) {
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    const name = button.textContent.replace(/^[+✓]\s*/, '');
    button.textContent = `${next ? '✓' : '+'} ${name}`;
  });
}

function bindCatalog(content) {
  content.querySelectorAll('[data-commercial-product]').forEach((row) => {
    bindToggle(row.querySelector('[data-commercial-free]'), 'Бесплатно', 'Платно', row, 'free');
    bindToggle(row.querySelector('[data-commercial-saleable]'), 'Продаётся', 'Не продаётся', row, 'saleable');
    row.querySelectorAll('[data-commercial-member]').forEach(bindMember);
    row.querySelector('[data-commercial-save]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const message = row.querySelector('[data-commercial-message]');
      const key = row.dataset.commercialProduct;
      const priceRub = Number(row.querySelector('[data-commercial-price]')?.value || 0);
      const includedProductKeys = [...row.querySelectorAll('[data-commercial-member][aria-pressed="true"]')].map((item) => item.dataset.commercialMember);
      button.disabled = true;
      message.textContent = '';
      try {
        await commercialRequest(`/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            priceMinor: Math.round(Math.max(0, priceRub) * 100),
            isFree: row.dataset.free === 'true',
            isSaleable: row.dataset.saleable === 'true',
            ...(row.querySelector('[data-commercial-member]') ? { includedProductKeys } : {}),
          }),
        });
        catalogCache = null;
        message.textContent = 'Сохранено';
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Ошибка';
        message.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });
  });

  content.querySelectorAll('[data-new-package-member]').forEach(bindMember);
  content.querySelector('[data-commercial-package-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const message = form.querySelector('[data-package-message]');
    const data = new FormData(form);
    const includedProductKeys = [...form.querySelectorAll('[data-new-package-member][aria-pressed="true"]')].map((item) => item.dataset.newPackageMember);
    if (!includedProductKeys.length) {
      message.textContent = 'Добавь хотя бы один инструмент в состав.';
      message.classList.add('error');
      return;
    }
    button.disabled = true;
    message.textContent = '';
    try {
      await commercialRequest('/packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.get('name'),
          type: data.get('type'),
          priceMinor: Math.round(Math.max(0, Number(data.get('price') || 0)) * 100),
          includedProductKeys,
        }),
      });
      catalogCache = null;
      await renderCommerce(content);
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : 'Не удалось создать пакет';
      message.classList.add('error');
      button.disabled = false;
    }
  });

  content.querySelector('[data-commercial-publish]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Публикуем…';
    try {
      await commercialRequest('/publish', { method: 'POST' });
      catalogCache = null;
      await renderCommerce(content);
    } catch (error) {
      button.disabled = false;
      button.textContent = error instanceof Error ? error.message : 'Ошибка публикации';
    }
  });
}
