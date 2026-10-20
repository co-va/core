import {
  button,
  field,
  modal,
  mountModal,
  openNotice,
  v2ListEntries,
  v2ListEntry,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { apiRequest } from '../auth.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import {
  getInventoryMovement,
  getInventoryMovements,
  inventoryOrderSuggestions,
} from './data.js';
import {
  correctInventoryMovement,
  createInventoryMovement,
} from './service.js';
import { renderInventory } from './inventory.js';

let activeMovementId = '';
let activeMovementKind = 'CONSUMPTION';
let movementKindListenerReady = false;

function numberText(value, maximum = 3) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU', { maximumFractionDigits: maximum }).replaceAll('\u00a0', ' ');
}

function notifyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function errorMessage(error, fallback = 'Ошибка Excel') {
  return error instanceof Error ? error.message : fallback;
}

async function jsonRequest(path, options = {}) {
  const response = await apiRequest(`/inventory/excel${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || 'Не удалось обработать Excel');
  return payload;
}

async function downloadWorkbook(path, { method = 'GET', body = null, fallback = 'warehouse.xlsx' } = {}) {
  const response = await apiRequest(`/inventory/excel${path}`, {
    method,
    ...(body == null ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload?.message || 'Не удалось выгрузить Excel');
  }
  const blob = await response.blob();
  const disposition = String(response.headers.get('content-disposition') || '');
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function excelAction(trigger, actions = [], title = 'Excel') {
  const content = actions.map((action) => button(action.label, {
    type: 'button',
    variant: 'secondary',
    data: `data-inventory-excel-action="${escapeHtml(action.id)}"`,
  })).join('');
  const modalRoot = mountModal(trigger, modal(content, { title, variant: 'x' }));
  actions.forEach((action) => {
    modalRoot?.querySelector(`[data-inventory-excel-action="${CSS.escape(action.id)}"]`)?.addEventListener('click', async () => {
      modalRoot.v2Close?.();
      try {
        await action.run();
      } catch (error) {
        openNotice({ title: 'Excel', message: errorMessage(error) });
      }
    });
  });
}

async function refresh(root, section) {
  await renderInventory(root, section);
  enhanceInventoryExcel(root, section);
}

function replaceContextAction(root, action, onClick) {
  const current = root.querySelector('[data-workspace-context-action]');
  if (current) {
    const clone = current.cloneNode(true);
    current.replaceWith(clone);
    clone.dataset.workspaceAKind = action.kind || 'settings';
    clone.dataset.workspaceALabel = action.label || '';
    clone.setAttribute('aria-label', action.aria || action.label || 'Действие');
    clone.addEventListener('click', onClick);
    notifyContext();
    return clone;
  }
  const contextRoot = root.querySelector('[data-workspace-header-context]');
  if (!contextRoot) return null;
  const holder = document.createElement('div');
  holder.innerHTML = workspaceHeaderContext({ title: '', a: action });
  const control = holder.querySelector('[data-workspace-context-action]');
  if (!control) return null;
  contextRoot.appendChild(control);
  control.addEventListener('click', onClick);
  notifyContext();
  return control;
}

function replacePrimaryAction(root, action, onClick) {
  const contextRoot = root.querySelector('[data-workspace-header-context]');
  if (!contextRoot) return null;
  contextRoot.querySelector('[data-v2-primary-action]')?.remove();
  const holder = document.createElement('div');
  holder.innerHTML = workspaceHeaderContext({ title: '', c: action });
  const control = holder.querySelector('[data-v2-primary-action]');
  if (!control) return null;
  contextRoot.appendChild(control);
  control.addEventListener('click', onClick);
  notifyContext();
  return control;
}

function enhanceStock(root) {
  replaceContextAction(root, { kind: 'settings', label: 'Excel', aria: 'Excel склада' }, (event) => {
    excelAction(event.currentTarget, [
      { id: 'export', label: 'Выгрузить', run: () => downloadWorkbook('/items/export', { fallback: 'ostatki.xlsx' }) },
    ]);
  });
}

function openMovementExport(trigger) {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setMonth(fromDate.getMonth() - 1);
  const from = fromDate.toISOString().slice(0, 10);
  const content = `<form data-inventory-export-period>
    ${field({ label: 'С', name: 'from', type: 'date', value: from })}
    ${field({ label: 'До', name: 'to', type: 'date', value: to })}
    ${button('Выгрузить', { type: 'submit' })}
  </form>`;
  const modalRoot = mountModal(trigger, modal(content, { title: 'Период', variant: 'x' }));
  modalRoot?.querySelector('[data-inventory-export-period]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await downloadWorkbook(`/movements/export?from=${encodeURIComponent(String(data.get('from') || ''))}&to=${encodeURIComponent(String(data.get('to') || ''))}`, { fallback: 'dvizheniya.xlsx' });
      modalRoot.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Excel', message: errorMessage(error) });
    }
  });
}

function sectionValues() {
  return [...new Set(getInventoryMovements()
    .filter((movement) => movement.procedureKey || movement.sourceType === 'excel-import')
    .flatMap((movement) => (Array.isArray(movement.lines) ? movement.lines : []).map((line) => String(line.note || '').trim()))
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'));
}

function sectionDatalist() {
  const values = sectionValues();
  if (!values.length) return '';
  return `<datalist id="inventory-section-values">${values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join('')}</datalist>`;
}

function collectMovementRows(layer, section = '') {
  return [...layer.querySelectorAll('[data-inventory-movement-row]')].map((row) => {
    const index = row.dataset.rowIndex;
    const itemId = row.querySelector(`[name="itemId-${CSS.escape(index)}"]`)?.value || '';
    const quantity = Number(String(row.querySelector(`[name="quantity-${CSS.escape(index)}"]`)?.value || '0').replace(',', '.')) || 0;
    const direction = row.dataset.rowDirection === 'IN' || row.dataset.rowDirection === 'OUT' ? row.dataset.rowDirection : undefined;
    return { itemId, quantity, note: section, ...(direction ? { direction } : {}) };
  }).filter((row) => row.itemId && row.quantity > 0);
}

function enhanceMovementEditor(root, layer) {
  const form = layer?.querySelector('[data-inventory-movement-form]');
  if (!form || form.dataset.inventoryExcelEnhanced === 'true') return;
  form.dataset.inventoryExcelEnhanced = 'true';
  const movement = activeMovementId ? getInventoryMovement(activeMovementId) : null;
  const existingSection = movement?.lines?.find((line) => String(line.note || '').trim())?.note || '';
  const metadata = document.createElement('div');
  metadata.innerHTML = `${sectionDatalist()}
    ${field({ label: 'UEI', name: 'personUei', value: movement?.personUei || '', readonly: Boolean(movement) })}
    ${field({ label: 'Процедура', name: 'procedureKey', value: movement?.procedureKey || '', readonly: Boolean(movement) })}
    ${field({ label: 'Часть / зона', name: 'section', value: existingSection, autocomplete: 'off', data: 'list="inventory-section-values"' })}`;
  const rows = form.querySelector('[data-inventory-movement-rows]');
  if (rows) rows.before(...metadata.childNodes);

  layer.addEventListener('click', async (event) => {
    const control = event.target.closest?.('[data-inventory-movement-save]');
    if (!control || !layer.contains(control)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = new FormData(form);
    const lines = collectMovementRows(layer, String(data.get('section') || '').trim());
    if (!lines.length) {
      openNotice({ title: 'Позиции', message: 'Добавьте хотя бы один материал и количество.' });
      return;
    }
    try {
      if (movement) {
        await correctInventoryMovement(movement.movementId, {
          lines,
          note: String(data.get('note') || '').trim(),
        });
      } else {
        await createInventoryMovement({
          kind: activeMovementKind || 'CONSUMPTION',
          sourceType: 'manual',
          personUei: String(data.get('personUei') || '').trim(),
          procedureKey: String(data.get('procedureKey') || '').trim(),
          note: String(data.get('note') || '').trim(),
          lines,
        });
      }
      activeMovementId = '';
      layer.v2Close?.();
      await refresh(root, 'movements');
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: errorMessage(error, 'Ошибка склада') });
    }
  }, true);
}

function enhanceMovements(root) {
  replaceContextAction(root, { kind: 'settings', label: 'Excel', aria: 'Excel движений' }, (event) => {
    excelAction(event.currentTarget, [
      { id: 'export', label: 'Выгрузить за период', run: () => openMovementExport(event.currentTarget) },
    ]);
  });

  if (root.dataset.inventoryMovementEnhancer === 'true') return;
  root.dataset.inventoryMovementEnhancer = 'true';
  root.addEventListener('click', (event) => {
    const movementControl = event.target.closest?.('[data-inventory-movement]');
    if (movementControl) activeMovementId = String(movementControl.dataset.inventoryMovement || '');
    if (event.target.closest?.('[data-inventory-add-movement]')) activeMovementId = '';
    if (movementControl || event.target.closest?.('[data-inventory-kind]')) {
      queueMicrotask(() => {
        const layers = root.querySelectorAll('.inventory-movement-z');
        enhanceMovementEditor(root, layers[layers.length - 1]);
      });
    }
  }, true);
}

function orderListMarkup() {
  return v2ListEntries(inventoryOrderSuggestions().map((item) => v2ListEntry({
    title: item.name,
    subtitle: `Осталось ${numberText(item.balance)} ${item.unit}`,
    rightTop: `${numberText(item.suggestedQuantity)} ${item.unit}`,
    rightBottom: item.supplier || '',
    initial: '',
    selected: true,
    interactive: true,
    data: `data-inventory-order-item="${escapeHtml(item.itemId)}" data-order-quantity="${escapeHtml(item.suggestedQuantity)}"`,
    aria: `Выбрать ${item.name} для заказа`,
  })));
}

function enhanceOrders(root) {
  const contextRoot = root.querySelector('[data-workspace-header-context]');
  const items = inventoryOrderSuggestions();
  if (!contextRoot || !items.length) return;
  [...root.children].filter((node) => node !== contextRoot).forEach((node) => node.remove());
  contextRoot.insertAdjacentHTML('afterend', orderListMarkup());
  root.querySelectorAll('[data-inventory-order-item]').forEach((control) => {
    control.addEventListener('click', () => {
      const selected = !control.classList.contains('is-selected');
      control.classList.toggle('is-selected', selected);
      control.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  });
  replacePrimaryAction(root, { label: 'Выгрузить', aria: 'Выгрузить выбранный заказ' }, async () => {
    const selections = [...root.querySelectorAll('[data-inventory-order-item].is-selected')].map((control) => ({
      itemId: control.dataset.inventoryOrderItem,
      quantity: Number(control.dataset.orderQuantity) || 0,
    })).filter((row) => row.itemId && row.quantity > 0);
    if (!selections.length) {
      openNotice({ title: 'Заказ', message: 'Выберите позиции для заказа.' });
      return;
    }
    try {
      await downloadWorkbook('/orders/export', { method: 'POST', body: { selections }, fallback: 'zakaz.xlsx' });
    } catch (error) {
      openNotice({ title: 'Excel', message: errorMessage(error) });
    }
  });
}

function ensureMovementKindListener() {
  if (movementKindListenerReady) return;
  movementKindListenerReady = true;
  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('[data-inventory-kind]');
    if (!control) return;
    activeMovementKind = String(control.dataset.inventoryKind || 'CONSUMPTION');
  }, true);
}

export function enhanceInventoryExcel(root, section = 'stock') {
  if (!root) return;
  ensureMovementKindListener();
  if (section === 'stock') enhanceStock(root);
  else if (section === 'movements') enhanceMovements(root);
  else if (section === 'orders') enhanceOrders(root);
}
