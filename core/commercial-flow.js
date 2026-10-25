import { apiRequest } from './auth.js';
import { actionBlock, button, checkList, escapeHtml, initCheckList, modal, mountModal, v2Section } from '../ui/ui.js';

let activeFlow = null;

async function request(path = '', options = {}) {
  const response = await apiRequest(`/saas-commercial${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось открыть выбор инструментов');
  return payload;
}

function rubles(minor) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(minor || 0) / 100)} ₽`;
}

function effectiveDiscount(terms = {}) {
  if (terms.freeForever) return 100;
  const freeUntil = new Date(terms.freeUntil || 0).getTime();
  if (Number.isFinite(freeUntil) && freeUntil >= Date.now()) return 100;
  return Math.max(0, Math.min(100, Math.round(Number(terms.discountPercent || 0))));
}

function selectedDescendants(products, selectedKeys) {
  const byKey = new Map(products.map((product) => [product.key, product]));
  const included = new Set();
  const visit = (key) => {
    const product = byKey.get(key);
    for (const childKey of product?.includedProductKeys || []) {
      if (included.has(childKey)) continue;
      included.add(childKey);
      visit(childKey);
    }
  };
  for (const key of selectedKeys) visit(key);
  return included;
}

function directSelection(products, manualSelected) {
  const included = selectedDescendants(products, manualSelected);
  return [...manualSelected].filter((key) => !included.has(key));
}

function baseList(products = []) {
  if (!products.length) return '<p>Базовый набор включён в LIVE.</p>';
  return checkList(products.map((product) => ({
    value: product.key,
    label: product.name,
    secondary: 'Входит в LIVE · 0 ₽',
    checked: true,
    data: 'disabled',
  })));
}

function productList(products = []) {
  if (!products.length) return '<p>Дополнительных инструментов сейчас нет.</p>';
  return checkList(products.map((product) => ({
    value: product.key,
    label: product.name,
    secondary: product.isFree
      ? 'Сейчас бесплатно · включено'
      : `${rubles(product.priceMinor)}${product.includedProducts?.length ? ` · включает ${product.includedProducts.map((item) => item.name).join(', ')}` : ''}`,
    checked: Boolean(product.selected),
    data: `data-commercial-product="${escapeHtml(product.key)}"`,
  })));
}

function pendingContent(commercial) {
  const order = commercial.order || {};
  return `
    <div class="modal-title">
      <h2>Ожидает оплаты</h2>
      <p>Сумма зафиксирована. LIVE включится после подтверждения оплаты и отправки чека.</p>
    </div>
    ${v2Section('Счёт', `
      <div><strong>${escapeHtml(rubles(order.totalMinor || commercial.quote?.totalMinor || 0))}</strong></div>
      <p>Оплата выполняется по полученным реквизитам. После оплаты администратор сформирует чек в «Мой налог» и отправит его на ваш email.</p>
    `)}
    <p class="form-error" data-commercial-error></p>
    ${actionBlock(button('Проверить оплату', { data:'data-commercial-check' }))}
  `;
}

function selectionContent(commercial) {
  const products = Array.isArray(commercial.products) ? commercial.products : [];
  const baseProducts = Array.isArray(commercial.baseProducts) ? commercial.baseProducts : [];
  return `
    <div class="modal-title">
      <h2>Переход в LIVE</h2>
      <p>Базовый набор уже входит. Дополнительные инструменты можно добавить сейчас.</p>
    </div>
    ${v2Section('Базовый набор', baseList(baseProducts))}
    ${v2Section('Дополнительные инструменты', productList(products))}
    ${v2Section('Тариф', `
      <div><strong data-commercial-total>${escapeHtml(rubles(commercial.quote?.totalMinor || 0))}</strong></div>
      <p data-commercial-summary>Можно начать LIVE с тарифом 0 ₽ и добавить платные инструменты позже.</p>
    `)}
    <p class="form-error" data-commercial-error></p>
    ${actionBlock(button('Начать LIVE', { data:'data-commercial-confirm' }))}
  `;
}

function content(commercial) {
  if (commercial?.order?.status === 'PENDING') return pendingContent(commercial);
  return selectionContent(commercial);
}

function bindPendingFlow(layer, finish) {
  const control = layer.querySelector('[data-commercial-check]');
  const error = layer.querySelector('[data-commercial-error]');
  control?.addEventListener('click', async () => {
    control.disabled = true;
    if (error) error.textContent = '';
    try {
      const latest = await request('/me');
      if (latest?.access?.commercialMode === 'LIVE') {
        layer.v2Close?.();
        finish({
          access: latest.access,
          commercial: latest,
          order: latest.order || null,
        });
        return;
      }
      if (error) error.textContent = 'Оплата ещё не подтверждена.';
    } catch (checkError) {
      if (error) error.textContent = checkError instanceof Error ? checkError.message : 'Не удалось проверить оплату';
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });
}

function bindSelectionFlow(layer, commercial, finish) {
  const products = Array.isArray(commercial.products) ? commercial.products : [];
  const byKey = new Map(products.map((product) => [product.key, product]));
  const manualSelected = new Set(products.filter((product) => product.selected).map((product) => product.key));
  for (const product of products) {
    if (product.isFree) manualSelected.add(product.key);
  }

  initCheckList(layer);

  const sync = () => {
    const included = selectedDescendants(products, manualSelected);
    for (const product of products) {
      const input = layer.querySelector(`[data-commercial-product="${CSS.escape(product.key)}"]`);
      if (!input) continue;
      const free = Boolean(product.isFree);
      const inherited = included.has(product.key);
      input.checked = free || inherited || manualSelected.has(product.key);
      input.disabled = free || inherited;
      const row = input.closest('.ui-check-list__item');
      row?.classList.toggle('is-checked', input.checked);
      const mark = row?.querySelector('.ui-check-list__mark');
      if (mark) mark.textContent = input.checked ? '✓' : '';
    }

    const directKeys = directSelection(products, manualSelected);
    const subtotal = directKeys.reduce((sum, key) => {
      const product = byKey.get(key);
      return sum + (product?.isFree ? 0 : Math.max(0, Number(product?.priceMinor || 0)));
    }, 0);
    const discount = effectiveDiscount(commercial.terms || {});
    const total = Math.max(0, subtotal - Math.round(subtotal * discount / 100));
    const totalNode = layer.querySelector('[data-commercial-total]');
    const summaryNode = layer.querySelector('[data-commercial-summary]');
    const confirmNode = layer.querySelector('[data-commercial-confirm]');
    if (totalNode) totalNode.textContent = rubles(total);
    if (confirmNode) confirmNode.textContent = total > 0 ? 'Выставить счёт' : 'Начать LIVE';
    if (summaryNode) {
      const paidCount = directKeys.filter((key) => !byKey.get(key)?.isFree).length;
      summaryNode.textContent = paidCount
        ? `Выбрано дополнительных инструментов: ${paidCount}. После подтверждения сумма будет зафиксирована в счёте.`
        : 'Можно начать LIVE с тарифом 0 ₽ и добавить платные инструменты позже.';
    }
  };

  layer.querySelectorAll('[data-commercial-product]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = String(input.dataset.commercialProduct || '');
      if (!key || input.disabled) return;
      if (input.checked) manualSelected.add(key);
      else manualSelected.delete(key);
      sync();
    });
  });

  layer.querySelector('[data-commercial-confirm]')?.addEventListener('click', async (event) => {
    const control = event.currentTarget;
    const error = layer.querySelector('[data-commercial-error]');
    control.disabled = true;
    if (error) error.textContent = '';
    try {
      const payload = await request('/confirm-live', {
        method:'POST',
        body:JSON.stringify({ productKeys: directSelection(products, manualSelected) }),
      });
      if (payload?.requiresPayment) {
        const current = payload.commercial || commercial;
        current.order = payload.order || current.order;
        const body = layer.querySelector('[data-v2-q-body]');
        if (!body) throw new Error('Не удалось открыть состояние оплаты');
        body.innerHTML = pendingContent(current);
        bindPendingFlow(layer, finish);
        return;
      }
      layer.v2Close?.();
      finish(payload);
    } catch (submitError) {
      if (error) error.textContent = submitError instanceof Error ? submitError.message : 'Не удалось перейти в LIVE';
      control.disabled = false;
    }
  });

  sync();
}

function bindFlow(layer, commercial, finish) {
  if (commercial?.order?.status === 'PENDING') {
    bindPendingFlow(layer, finish);
    return;
  }
  bindSelectionFlow(layer, commercial, finish);
}

export function openCommercialLiveFlow({ required = false } = {}) {
  if (activeFlow) return activeFlow;

  activeFlow = (async () => {
    const commercial = await request('/me');
    if (!commercial?.tenantId || !Array.isArray(commercial.products) || !commercial.quote) {
      throw new Error('Коммерческий каталог временно недоступен');
    }
    if (commercial?.access?.commercialMode === 'LIVE') {
      return { access: commercial.access, commercial, order: commercial.order || null };
    }
    return new Promise((resolve) => {
      const layer = mountModal(document.body, modal(content(commercial), {
        variant:'q',
        title:'LIVE',
        surface:'app',
      }));
      if (!layer) {
        resolve({ cancelled:true });
        return;
      }

      const close = layer.querySelector('[data-modal-close]');
      if (required) {
        close?.remove();
      } else {
        close?.addEventListener('click', () => resolve({ cancelled:true }), { once:true });
      }
      bindFlow(layer, commercial, resolve);
    });
  })().finally(() => {
    activeFlow = null;
  });

  return activeFlow;
}
