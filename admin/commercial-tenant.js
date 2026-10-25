import { apiRequest } from '../core/auth.js';

let pendingTenantId = '';
const enhancedDrawers = new WeakSet();

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]));
}

function rubles(minor) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(minor || 0) / 100)} ₽`;
}

function dateInputValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function moment(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function accessPeriodText(commercial) {
  const terms = commercial?.terms || {};
  if (terms.freeForever || Number(terms.discountPercent || 0) >= 100) return 'Бесплатный доступ: без срока.';
  const freeUntil = new Date(terms.freeUntil || 0).getTime();
  if (Number.isFinite(freeUntil) && freeUntil >= Date.now()) return `Бесплатный доступ до: ${moment(terms.freeUntil)}.`;
  if (terms.paidAccessEndsAt) {
    return `Платные инструменты: ${moment(terms.paidAccessStartsAt)} — ${moment(terms.paidAccessEndsAt)}.`;
  }
  return 'Платный период: не активирован.';
}

async function request(path = '', options = {}) {
  const response = await apiRequest(`/saas-admin/commercial-tenants${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Ошибка коммерческих условий');
  return payload;
}

function eventLabel(type) {
  return ({
    TENANT_COMMERCIAL_TERMS_UPDATED: 'Изменены условия пользователя',
    COMMERCIAL_ORDER_CREATED: 'Зафиксирован расчёт',
    PAYMENT_RECORDED: 'Зафиксирована оплата',
    COMMERCIAL_RECEIPT_SENT: 'Чек отправлен',
    LIVE_PAID_PERIOD_STARTED: 'Начался платный период',
  })[type] || type;
}

function receiptAction(order) {
  const totalMinor = Number(order.totalMinor || 0);
  const status = String(order.status || '');
  if (totalMinor <= 0 || (status !== 'PENDING' && status !== 'PAID')) return '';
  if (order.receiptSentAt) {
    const receipt = order.receiptUrl
      ? `<a href="${escapeHtml(order.receiptUrl)}" target="_blank" rel="noopener noreferrer">Открыть чек</a>`
      : order.receiptFileName
        ? `Файл: ${escapeHtml(order.receiptFileName)}`
        : '';
    return `<div class="admin-service-note">Оплата: ${escapeHtml(moment(order.paidAt))}<br>Чек отправлен: ${escapeHtml(moment(order.receiptSentAt))} · ${escapeHtml(order.receiptSentTo || '')}${order.accessEndsAt ? `<br>Платные инструменты до: ${escapeHtml(moment(order.accessEndsAt))}` : ''}${receipt ? `<br>${receipt}` : ''}</div>`;
  }
  const label = status === 'PENDING'
    ? 'Оплата получена · отправить чек · включить платные инструменты'
    : 'Повторить отправку чека';
  return `
    <label class="admin-field">
      <span>PDF / фото / скрин чека</span>
      <input type="file" accept="application/pdf,image/*" data-commercial-receipt-file="${escapeHtml(order.id)}">
    </label>
    <p class="admin-service-note">или</p>
    <label class="admin-field">
      <span>Ссылка на чек из «Мой налог»</span>
      <input type="url" inputmode="url" placeholder="https://..." value="${escapeHtml(order.receiptUrl || '')}" data-commercial-receipt-url="${escapeHtml(order.id)}">
    </label>
    <button type="button" class="admin-button" data-commercial-complete-payment="${escapeHtml(order.id)}">${escapeHtml(label)}</button>`;
}

function orderRows(orders) {
  if (!Array.isArray(orders) || !orders.length) return '<p class="admin-service-note">Расчёты ещё не фиксировались.</p>';
  return `<div class="commercial-tenant-history">${orders.slice(0, 8).map((order) => `
    <div class="commercial-tenant-history-row">
      <span>${escapeHtml(moment(order.createdAt))}</span>
      <div>
        <strong>${escapeHtml(order.status)}</strong>
        <div>${escapeHtml(rubles(order.subtotalMinor))} → ${escapeHtml(rubles(order.totalMinor))}</div>
        ${receiptAction(order)}
      </div>
    </div>`).join('')}</div>`;
}

function auditRows(events) {
  if (!Array.isArray(events) || !events.length) return '<p class="admin-service-note">Коммерческих действий пока нет.</p>';
  return `<div class="commercial-tenant-history">${events.slice(0, 10).map((event) => `
    <div class="commercial-tenant-history-row">
      <span>${escapeHtml(moment(event.occurredAt))}</span>
      <div><strong>${escapeHtml(eventLabel(event.eventType))}</strong></div>
    </div>`).join('')}</div>`;
}

function selectedProductKeys(section) {
  return [...section.querySelectorAll('[data-commercial-tenant-product][aria-pressed="true"]')]
    .map((button) => button.dataset.commercialTenantProduct)
    .filter(Boolean);
}

