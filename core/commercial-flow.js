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

function sameSelection(left = [], right = []) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function paidPeriodActive(commercial) {
  if (commercial?.access?.paidAccessExpired === true) return false;
  const endsAt = new Date(commercial?.access?.paidAccessEndsAt || 0).getTime();
  return Number.isFinite(endsAt) && endsAt > Date.now();
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
      : `${rubles(product.priceMinor)} · 30 дней${product.includedProducts?.length ? ` · включает ${product.includedProducts.map((item) => item.name).join(', ')}` : ''}`,
    checked: Boolean(product.selected),
    data: `data-commercial-product="${escapeHtml(product.key)}"`,
  })));
}

function pendingContent(commercial) {
  const order = commercial.order || {};
  return `
    <div class="modal-title">
      <h2>Ожидает оплаты</h2>
      <p>Бесплатный LIVE уже работает. После подтверждения оплаты выбранные платные инструменты включатся на 30 дней.</p>
    </div>
    ${v2Section('Счёт', `
      <div><strong>${escapeHtml(rubles(order.totalMinor || commercial.quote?.totalMinor || 0))}</strong></div>
      <p>Счёт отправлен на email. Пока оплата подтверждается, можно продолжать работать в бесплатном LIVE.</p>
    `)}
    <p class="form-error" data-commercial-error></p>
    ${actionBlock(button('Продолжить работать', { data:'data-commercial-check' }))}
  `;
}

function protectedGrantContent() {
  return `
    <div class="modal-title">
      <h2>Индивидуальный доступ</h2>
      <p>Этот LIVE был выдан отдельно от подписки. Текущие бесплатные инструменты сохраняются без изменений и не будут отключены новым коммерческим контуром.</p>
    </div>
    ${v2Section('Доступ', '<p>Оплата и срок 30 дней к этому индивидуальному доступу не применяются. Изменить его может администратор.</p>')}
    ${actionBlock(button('Продолжить работать', { data:'data-commercial-protected-close' }))}
  `;
}

function selectionContent(commercial) {
  const products = Array.isArray(commercial.products) ? commercial.products : [];
  const baseProducts = Array.isArray(commercial.baseProducts) ? commercial.baseProducts : [];
  const renewal = commercial?.access?.paidAccessExpired === true;
  const alreadyLive = commercial?.access?.commercialMode === 'LIVE';
  const activePaid = paidPeriodActive(commercial);
  const title = renewal ? 'Продление платного доступа' : (alreadyLive ? 'Инструменты LIVE' : 'Переход в LIVE');
  const description = renewal
    ? 'Платный период завершён. Бесплатный LIVE продолжает работать. Выберите инструменты на следующие 30 дней.'
    : alreadyLive
      ? 'Бесплатный LIVE уже работает. Здесь можно добавить платные инструменты.'
      : 'Базовый набор уже входит. Дополнительные инструменты можно добавить сейчас.';
  const summary = activePaid
    ? 'Текущий оплаченный набор действует до указанной даты. Можно добавить инструменты; оплата продлит платный период ещё на 30 дней.'
    : renewal
      ? 'Выберите платные инструменты для следующего периода на 30 дней.'
      : alreadyLive
        ? 'Если ничего не менять, текущий доступ останется как есть.'
        : 'Можно начать LIVE с тарифом 0 ₽ и добавить платные инструменты позже.';
  return `
    <div class="modal-title">
      <h2>${title}</h2>
      <p>${description}</p>
    </div>
    ${v2Section('Базовый набор', baseList(baseProducts))}
    ${v2Section('Дополнительные инструменты', productList(products))}
    ${v2Section('Тариф', `
      <div><strong data-commercial-total>${escapeHtml(rubles(commercial.quote?.totalMinor || 0))}</strong></div>
      <p data-commercial-summary>${summary}</p>
    `)}
    <p class="form-error" data-commercial-error></p>
    ${actionBlock(button(renewal ? 'Продлить на 30 дней' : (alreadyLive ? 'Готово' : 'Начать LIVE'), { data:'data-commercial-confirm' }))}
  `;
}

function content(commercial, { manage = false } = {}) {
  if (manage && commercial?.access?.commercialMode === 'LIVE' && commercial?.selfServiceManaged !== true) {
    return protectedGrantContent();
  }
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
      if (error) error.textContent = 'Не удалось открыть бесплатный LIVE.';
    } catch (checkError) {
      if (error) error.textContent = checkError instanceof Error ? checkError.message : 'Не удалось проверить LIVE';
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });
}

function bindProtectedGrantFlow(layer, commercial, finish) {
  layer.querySelector('[data-commercial-protected-close]')?.addEventListener('click', () => {
    layer.v2Close?.();
    finish({ access: commercial.access, commercial, order: commercial.order || null, protectedGrant:true });
  });
}

