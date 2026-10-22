import {
  actionBlock,
  button,
  collectCost,
  costField,
  costListParts,
  emptyState,
  entityVisualCard,
  escapeHtml,
  field,
  initCostFields,
  initV2ListReorder,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  mountV2ZLayer,
  openSharedProfileSettingsMenu,
  page,
  setSharedProfilePrimary,
  textareaField,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workplaceCountText,
} from '../../../ui/ui.js';
import { getSettlementItemTotals, getSettlementItemTotalsForRecords } from '../../../core/finance/index.js';
import { getRecords } from '../../../core/record/index.js';
import { getWorkplaces } from '../../profile/workplaces/data.js';
import { serviceHeaderContext, notifyServiceContext } from '../context.js';
import { openServiceWorkplaceSelection } from '../workplace-selection.js';
import { productCardAppearance, productCardFields, productCardPhoto } from '../card-presentation.js';
import { deleteProduct as deleteProductData, getProducts, pushProductHistory, reorderProducts, saveProduct as saveProductData } from './data.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU').format(Number(value || 0))} ₽`;

function initialProduct(existing = null) {
  if (existing) return {
    ...existing,
    workplaces: Array.isArray(existing.workplaces) ? existing.workplaces.map((item) => ({ ...item })) : [],
  };
  return {
    id: '',
    photo: '',
    name: '',
    cost: { mode: 'amount', amount: '', free: false },
    about: '',
    workplaces: [],
  };
}

function activeProductRecords(productId, workplaceId = '') {
  const id = String(productId || '');
  const workspace = String(workplaceId || '');
  return getRecords().filter((record) => record?.status !== 'cancelled'
    && (!workspace || String(record?.workplaceId || '') === workspace)
    && (record?.products || []).some((item) => String(item?.id || '') === id));
}

function updateProduct(current, patch) {
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  pushProductHistory(current, 'updated');
  saveProductData(next);
  return next;
}

function productRow(product) {
  const price = costListParts(product.cost);
  return v2ListEntry({
    title: product.name || '',
    subtitle: workplaceCountText((product.workplaces || []).length),
    image: productCardPhoto(product),
    initial: (product.name || '?').slice(0, 1).toUpperCase(),
    rightTop: price.rightTop || '',
    rightBottom: price.rightBottom || '',
    interactive: true,
    reorderHandle: true,
    reorderAria: 'Изменить порядок',
    data: `data-product="${escapeHtml(product.id)}" data-reorder-id="${escapeHtml(product.id)}"`,
    aria: `Открыть товар ${product.name || ''}`,
  });
}

export function renderProductCatalog(host, { root = host, onChanged = () => {} } = {}) {
  const items = getProducts();
  host.innerHTML = items.length
    ? v2ListEntries(items.map(productRow))
    : emptyState('Товаров пока нет', 'Добавьте первый товар кнопкой «+».');

  host.querySelectorAll('[data-product]').forEach((node) => {
    node.addEventListener('click', () => openProductOverview(root, node.dataset.product, { onChanged }));
  });

  return initV2ListReorder(host, {
    onReorder: (ids) => {
      if (reorderProducts(ids)) onChanged();
    },
  });
}

function productOverviewCard(product) {
  const records = activeProductRecords(product.id);
  const fact = getSettlementItemTotals('product', product.id);
  return entityVisualCard({
    appearance: productCardAppearance(product),
    fields: productCardFields(product, {
      saleCount: records.length,
      revenue: fact.factTotal,
    }),
    image: productCardPhoto(product),
    className: 'entity-visual-card--service',
  });
}

function productWorkplaceCards(product) {
  const byId = new Map(getWorkplaces().map((workplace) => [String(workplace.key || workplace.id || ''), workplace]));
  const cards = (product.workplaces || []).map((selection) => {
    const id = String(selection.workplaceId || selection.id || selection.key || '');
    const workplace = byId.get(id) || selection;
    const records = activeProductRecords(product.id, id);
    const fact = getSettlementItemTotalsForRecords('product', product.id, records.map((record) => record.id));
    return miniCard({
      title: workplace.name || selection.name || 'Рабочее пространство',
      rows: [
        { label: 'Кол-во', value: String(records.length) },
        { label: 'Сумма', value: money(fact.factTotal) },
      ],
    });
  });
  return cards.length ? miniCardRail(cards) : '';
}

function confirmDeleteProduct(product, onDeleted) {
  const layer = mountModal(document.body, modal(`<div class="modal-title"><h2>Удалить?</h2><p>${escapeHtml(product.name || 'Товар')} будет удалён.</p></div><div class="modal-actions">${button('Удалить', { variant: 'danger', data: 'data-confirm-delete-product' })}${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete-product' })}</div>`, {
    variant: 'x',
    title: 'Удаление товара',
  }));
  if (!layer) return;
  layer.querySelector('[data-cancel-delete-product]')?.addEventListener('click', () => layer.v2Close?.());
  layer.querySelector('[data-confirm-delete-product]')?.addEventListener('click', () => {
    if (deleteProductData(product.id)) onDeleted?.();
    layer.v2Close?.();
  });
}