function updateQuote(section) {
  const selected = [...section.querySelectorAll('[data-commercial-tenant-product][aria-pressed="true"]')];
  const subtotal = selected.reduce((sum, button) => sum + Number(button.dataset.priceMinor || 0), 0);
  const discountControl = section.querySelector('[data-commercial-tenant-discount]');
  const freeForever = section.querySelector('[data-commercial-tenant-free]')?.getAttribute('aria-pressed') === 'true';
  const freeUntilValue = section.querySelector('[data-commercial-tenant-free-until]')?.value || '';
  const freeUntil = freeUntilValue ? new Date(`${freeUntilValue}T23:59:59`) : null;
  const freeUntilActive = freeUntil && !Number.isNaN(freeUntil.getTime()) && freeUntil.getTime() >= Date.now();
  const discount = Math.max(0, Math.min(100, Math.round(Number(discountControl?.value || 0))));
  const effective = freeForever || freeUntilActive ? 100 : discount;
  const total = Math.max(0, subtotal - Math.round(subtotal * effective / 100));
  const subtotalNode = section.querySelector('[data-commercial-tenant-subtotal]');
  const discountNode = section.querySelector('[data-commercial-tenant-effective-discount]');
  const totalNode = section.querySelector('[data-commercial-tenant-total]');
  if (subtotalNode) subtotalNode.textContent = rubles(subtotal);
  if (discountNode) discountNode.textContent = `${effective}%`;
  if (totalNode) totalNode.textContent = rubles(total);
}

function bindOrderActions(section, tenantId) {
  section.querySelectorAll('[data-commercial-complete-payment]').forEach((button) => {
    button.addEventListener('click', async () => {
      const orderId = String(button.dataset.commercialCompletePayment || '');
      const urlInput = section.querySelector(`[data-commercial-receipt-url="${CSS.escape(orderId)}"]`);
      const fileInput = section.querySelector(`[data-commercial-receipt-file="${CSS.escape(orderId)}"]`);
      const receiptUrl = String(urlInput?.value || '').trim();
      const receiptFile = fileInput?.files?.[0] || null;
      const message = section.querySelector('[data-commercial-tenant-message]');
      button.disabled = true;
      if (message) {
        message.textContent = '';
        message.classList.remove('error');
      }
      try {
        if (!receiptFile && !receiptUrl) throw new Error('Прикрепите PDF/фото чека или вставьте ссылку');
        let options;
        if (receiptFile) {
          const form = new FormData();
          form.append('receiptFile', receiptFile);
          options = { method: 'POST', body: form };
        } else {
          options = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ receiptUrl }),
          };
        }
        const result = await request(`/${encodeURIComponent(tenantId)}/orders/${encodeURIComponent(orderId)}/complete-payment`, options);
        const orders = await request(`/${encodeURIComponent(tenantId)}/orders`);
        const host = section.querySelector('[data-commercial-tenant-orders]');
        if (host) host.innerHTML = orderRows(orders);
        bindOrderActions(section, tenantId);
        if (message) {
          const sentTo = result?.receipt?.sentTo ? ` на ${result.receipt.sentTo}` : '';
          const paidUntil = result?.access?.paidAccessEndsAt ? ` до ${moment(result.access.paidAccessEndsAt)}` : '';
          message.textContent = `Оплата подтверждена. Чек отправлен${sentTo}. Платные инструменты включены${paidUntil}.`;
        }
      } catch (error) {
        if (message) {
          message.textContent = error instanceof Error ? error.message : 'Не удалось завершить оплату';
          message.classList.add('error');
        }
        button.disabled = false;
      }
    });
  });
}