function bindSelectionFlow(layer, commercial, finish) {
  const products = Array.isArray(commercial.products) ? commercial.products : [];
  const byKey = new Map(products.map((product) => [product.key, product]));
  const manualSelected = new Set(products.filter((product) => product.selected).map((product) => product.key));
  for (const product of products) {
    if (product.isFree) manualSelected.add(product.key);
  }
  const initialDirectKeys = directSelection(products, manualSelected);
  const renewal = commercial?.access?.paidAccessExpired === true;
  const alreadyLive = commercial?.access?.commercialMode === 'LIVE';
  const activePaid = paidPeriodActive(commercial);

  initCheckList(layer);

  const sync = () => {
    const included = selectedDescendants(products, manualSelected);
    for (const product of products) {
      const input = layer.querySelector(`[data-commercial-product="${CSS.escape(product.key)}"]`);
      if (!input) continue;
      const free = Boolean(product.isFree);
      const inherited = included.has(product.key);
      const lockedPaid = activePaid && Boolean(product.selected) && !free;
      input.checked = free || inherited || manualSelected.has(product.key);
      input.disabled = free || inherited || lockedPaid;
      const row = input.closest('.ui-check-list__item');
      row?.classList.toggle('is-checked', input.checked);
      const mark = row?.querySelector('.ui-check-list__mark');
      if (mark) mark.textContent = input.checked ? '✓' : '';
    }

    const directKeys = directSelection(products, manualSelected);
    const changed = !sameSelection(directKeys, initialDirectKeys);
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
    if (confirmNode) {
      confirmNode.textContent = alreadyLive && !renewal && !changed
        ? 'Готово'
        : total > 0
          ? 'Получить счёт · 30 дней'
          : (renewal ? 'Оставить бесплатный LIVE' : (alreadyLive ? 'Сохранить инструменты' : 'Начать LIVE'));
    }
    if (summaryNode) {
      const paidCount = directKeys.filter((key) => !byKey.get(key)?.isFree).length;
      if (alreadyLive && !renewal && !changed) {
        summaryNode.textContent = activePaid && commercial?.access?.paidAccessEndsAt
          ? `Текущий оплаченный набор действует до ${new Intl.DateTimeFormat('ru-RU').format(new Date(commercial.access.paidAccessEndsAt))}.`
          : 'Текущий LIVE остаётся без изменений.';
      } else if (paidCount) {
        summaryNode.textContent = activePaid
          ? `Выбрано дополнительных инструментов: ${paidCount}. Оплата добавит их и продлит платный период ещё на 30 дней.`
          : `Выбрано дополнительных инструментов: ${paidCount}. Оплата открывает их на 30 дней. Бесплатный LIVE работает без ограничения этого периода.`;
      } else {
        summaryNode.textContent = 'Бесплатный LIVE продолжает работать без оплаты.';
      }
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
    const directKeys = directSelection(products, manualSelected);
    if (alreadyLive && !renewal && sameSelection(directKeys, initialDirectKeys)) {
      layer.v2Close?.();
      finish({ access: commercial.access, commercial, order: commercial.order || null, unchanged:true });
      return;
    }
    control.disabled = true;
    if (error) error.textContent = '';
    try {
      const payload = await request('/confirm-live', {
        method:'POST',
        body:JSON.stringify({ productKeys: directKeys }),
      });
      if (payload?.requiresPayment && payload?.access?.commercialMode === 'LIVE') {
        layer.v2Close?.();
        finish(payload);
        return;
      }
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

function bindFlow(layer, commercial, finish, { manage = false } = {}) {
  if (manage && commercial?.access?.commercialMode === 'LIVE' && commercial?.selfServiceManaged !== true) {
    bindProtectedGrantFlow(layer, commercial, finish);
    return;
  }
  if (commercial?.order?.status === 'PENDING') {
    bindPendingFlow(layer, finish);
    return;
  }
  bindSelectionFlow(layer, commercial, finish);
}

export function openCommercialLiveFlow({ required = false, manage = false } = {}) {
  if (activeFlow) return activeFlow;

  activeFlow = (async () => {
    const commercial = await request('/me');
    if (!commercial?.tenantId || !Array.isArray(commercial.products) || !commercial.quote) {
      throw new Error('Коммерческий каталог временно недоступен');
    }
    if (commercial?.access?.commercialMode === 'LIVE' && commercial?.access?.paidAccessExpired !== true && !manage) {
      return { access: commercial.access, commercial, order: commercial.order || null };
    }
    return new Promise((resolve) => {
      const layer = mountModal(document.body, modal(content(commercial, { manage }), {
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
      bindFlow(layer, commercial, resolve, { manage });
    });
  })().finally(() => {
    activeFlow = null;
  });

  return activeFlow;
}
