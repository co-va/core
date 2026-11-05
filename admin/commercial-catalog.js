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

const TOOL_MAP = Object.freeze({
  cabinet: [
    { id: 'people', label: 'Люди', readinessKey: 'cabinet.people' },
    {
      id: 'journal', label: 'Журнал', nesting: 'modes', items: [
        { label: 'День', kind: 'mode', readinessKey: 'cabinet.journal.day' },
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
    { id: 'service', label: 'Сервис', readinessKey: 'cabinet.service' },
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
        { label: 'Касса', kind: 'e', readinessKey: 'cabinet.finance.cash' },
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
  ],
  records: [
    {
      id: 'profile', label: 'Профиль', nesting: 'composition', items: [
        { label: 'Личные данные', kind: 'composition', readinessKey: 'records.profile.personal-data' },
        { label: 'Документы и уведомления', kind: 'composition', readinessKey: 'records.profile.documents-notifications' },
      ],
    },
    {
      id: 'journal', label: 'Журнал', nesting: 'modes', items: [
        { label: 'День', kind: 'mode', readinessKey: 'records.journal.day' },
        { label: 'Месяц', kind: 'mode', readinessKey: 'records.journal.month' },
        { label: 'Список', kind: 'mode', readinessKey: 'records.journal.list' },
      ],
    },
    {
      id: 'contacts', label: 'Контакты', nesting: 'composition', items: [
        { label: 'Список контактов', kind: 'composition', readinessKey: 'records.contacts.list' },
        { label: 'Карточка контакта', kind: 'composition', readinessKey: 'records.contacts.card' },
      ],
    },
    {
      id: 'integrations', label: 'Интеграции', nesting: 'e', items: [
        { label: 'Google Календарь', kind: 'e', readinessKey: 'records.integrations.google-calendar', accountToolKey: 'account.calendar.google' },
        { label: 'Яндекс Календарь', kind: 'e', readinessKey: 'records.integrations.yandex-calendar', accountToolKey: 'account.calendar.yandex' },
      ],
    },
  ],
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
  return `<select class="${className} admin-tool-readiness-select" data-readiness-key="${escapeHtml(readinessKey)}" data-previous="${value}">${readinessOptions(value)}</select>`;
}

function aggregateKeys(item) {
  return (item.items || []).map((child) => child.readinessKey).filter(Boolean);
}

function aggregateStatus(item, byKey) {
  const keys = aggregateKeys(item);
  const ready = keys.filter((key) => readinessValue(byKey.get(key)) === 'READY').length;
  return { ready, total: keys.length, keys };
}

function childRow(child, byKey) {
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

function toolStatus(item, byKey) {
  const items = Array.isArray(item.items) ? item.items : [];
  if (items.length) {
    const aggregate = aggregateStatus(item, byKey);
    return `<span class="admin-tool-readiness" data-readiness-count="${aggregate.total}" data-readiness-keys="${escapeHtml(aggregate.keys.join('|'))}">${aggregate.ready}/${aggregate.total} готово</span>`;
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
  });
  root.querySelectorAll('[data-readiness-count]').forEach((node) => {
    const total = Number(node.dataset.readinessCount || 0);
    const keys = String(node.dataset.readinessKeys || '').split('|').filter(Boolean);
    const ready = keys.filter((key) => readinessValue(byKey.get(key)) === 'READY').length;
    node.textContent = `${ready}/${total} готово`;
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

export function renderAdminTools(content) {
  if (!content) return;

  content.innerHTML = `<div class="admin-tool-areas">
    <details class="admin-tool-area">
      <summary class="admin-tool-area-summary"><strong>Кабинет</strong><span aria-hidden="true">⌄</span></summary>
      <div class="admin-tool-area-body" data-tool-area-body="cabinet">${renderArchitecture('cabinet', toolReadinessCache)}</div>
    </details>
    <details class="admin-tool-area">
      <summary class="admin-tool-area-summary"><strong>Записи</strong><span aria-hidden="true">⌄</span></summary>
      <div class="admin-tool-area-body" data-tool-area-body="records">${renderArchitecture('records', toolReadinessCache)}</div>
    </details>
    <details class="admin-tool-area" data-commerce-folder>
      <summary class="admin-tool-area-summary"><strong>Коммерция</strong><span aria-hidden="true">⌄</span></summary>
      <div class="admin-tool-area-body" data-commerce-body><div class="admin-card" style="padding:18px">Открой папку, чтобы загрузить коммерческие условия.</div></div>
    </details>
  </div>`;

  bindArchitecture(content);
  void loadToolReadiness().then((items) => {
    if (content.isConnected) hydrateAllReadiness(content, items);
  }).catch(() => {});
  void accountToolsRequest().then((tools) => {
    if (content.isConnected) hydrateAccountTools(content, tools);
  }).catch(() => {});
  const commerceFolder = content.querySelector('[data-commerce-folder]');
  const commerceBody = content.querySelector('[data-commerce-body]');
  commerceFolder?.addEventListener('toggle', () => {
    if (!commerceFolder.open || !commerceBody || commerceBody.dataset.loaded === 'true') return;
    commerceBody.dataset.loaded = 'true';
    void renderCommerce(commerceBody);
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