async function enhanceDrawer(drawer, tenantId) {
  if (!drawer || enhancedDrawers.has(drawer) || !tenantId) return;
  enhancedDrawers.add(drawer);

  const anchor = [...drawer.querySelectorAll('.admin-section')].find((section) => section.querySelector('h4')?.textContent.trim() === 'Состояние пространства');
  if (!anchor) return;

  const section = document.createElement('section');
  section.className = 'admin-section commercial-tenant-section';
  section.innerHTML = '<h4>Коммерческие условия</h4><p class="admin-service-note">Загружаем…</p>';
  anchor.before(section);

  try {
    const [commercial, orders] = await Promise.all([
      request(`/${encodeURIComponent(tenantId)}`),
      request(`/${encodeURIComponent(tenantId)}/orders`),
    ]);
    const products = Array.isArray(commercial.products) ? commercial.products : [];
    section.innerHTML = `
      <h4>Коммерческие условия</h4>
      <p class="admin-service-note">Индивидуальная выдача не меняет общий каталог. Здесь задаются только условия этого пользователя.</p>
      <div class="commercial-tenant-products">
        ${products.map((product) => `<button type="button" class="admin-button secondary commercial-tenant-product" data-commercial-tenant-product="${escapeHtml(product.key)}" data-price-minor="${escapeHtml(product.priceMinor)}" aria-pressed="${product.selected}">${product.selected ? '✓ ' : '+ '}${escapeHtml(product.name)} · ${escapeHtml(rubles(product.priceMinor))}</button>`).join('')}
      </div>
      <div class="commercial-tenant-fields">
        <label class="admin-field"><span>Скидка, %</span><input type="number" min="0" max="100" step="1" value="${escapeHtml(commercial.terms?.discountPercent || 0)}" data-commercial-tenant-discount></label>
        <label class="admin-field"><span>Бесплатно до</span><input type="date" value="${escapeHtml(dateInputValue(commercial.terms?.freeUntil))}" data-commercial-tenant-free-until></label>
        <button type="button" class="admin-button secondary commercial-toggle" data-commercial-tenant-free aria-pressed="${Boolean(commercial.terms?.freeForever)}">${commercial.terms?.freeForever ? '100% бессрочно' : 'Бессрочно бесплатно'}</button>
      </div>
      <div class="commercial-tenant-quote">
        <span>Полная стоимость <strong data-commercial-tenant-subtotal>${escapeHtml(rubles(commercial.quote?.subtotalMinor))}</strong></span>
        <span>Скидка <strong data-commercial-tenant-effective-discount>${escapeHtml(commercial.quote?.effectiveDiscountPercent || 0)}%</strong></span>
        <span>Итого <strong data-commercial-tenant-total>${escapeHtml(rubles(commercial.quote?.totalMinor))}</strong></span>
      </div>
      <p class="admin-service-note">${escapeHtml(accessPeriodText(commercial))}</p>
      <div class="admin-inline-actions">
        <button type="button" class="admin-button" data-commercial-tenant-save>Сохранить условия</button>
        <button type="button" class="admin-button secondary" data-commercial-tenant-order>Зафиксировать расчёт</button>
      </div>
      <p class="admin-inline-message" data-commercial-tenant-message></p>
      <details class="commercial-tenant-details" open><summary>Расчёты и покупки</summary><div data-commercial-tenant-orders>${orderRows(orders)}</div></details>
      <details class="commercial-tenant-details"><summary>История действий</summary>${auditRows(commercial.audit)}</details>`;

    section.querySelectorAll('[data-commercial-tenant-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-pressed') !== 'true';
        button.setAttribute('aria-pressed', String(next));
        const name = button.textContent.replace(/^[+✓]\s*/, '');
        button.textContent = `${next ? '✓' : '+'} ${name}`;
        updateQuote(section);
      });
    });

    const freeButton = section.querySelector('[data-commercial-tenant-free]');
    freeButton?.addEventListener('click', () => {
      const next = freeButton.getAttribute('aria-pressed') !== 'true';
      freeButton.setAttribute('aria-pressed', String(next));
      freeButton.textContent = next ? '100% бессрочно' : 'Бессрочно бесплатно';
      if (next) section.querySelector('[data-commercial-tenant-free-until]').value = '';
      updateQuote(section);
    });
    section.querySelector('[data-commercial-tenant-discount]')?.addEventListener('input', () => updateQuote(section));
    section.querySelector('[data-commercial-tenant-free-until]')?.addEventListener('input', () => {
      if (section.querySelector('[data-commercial-tenant-free-until]').value && freeButton) {
        freeButton.setAttribute('aria-pressed', 'false');
        freeButton.textContent = 'Бессрочно бесплатно';
      }
      updateQuote(section);
    });

    section.querySelector('[data-commercial-tenant-save]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const message = section.querySelector('[data-commercial-tenant-message]');
      button.disabled = true;
      message.textContent = '';
      message.classList.remove('error');
      try {
        const payload = {
          productKeys: selectedProductKeys(section),
          discountPercent: Number(section.querySelector('[data-commercial-tenant-discount]')?.value || 0),
          freeForever: freeButton?.getAttribute('aria-pressed') === 'true',
          freeUntil: section.querySelector('[data-commercial-tenant-free-until]')?.value || '',
        };
        const updated = await request(`/${encodeURIComponent(tenantId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        message.textContent = `Сохранено. Итог: ${rubles(updated.quote?.totalMinor)}.`;
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Не удалось сохранить условия';
        message.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });

    section.querySelector('[data-commercial-tenant-order]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const message = section.querySelector('[data-commercial-tenant-message]');
      button.disabled = true;
      message.textContent = '';
      message.classList.remove('error');
      try {
        const ordersUpdated = await request(`/${encodeURIComponent(tenantId)}/orders`, { method: 'POST' });
        section.querySelector('[data-commercial-tenant-orders]').innerHTML = orderRows(ordersUpdated);
        bindOrderActions(section, tenantId);
        message.textContent = 'Расчёт зафиксирован в истории.';
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : 'Не удалось зафиксировать расчёт';
        message.classList.add('error');
      } finally {
        button.disabled = false;
      }
    });

    bindOrderActions(section, tenantId);
  } catch (error) {
    section.innerHTML = `<h4>Коммерческие условия</h4><p class="admin-error">${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
  }
}

document.addEventListener('click', (event) => {
  const row = event.target instanceof Element ? event.target.closest('[data-tenant]') : null;
  if (row?.dataset.tenant) pendingTenantId = row.dataset.tenant;
}, true);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      const drawer = node.matches('.admin-drawer') ? node : node.querySelector('.admin-drawer');
      if (drawer && pendingTenantId) void enhanceDrawer(drawer, pendingTenantId);
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });
