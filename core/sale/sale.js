import {
  actionBlock,
  button,
  emptyState,
  escapeHtml,
  initMultiSelect,
  modal,
  mountModal,
  openNotice,
  page,
  v2ListEntries,
  v2ListEntry,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getRecord, refreshRecordsFromServer, updateRecord } from '../record/index.js';
import { getProducts } from '../service/products/data.js';

function workplaceAssignment(item, workplaceId) {
  const id = String(workplaceId || '');
  return (Array.isArray(item?.workplaces) ? item.workplaces : [])
    .find((workplace) => String(workplace?.workplaceId ?? workplace?.id ?? workplace?.key ?? '') === id) || null;
}

function costValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value?.free) return 0;
  return value?.amount ?? value?.from ?? value?.to ?? '';
}

function productCost(product, workplaceId) {
  const assigned = workplaceAssignment(product, workplaceId);
  const assignedCost = costValue(assigned?.cost);
  if (assignedCost !== '') return assignedCost;
  return costValue(product?.cost);
}

function productAvailable(product, workplaceId) {
  const assigned = Array.isArray(product?.workplaces) ? product.workplaces : [];
  return !assigned.length || Boolean(workplaceAssignment(product, workplaceId));
}

function money(value) {
  if (value === '' || value == null) return '';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function productRows(products, selected, currentById, workplaceId) {
  return products.map((product) => {
    const id = String(product?.id || '');
    const current = currentById.get(id);
    const cost = current?.cost ?? productCost(product, workplaceId);
    return v2ListEntry({
      title: product?.name || 'Товар',
      rightTop: money(cost),
      interactive: true,
      selectable: true,
      selected: selected.has(id),
      data: `data-sale-product="${escapeHtml(id)}"`,
      aria: `Выбрать товар ${product?.name || ''}`,
    });
  });
}

export function openSale({
  workplaceId = '',
  selectedProducts = [],
  onSave = async () => true,
} = {}) {
  const available = getProducts().filter((product) => productAvailable(product, workplaceId));
  const current = Array.isArray(selectedProducts) ? selectedProducts : [];
  const selected = new Set(current.map((item) => String(item?.id || '')).filter(Boolean));
  const currentById = new Map(current.map((item) => [String(item?.id || ''), item]));
  const list = available.length
    ? v2ListEntries(productRows(available, selected, currentById, workplaceId))
    : emptyState('Товаров пока нет', 'Добавьте товары в Сервисе.');

  const layer = mountModal(document.body, modal(
    `${workspaceHeaderContext({ title: 'Продажа' })}${page([
      `<div data-sale-products>${list}</div>`,
      actionBlock(button('Добавить', { data: 'data-sale-save' })),
    ])}`,
    { variant: 'q', surface: 'app', title: 'Продажа', className: 'sale-q' },
  ));
  if (!layer) return null;

  const listRoot = layer.querySelector('[data-sale-products]');
  const controller = listRoot && available.length ? initMultiSelect(listRoot, {
    selectedValues: [...selected],
    selector: '[data-sale-product]',
    valueAttribute: 'saleProduct',
    onChange: (values) => {
      selected.clear();
      values.forEach((value) => selected.add(String(value)));
    },
  }) : null;

  layer.querySelector('[data-sale-save]')?.addEventListener('click', async (event) => {
    const submit = event.currentTarget;
    submit.disabled = true;
    const nextProducts = available
      .filter((product) => selected.has(String(product?.id || '')))
      .map((product) => {
        const id = String(product?.id || '');
        const existing = currentById.get(id);
        return existing ? { ...existing } : {
          id: product?.id || '',
          name: product?.name || '',
          cost: productCost(product, workplaceId),
        };
      });
    try {
      const result = await onSave(nextProducts);
      if (result === false) {
        submit.disabled = false;
        return;
      }
      controller?.destroy();
      layer.v2Close?.();
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: String(error?.message || 'Не удалось добавить товары.') });
      if (submit.isConnected) submit.disabled = false;
    }
  });

  return layer;
}

export function openRecordSale(record, { onSaved = () => {} } = {}) {
  if (!record?.id) return null;
  const current = getRecord(record.id) || record;
  return openSale({
    workplaceId: current.workplaceId,
    selectedProducts: current.products || [],
    onSave: async (products) => {
      const updated = updateRecord(current.id, { products });
      if (!updated) throw new Error('Не удалось обновить состав продажи.');
      await flushBusinessPersistence();
      await refreshRecordsFromServer();
      const saved = getRecord(current.id) || updated;
      onSaved(saved);
      return saved;
    },
  });
}