function openProductOverviewSettings(layer, baseRoot, product, { onChanged = () => {} } = {}) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'workplaces',
        label: 'Рабочие пространства',
        onSelect: () => openServiceWorkplaceSelection({
          selected: product.workplaces || [],
          onChange: (workplaces) => {
            product = updateProduct(product, { workplaces });
            renderProductOverview(layer, baseRoot, product.id, { onChanged });
          },
        }),
      },
      {
        id: 'editor',
        label: 'Редактор товара',
        onSelect: () => renderProductEditor(layer, baseRoot, product, { onChanged }),
      },
      {
        id: 'delete',
        label: 'Удалить',
        variant: 'danger',
        onSelect: () => confirmDeleteProduct(product, () => {
          layer.v2Close?.();
          onChanged();
        }),
      },
    ],
  });
}

function productEditorForm(existing = null) {
  const product = initialProduct(existing);
  return `<form class="compact-form" data-product-editor-form>
    ${field({ label: 'Название', name: 'productName', value: product.name || '', placeholder: 'Название товара', required: true })}
    ${costField({ value: product.cost || {}, name: 'productCost' })}
    ${textareaField({ label: 'Описание', name: 'productAbout', value: product.about || '', rows: 7, maxlength: 5000, placeholder: 'Описание товара' })}
    <div class="form-error" data-product-editor-error></div>
  </form>`;
}

function editorDraftSettings(draft) {
  return openSharedProfileSettingsMenu({
    title: 'Настройки',
    actions: [
      {
        id: 'workplaces',
        label: 'Рабочие пространства',
        onSelect: () => openServiceWorkplaceSelection({
          selected: draft.workplaces || [],
          onChange: (workplaces) => { draft.workplaces = workplaces; },
        }),
      },
    ],
  });
}

function renderProductEditor(layer, baseRoot, existing = null, { onChanged = () => {} } = {}) {
  const draft = initialProduct(existing);
  layer.innerHTML = page([
    serviceHeaderContext({
      title: existing?.name || 'Новый товар',
      settingsData: 'data-product-editor-settings',
      settingsAria: 'Настройки товара',
    }),
    productEditorForm(existing),
    actionBlock(button('Сохранить', { type: 'button', data: 'data-product-editor-primary', aria: 'Сохранить товар' })),
  ]);
  initCostFields(layer);
  layer.querySelector('[data-product-editor-settings]')?.addEventListener('click', () => editorDraftSettings(draft));

  const form = layer.querySelector('[data-product-editor-form]');
  const primary = layer.querySelector('[data-product-editor-primary]');
  const save = () => {
    const data = new FormData(form);
    const name = String(data.get('productName') || '').trim();
    const error = layer.querySelector('[data-product-editor-error]');
    if (!name) {
      if (error) error.textContent = 'Укажите название товара.';
      return;
    }
    setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить', disabled: true });
    const item = {
      ...(existing || {}),
      id: existing?.id || crypto.randomUUID(),
      photo: String(draft.photo || existing?.photo || ''),
      name,
      cost: collectCost(layer, 'productCost'),
      about: String(data.get('productAbout') || '').trim(),
      workplaces: Array.isArray(draft.workplaces) ? draft.workplaces.map((value) => ({ ...value })) : [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (existing) pushProductHistory(existing, 'updated');
    saveProductData(item);
    if (existing) renderProductOverview(layer, baseRoot, item.id, { onChanged });
    else {
      layer.v2Close?.();
      onChanged();
    }
  };
  primary?.addEventListener('click', save);
  form?.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  setSharedProfilePrimary(primary, { visible: true, label: 'Сохранить' });
  notifyServiceContext();
}

export function openProductEditor(root, existing = null, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-product-editor-layer' }), { stack: true });
  if (!layer) return null;
  renderProductEditor(layer, root, existing, { onChanged });
  return layer;
}

function renderProductOverview(layer, baseRoot, id, { onChanged = () => {} } = {}) {
  const product = getProducts().find((item) => String(item.id) === String(id));
  if (!product) {
    layer.v2Close?.();
    onChanged();
    return;
  }
  layer.innerHTML = page([
    serviceHeaderContext({
      title: product.name || 'Товар',
      settingsData: 'data-product-settings',
      settingsAria: `Настройки ${product.name || 'товара'}`,
    }),
    productOverviewCard(product),
    productWorkplaceCards(product),
  ]);
  layer.querySelector('[data-product-settings]')?.addEventListener('click', () => openProductOverviewSettings(layer, baseRoot, product, { onChanged }));
  notifyServiceContext();
}

export function openProductOverview(root, id, { onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'service-product-overview-layer' }), { stack: true });
  if (!layer) return null;
  renderProductOverview(layer, root, id, { onChanged });
  return layer;
}
