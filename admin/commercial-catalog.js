import { apiRequest } from '../core/auth.js';

const app = document.querySelector('#admin-app');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

async function commercialRequest(path = '', options = {}) {
  const response = await apiRequest(`/saas-admin/commercial-catalog${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка коммерческого каталога');
  return payload;
}

const TYPE_LABELS = {
  SYSTEM: 'Системное',
  TOOL: 'Инструмент',
  FOLDER: 'Папка',
  PACKAGE: 'Пакет',
  CAPACITY: 'Ёмкость',
  ADDON: 'Дополнение',
};

const READINESS = {
  NOT_READY: 'Не готово',
  TESTING: 'Проверка',
  READY: 'Готово',
};

const EVENT_LABELS = {
  CATALOG_PRODUCT_UPDATED: 'Изменены коммерческие условия',
  CATALOG_PACKAGE_CREATED: 'Создан пакет',
  CATALOG_PUBLISHED: 'Опубликована версия каталога',
};

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
  const readiness = READINESS[product.readiness] ? product.readiness : 'NOT_READY';
  const canCompose = product.type === 'FOLDER' || product.type === 'PACKAGE';
  const included = new Set((product.includedProducts || []).map((item) => item.key));
  const candidates = products.filter((item) => item.key !== product.key && item.isActive && item.type !== 'SYSTEM' && item.type !== 'CAPACITY');
  return `<div class="commercial-product" data-commercial-product="${escapeHtml(product.key)}" data-free="${product.isFree}" data-saleable="${product.isSaleable}" data-readiness="${escapeHtml(readiness)}">
    <div class="commercial-product-main">
      <strong>${escapeHtml(product.name)}</strong>
      <small>${escapeHtml(TYPE_LABELS[product.type] || product.type)}${product.description ? ` · ${escapeHtml(product.description)}` : ''}</small>
    </div>
    <label class="admin-field" style="min-width:130px"><span>Статус</span><select data-commercial-readiness aria-label="Статус ${escapeHtml(product.name)}">${Object.entries(READINESS).map(([value, label]) => `<option value="${value}"${value === readiness ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label>
    <div class="commercial-product-price">
      <input class="admin-input" type="number" min="0" step="1" value="${escapeHtml(rubles(product.priceMinor))}" data-commercial-price aria-label="Цена ${escapeHtml(product.name)}">
      <span>₽</span>
    </div>
    <button type="button" class="admin-button secondary commercial-toggle" data-commercial-free aria-pressed="${product.isFree}">${product.isFree ? 'Бесплатно' : 'Платно'}</button>
    <button type="button" class="admin-button secondary commercial-toggle" data-commercial-saleable aria-pressed="${product.isSaleable}">${product.isSaleable ? 'Продаётся' : 'Не продаётся'}</button>
    ${canCompose ? `<div class="commercial-composition">
      <div class="commercial-composition-title">Состав</div>
      ${candidates.map((item) => `<button type="button" class="admin-button secondary commercial-member" data-commercial-member="${escapeHtml(item.key)}" aria-pressed="${included.has(item.key)}">${included.has(item.key) ? '✓ ' : '+ '}${escapeHtml(item.name)}</button>`).join('')}
    </div>` : ''}
    <div class="commercial-composition"><button type="button" class="admin-button" data-commercial-save>Сохранить</button><span class="admin-inline-message" data-commercial-message></span></div>
  </div>`;
}

function packageComposer(products) {
  const candidates = products.filter((item) => item.isActive && item.type !== 'SYSTEM' && item.type !== 'PACKAGE');
  return `<section class="admin-card" style="padding:18px">
    <div class="admin-heading"><div><h3>Новый пакет</h3><p>Собери свою папку или общий пакет из уже зарегистрированных инструментов.</p></div></div>
    <form class="commercial-package-form" data-commercial-package-form>
      <label class="admin-field"><span>Название</span><input name="name" required></label>
      <label class="admin-field"><span>Тип</span><select name="type"><option value="PACKAGE">Пакет</option><option value="FOLDER">Папка</option></select></label>
      <label class="admin-field"><span>Цена, ₽</span><input name="price" type="number" min="0" step="1" value="0"></label>
      <button class="admin-button" type="submit">Создать</button>
      <div class="commercial-package-members">
        ${candidates.map((item) => `<button type="button" class="admin-button secondary commercial-member" data-new-package-member="${escapeHtml(item.key)}" aria-pressed="false">+ ${escapeHtml(item.name)}</button>`).join('')}
      </div>
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

async function renderCommercialCatalog() {
  const content = app?.querySelector('[data-content]');
  const activeButton = app?.querySelector('[data-section="capabilities"].is-active');
  if (!content || !activeButton) return;
  content.innerHTML = '<div class="admin-card" style="padding:18px">Загружаем каталог…</div>';
  try {
    const [catalog, audit] = await Promise.all([
      commercialRequest(),
      commercialRequest('/audit/events?limit=100'),
    ]);
    if (!app?.querySelector('[data-section="capabilities"].is-active')) return;
    const products = Array.isArray(catalog.products) ? catalog.products : [];
    const groups = new Map();
    products.forEach((product) => {
      const section = sectionFor(product);
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section).push(product);
    });
    const publication = catalog.publication;
    content.innerHTML = `
      <div class="admin-heading commercial-toolbar">
        <div><h2>Инструменты</h2><p>Единый реестр продукта, цен, папок и пакетов. Пользовательские исключения настраиваются в карточке человека.</p></div>
        <div><div class="commercial-publication">${publication ? `Опубликована версия ${escapeHtml(publication.version)}` : 'Каталог ещё не опубликован'}</div><button type="button" class="admin-button" data-commercial-publish>Опубликовать текущие условия</button></div>
      </div>
      <div class="commercial-catalog-stack">
        ${['База', 'Финансы', 'Склад', 'Пакеты'].filter((name) => groups.has(name)).map((name) => `<section class="commercial-catalog-section"><h3>${name}</h3><div class="admin-card">${groups.get(name).map((product) => productRow(product, products)).join('')}</div></section>`).join('')}
        ${packageComposer(products)}
        <section class="commercial-catalog-section"><h3>История коммерческих действий</h3>${auditHtml(audit)}</section>
      </div>`;
    bindCatalog(content);
  } catch (error) {
    content.innerHTML = `<div class="admin-card" style="padding:18px"><strong>Не удалось открыть коммерческий каталог</strong><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></div>`;
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
    row.querySelector('[data-commercial-readiness]')?.addEventListener('change', (event) => { row.dataset.readiness = event.currentTarget.value; });
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
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ priceMinor: Math.round(Math.max(0, priceRub) * 100), isFree: row.dataset.free === 'true', isSaleable: row.dataset.saleable === 'true', readiness: row.dataset.readiness || 'NOT_READY', ...(row.querySelector('[data-commercial-member]') ? { includedProductKeys } : {}) }),
        });
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: data.get('name'), type: data.get('type'), priceMinor: Math.round(Math.max(0, Number(data.get('price') || 0)) * 100), includedProductKeys }),
      });
      await renderCommercialCatalog();
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
      await renderCommercialCatalog();
    } catch (error) {
      button.disabled = false;
      button.textContent = error instanceof Error ? error.message : 'Ошибка публикации';
    }
  });
}

function simplifyRegistrationLink() {
  const access = app?.querySelector('.admin-invite-access');
  if (!access) return;
  access.hidden = true;
  access.querySelectorAll('[data-invite-tool]').forEach((input) => { input.checked = true; });
  const note = app.querySelector('.admin-invite-panel .admin-service-note');
  const textValue = 'Создай одноразовую регистрационную ссылку. Набор продукта и коммерческие условия управляются в разделе «Инструменты».';
  if (note && note.textContent !== textValue) note.textContent = textValue;
}

app?.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-section="capabilities"]') : null;
  if (target) window.setTimeout(renderCommercialCatalog, 0);
}, true);

const observer = new MutationObserver(() => {
  if (!app?.querySelector('.admin-invite-access[hidden]')) simplifyRegistrationLink();
});
if (app) observer.observe(app, { childList: true, subtree: true });
window.setTimeout(simplifyRegistrationLink, 0);
