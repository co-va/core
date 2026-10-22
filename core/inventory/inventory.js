import {
  actionBlock,
  button,
  emptyState,
  entityVisualCard,
  field,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  searchableSelect,
  select,
  shortDateTimeParts,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { escapeHtml } from '../../ui/utils/escape-html.js';
import {
  getInventoryItem,
  getInventoryItems,
  getInventoryMovement,
  getInventoryMovements,
  inventoryOrderSuggestions,
} from './data.js';
import {
  correctInventoryMovement,
  createInventoryItem,
  createInventoryMovement,
  loadInventory,
  updateInventoryItem,
} from './service.js';

const UNIT_OPTIONS = ['шт.', 'г', 'кг', 'мл', 'л', 'м', 'уп.'].map((value) => ({ value, label: value }));
const EMPTY_MANUFACTURER = 'Без производителя';
const STOCK_VIEW = {
  manufacturersSort: 'name-asc',
  manufacturersType: '',
  itemsSort: 'name-asc',
  itemsType: '',
};
const MANUFACTURER_CARD_APPEARANCE = {
  lines: [
    {}, {}, {}, {}, {},
    { field: 'manufacturer', zone: 'full', align: 'left', size: 'xl', color: 'white', bold: true },
    {},
    { field: 'count', zone: 'full', align: 'left', size: 'm', color: 'white' },
    {},
  ],
};

function numberText(value, maximum = 3) {
  const number = Number(value) || 0;
  return number.toLocaleString('ru-RU', { maximumFractionDigits: maximum }).replaceAll('\u00a0', ' ');
}

function moneyText(value) {
  const number = Number(value) || 0;
  return `${number.toLocaleString('ru-RU', { maximumFractionDigits: 2 }).replaceAll('\u00a0', ' ')} ₽`;
}

function normalizedSearch(value = '') {
  return String(value || '').trim().toLocaleLowerCase('ru-RU');
}

function itemSearchText(item = {}) {
  return [
    item.manufacturer,
    item.name,
    item.productType,
    item.category,
    item.location,
    item.sku,
    item.barcode,
  ].filter(Boolean).join(' ').toLocaleLowerCase('ru-RU');
}

function manufacturerName(item = {}) {
  return String(item.manufacturer || '').trim() || EMPTY_MANUFACTURER;
}

function productTypeText(item = {}) {
  return String(item.productType || item.category || '').trim();
}

function sortItems(items = [], mode = STOCK_VIEW.itemsSort) {
  const rows = [...items];
  const byName = (left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'ru', { numeric: true, sensitivity: 'base' });
  if (mode === 'name-desc') return rows.sort((left, right) => byName(right, left));
  if (mode === 'balance-asc') return rows.sort((left, right) => (Number(left.balance) || 0) - (Number(right.balance) || 0) || byName(left, right));
  if (mode === 'balance-desc') return rows.sort((left, right) => (Number(right.balance) || 0) - (Number(left.balance) || 0) || byName(left, right));
  if (mode === 'type-asc') return rows.sort((left, right) => productTypeText(left).localeCompare(productTypeText(right), 'ru', { sensitivity: 'base' }) || byName(left, right));
  return rows.sort(byName);
}

function matchesType(item, type = '') {
  return !type || productTypeText(item) === type;
}

function stockTypeOptions(manufacturer = '') {
  const values = [...new Set(getInventoryItems()
    .filter((item) => !manufacturer || manufacturerName(item) === manufacturer)
    .map(productTypeText)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ru', { numeric: true, sensitivity: 'base' }));
  return [{ value: '', label: 'Все типы' }, ...values.map((value) => ({ value, label: value }))];
}

function manufacturerGroups(query = '', type = STOCK_VIEW.manufacturersType) {
  const needle = normalizedSearch(query);
  const groups = new Map();
  getInventoryItems().forEach((item) => {
    if (!matchesType(item, type)) return;
    const manufacturer = manufacturerName(item);
    if (needle && !`${manufacturer} ${itemSearchText(item)}`.toLocaleLowerCase('ru-RU').includes(needle)) return;
    const rows = groups.get(manufacturer) || [];
    rows.push(item);
    groups.set(manufacturer, rows);
  });
  const result = [...groups.entries()].map(([name, items]) => ({ name, items }));
  const byName = (left, right) => left.name.localeCompare(right.name, 'ru', { numeric: true, sensitivity: 'base' });
  if (STOCK_VIEW.manufacturersSort === 'name-desc') result.sort((left, right) => byName(right, left));
  else if (STOCK_VIEW.manufacturersSort === 'count-desc') result.sort((left, right) => right.items.length - left.items.length || byName(left, right));
  else if (STOCK_VIEW.manufacturersSort === 'count-asc') result.sort((left, right) => left.items.length - right.items.length || byName(left, right));
  else result.sort(byName);
  return result;
}

function movementTitle(movement = {}) {
  if (movement.personUei) return String(movement.personUei);
  if (movement.kind === 'RECEIPT') return 'Приход';
  if (movement.kind === 'CONSUMPTION') return 'Расход';
  if (movement.kind === 'WRITE_OFF') return 'Списание';
  if (movement.kind === 'SALE') return 'Продажа';
  if (movement.kind === 'RETURN') return 'Возврат';
  if (movement.kind === 'ADJUSTMENT') return 'Инвентаризация';
  if (movement.kind === 'CORRECTION') return 'Корректировка';
  return 'Движение';
}

function movementSubtitle(movement = {}) {
  return [movement.procedureKey, movement.note].filter(Boolean).join(' · ');
}

function movementMoment(value) {
  const parts = shortDateTimeParts(value || '');
  return [parts.date, parts.time].filter(Boolean).join(' · ');
}

function movementSign(line = {}) {
  return line.direction === 'OUT' ? '−' : '+';
}

function notifyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function context(title, { a = null, c = null } = {}) {
  return workspaceHeaderContext({ title, a, c });
}

function itemOptions() {
  return getInventoryItems().map((item) => ({
    value: item.itemId,
    label: item.name,
    meta: `${numberText(item.balance)} ${item.unit}`,
  }));
}

function itemSummary(item) {
  return `<div class="entity-details entity-details--split">
    <div><span>Остаток</span><strong>${escapeHtml(`${numberText(item.balance)} ${item.unit}`)}</strong></div>
    ${item.lastPurchasePrice == null ? '' : `<div><span>Последняя цена</span><strong>${escapeHtml(moneyText(item.lastPurchasePrice))}</strong></div>`}
    ${item.category ? `<div><span>Категория</span><strong>${escapeHtml(item.category)}</strong></div>` : ''}
    ${item.location ? `<div><span>Место</span><strong>${escapeHtml(item.location)}</strong></div>` : ''}
    ${item.supplier ? `<div><span>Поставщик</span><strong>${escapeHtml(item.supplier)}</strong></div>` : ''}
  </div>`;
}

function advancedItemFields(item = {}) {
  return `
    ${field({ label: 'Категория', name: 'category', value: item.category || '' })}
    ${field({ label: 'Поставщик', name: 'supplier', value: item.supplier || '' })}
    ${field({ label: 'Место хранения', name: 'location', value: item.location || '' })}
    ${field({ label: 'Артикул', name: 'sku', value: item.sku || '' })}
    ${field({ label: 'Штрихкод', name: 'barcode', value: item.barcode || '' })}
    ${twoColumnLayout(
      field({ label: 'Минимум', name: 'minStock', value: item.minStock ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
      field({ label: 'Цель', name: 'targetStock', value: item.targetStock ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' }),
      { ariaLabel: 'Правила остатка' },
    )}
    ${field({ label: 'В упаковке', name: 'packageQuantity', value: item.packageQuantity ?? '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' })}`;
}

function openAdvancedItemModal(trigger, item = {}) {
  const content = `<form id="inventory-advanced-form" data-inventory-advanced-form>
    ${advancedItemFields(item)}
    ${button('Применить', { type: 'submit' })}
  </form>`;
  return mountModal(trigger, modal(content, { title: 'Дополнительно', variant: 'x' }));
}

function collectOptionalNumber(form, name) {
  const raw = String(new FormData(form).get(name) ?? '').trim();
  return raw === '' ? null : Number(raw.replace(',', '.'));
}

function openItemEditor(root, itemId = '', defaults = {}) {
  const item = itemId ? getInventoryItem(itemId) : null;
  const creating = !item;
  const markup = `
    ${context(creating ? 'Новая позиция' : item.name, {
      a: { kind: 'settings', data: 'data-inventory-item-advanced', aria: 'Дополнительные настройки позиции' },
    })}
    <form data-inventory-item-form>
      ${field({ label: 'Производитель', name: 'manufacturer', value: item?.manufacturer || defaults.manufacturer || '', autocomplete: 'off' })}
      ${field({ label: 'Наименование', name: 'name', value: item?.name || '', required: true, autocomplete: 'off' })}
      ${twoColumnLayout(
        select({ label: 'Единица', name: 'unit', value: item?.unit || 'шт.', options: UNIT_OPTIONS }),
        creating
          ? field({ label: 'Количество', name: 'quantity', value: '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal' })
          : field({ label: 'Остаток', name: 'balance', value: numberText(item?.balance), readonly: true }),
        { ariaLabel: 'Единица и количество' },
      )}
      ${field({ label: 'Цена закупки', name: 'purchasePrice', value: item?.lastPurchasePrice ?? '', type: 'number', min: '0', step: '0.01', inputmode: 'decimal' })}
      ${item ? itemSummary(item) : ''}
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-inventory-item-save', aria: 'Сохранить позицию' }))}
    </form>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-item-z' }), { stack: true });
  if (!layer) return;

  let advanced = {
    category: item?.category || '',
    supplier: item?.supplier || '',
    location: item?.location || '',
    sku: item?.sku || '',
    barcode: item?.barcode || '',
    minStock: item?.minStock ?? null,
    targetStock: item?.targetStock ?? null,
    packageQuantity: item?.packageQuantity ?? null,
  };

  layer.querySelector('[data-inventory-item-advanced]')?.addEventListener('click', (event) => {
    const modalRoot = openAdvancedItemModal(event.currentTarget, advanced);
    const form = modalRoot?.querySelector('[data-inventory-advanced-form]');
    if (!form) return;
    form.addEventListener('submit', (submitEvent) => {
      submitEvent.preventDefault();
      const data = new FormData(form);
      advanced = {
        category: String(data.get('category') || '').trim(),
        supplier: String(data.get('supplier') || '').trim(),
        location: String(data.get('location') || '').trim(),
        sku: String(data.get('sku') || '').trim(),
        barcode: String(data.get('barcode') || '').trim(),
        minStock: collectOptionalNumber(form, 'minStock'),
        targetStock: collectOptionalNumber(form, 'targetStock'),
        packageQuantity: collectOptionalNumber(form, 'packageQuantity'),
      };
      modalRoot.v2Close?.();
    });
  });

  layer.querySelector('[data-inventory-item-save]')?.addEventListener('click', async () => {
    const form = layer.querySelector('[data-inventory-item-form]');
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    if (!name) {
      openNotice({ title: 'Наименование', message: 'Укажите наименование позиции.' });
      return;
    }
    const value = {
      manufacturer: String(data.get('manufacturer') || '').trim(),
      name,
      unit: String(data.get('unit') || 'шт.'),
      lastPurchasePrice: collectOptionalNumber(form, 'purchasePrice'),
      ...advanced,
    };
    if (creating) {
      value.quantity = Math.max(0, Number(String(data.get('quantity') || '0').replace(',', '.')) || 0);
      value.purchasePrice = value.lastPurchasePrice;
    }
    try {
      if (creating) await createInventoryItem(value);
      else await updateInventoryItem(item.itemId, value);
      layer.v2Close?.();
      renderStock(root);
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: error instanceof Error ? error.message : 'Ошибка склада' });
    }
  });
  notifyContext();
}

function movementEditorRow(row = {}, index = 0) {
  const item = getInventoryItem(row.itemId);
  const quantity = row.quantity == null ? '' : Number(row.quantity);
  const direction = row.direction === 'IN' || row.direction === 'OUT' ? row.direction : '';
  return `<div data-inventory-movement-row data-row-index="${index}" data-row-direction="${escapeHtml(direction)}">
    ${twoColumnLayout(
      searchableSelect({
        label: 'Материал',
        name: `itemId-${index}`,
        value: row.itemId || '',
        options: itemOptions(),
        placeholder: 'Выбрать',
        required: true,
      }),
      field({
        label: item?.unit ? `Количество, ${item.unit}` : 'Количество',
        name: `quantity-${index}`,
        value: quantity,
        type: 'number',
        min: '0',
        step: '0.001',
        inputmode: 'decimal',
      }),
      { ariaLabel: 'Материал и количество' },
    )}
  </div>`;
}

function collectMovementRows(host) {
  return [...host.querySelectorAll('[data-inventory-movement-row]')].map((row) => {
    const index = row.dataset.rowIndex;
    const itemId = row.querySelector(`[name="itemId-${CSS.escape(index)}"]`)?.value || '';
    const quantity = Number(String(row.querySelector(`[name="quantity-${CSS.escape(index)}"]`)?.value || '0').replace(',', '.')) || 0;
    const direction = row.dataset.rowDirection === 'IN' || row.dataset.rowDirection === 'OUT' ? row.dataset.rowDirection : undefined;
    return { itemId, quantity, ...(direction ? { direction } : {}) };
  }).filter((row) => row.itemId && row.quantity > 0);
}

function openMovementEditor(root, movementId = '', kind = 'CONSUMPTION') {
  const movement = movementId ? getInventoryMovement(movementId) : null;
  const correcting = Boolean(movement);
  const initialRows = movement?.lines?.length
    ? movement.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, direction: line.direction }))
    : [{ itemId: '', quantity: '' }];
  const title = correcting ? movementTitle(movement) : movementTitle({ kind });
  const markup = `
    ${context(title)}
    <form data-inventory-movement-form>
      ${correcting && movement.personUei ? `<div class="entity-details"><div><span>UEI</span><strong>${escapeHtml(movement.personUei)}</strong></div></div>` : ''}
      <div data-inventory-movement-rows>${initialRows.map(movementEditorRow).join('')}</div>
      ${button('+ Добавить позицию', { type: 'button', variant: 'secondary', data: 'data-inventory-add-movement-row' })}
      ${field({ label: 'Примечание', name: 'note', value: movement?.note || '' })}
      ${actionBlock(button(correcting ? 'Исправить' : 'Сохранить', { type: 'button', data: 'data-inventory-movement-save' }))}
    </form>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-movement-z' }), { stack: true });
  if (!layer) return;

  let rowIndex = initialRows.length;
  layer.querySelector('[data-inventory-add-movement-row]')?.addEventListener('click', () => {
    layer.querySelector('[data-inventory-movement-rows]')?.insertAdjacentHTML('beforeend', movementEditorRow({}, rowIndex));
    rowIndex += 1;
  });

  layer.addEventListener('change', (event) => {
    const selectInput = event.target.closest?.('input[name^="itemId-"]');
    if (!selectInput) return;
    const row = selectInput.closest('[data-inventory-movement-row]');
    const item = getInventoryItem(selectInput.value);
    const label = row?.querySelector('input[name^="quantity-"]')?.closest('.field')?.querySelector(':scope > span');
    if (label) label.textContent = item?.unit ? `Количество, ${item.unit}` : 'Количество';
  });

  layer.querySelector('[data-inventory-movement-save]')?.addEventListener('click', async () => {
    const form = layer.querySelector('[data-inventory-movement-form]');
    const lines = collectMovementRows(layer);
    if (!lines.length) {
      openNotice({ title: 'Позиции', message: 'Добавьте хотя бы один материал и количество.' });
      return;
    }
    try {
      if (correcting) {
        await correctInventoryMovement(movement.movementId, {
          lines,
          note: String(new FormData(form).get('note') || '').trim(),
        });
      } else {
        await createInventoryMovement({
          kind,
          sourceType: 'manual',
          note: String(new FormData(form).get('note') || '').trim(),
          lines,
        });
      }
      layer.v2Close?.();
      renderMovements(root);
    } catch (error) {
      openNotice({ title: 'Не удалось сохранить', message: error instanceof Error ? error.message : 'Ошибка склада' });
    }
  });
  notifyContext();
}

function openMovementKind(root, trigger) {
  const actions = [
    ['RECEIPT', 'Приход'],
    ['CONSUMPTION', 'Расход'],
    ['WRITE_OFF', 'Списание'],
    ['RETURN', 'Возврат'],
  ];
  const content = actions.map(([kind, label]) => button(label, {
    type: 'button',
    variant: 'secondary',
    data: `data-inventory-kind="${kind}"`,
  })).join('');
  const modalRoot = mountModal(trigger, modal(content, { title: 'Операция', variant: 'x' }));
  modalRoot?.querySelectorAll('[data-inventory-kind]').forEach((control) => {
    control.addEventListener('click', () => {
      const selectedKind = control.dataset.inventoryKind;
      modalRoot.v2Close?.();
      openMovementEditor(root, '', selectedKind);
    });
  });
}

function stockSearchField(value = '', data = 'data-inventory-stock-search') {
  return field({
    label: 'Поиск',
    name: 'inventorySearch',
    value,
    type: 'search',
    autocomplete: 'off',
    placeholder: 'Название, тип, артикул…',
    data,
  });
}

function stockManufacturerCardsMarkup(query = '') {
  const groups = manufacturerGroups(query);
  if (!getInventoryItems().length) return emptyState('Склад пуст', 'Добавьте первую позицию.');
  if (!groups.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');
  const cards = groups.map(({ name, items }) => entityVisualCard({
    appearance: MANUFACTURER_CARD_APPEARANCE,
    fields: [
      { value: 'manufacturer', label: 'Компания', text: name },
      { value: 'count', label: 'Позиции', text: `${items.length} ${items.length === 1 ? 'позиция' : items.length > 1 && items.length < 5 ? 'позиции' : 'позиций'}` },
    ],
    interactive: true,
    data: `data-inventory-manufacturer="${escapeHtml(name)}"`,
    aria: `Открыть товары ${name}`,
  }));
  return `<div class="entity-card-rail" data-entity-card-rail>${cards.join('')}</div>`;
}

function stockListMarkup(manufacturer, query = '') {
  const needle = normalizedSearch(query);
  const items = sortItems(getInventoryItems().filter((item) => {
    if (manufacturerName(item) !== manufacturer) return false;
    if (!matchesType(item, STOCK_VIEW.itemsType)) return false;
    return !needle || itemSearchText(item).includes(needle);
  }), STOCK_VIEW.itemsSort);
  if (!items.length) return emptyState('Ничего не найдено', 'Измените поиск или фильтр.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.name,
    subtitle: [productTypeText(item), item.location].filter(Boolean).join(' · '),
    rightTop: `${numberText(item.balance)} ${item.unit}`,
    rightBottom: item.lastPurchasePrice == null ? '' : moneyText(item.lastPurchasePrice),
    interactive: true,
    initial: '',
    data: `data-inventory-item="${escapeHtml(item.itemId)}"`,
    aria: `Открыть ${item.name}`,
  })));
}

function stockSortOptions(level) {
  if (level === 'manufacturers') {
    return [
      { value: 'name-asc', label: 'Название А—Я' },
      { value: 'name-desc', label: 'Название Я—А' },
      { value: 'count-desc', label: 'Больше позиций сначала' },
      { value: 'count-asc', label: 'Меньше позиций сначала' },
    ];
  }
  return [
    { value: 'name-asc', label: 'Название А—Я' },
    { value: 'name-desc', label: 'Название Я—А' },
    { value: 'type-asc', label: 'По типу' },
    { value: 'balance-desc', label: 'Остаток: больше сначала' },
    { value: 'balance-asc', label: 'Остаток: меньше сначала' },
  ];
}

function openStockControls(trigger, level, manufacturer, onChange) {
  const sortKey = level === 'manufacturers' ? 'manufacturersSort' : 'itemsSort';
  const typeKey = level === 'manufacturers' ? 'manufacturersType' : 'itemsType';
  const content = `<div data-inventory-stock-controls>
    ${select({
      label: 'Сортировка',
      name: 'inventorySort',
      value: STOCK_VIEW[sortKey],
      options: stockSortOptions(level),
      aria: 'Сортировка остатков',
    })}
    ${select({
      label: 'Фильтр',
      name: 'inventoryType',
      value: STOCK_VIEW[typeKey],
      options: stockTypeOptions(level === 'items' ? manufacturer : ''),
      aria: 'Фильтр по типу продукта',
    })}
  </div>`;
  const modalRoot = mountModal(trigger, modal(content, { title: 'Сортировка и фильтр', variant: 'x' }));
  modalRoot?.querySelector('input[name="inventorySort"]')?.addEventListener('change', (event) => {
    STOCK_VIEW[sortKey] = event.target.value;
    onChange?.();
  });
  modalRoot?.querySelector('input[name="inventoryType"]')?.addEventListener('change', (event) => {
    STOCK_VIEW[typeKey] = event.target.value;
    onChange?.();
  });
}

function bindManufacturerCards(root, host) {
  host.querySelectorAll('[data-inventory-manufacturer]').forEach((control) => {
    control.addEventListener('click', () => openManufacturerStock(root, control.dataset.inventoryManufacturer));
  });
}

function openManufacturerStock(root, manufacturer) {
  STOCK_VIEW.itemsType = '';
  const markup = `
    ${context(manufacturer, {
      a: { kind: 'settings', data: 'data-inventory-item-controls', aria: 'Сортировка и фильтр товаров' },
      c: { label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
    })}
    ${stockSearchField('', 'data-inventory-company-search')}
    <div data-inventory-company-list>${stockListMarkup(manufacturer)}</div>`;
  const layer = mountV2ZLayer(root, v2ZLayer(markup, { className: 'inventory-manufacturer-z' }), { stack: true });
  if (!layer) return;

  const listHost = layer.querySelector('[data-inventory-company-list]');
  const renderList = () => {
    const query = layer.querySelector('[name="inventorySearch"]')?.value || '';
    if (listHost) listHost.innerHTML = stockListMarkup(manufacturer, query);
    listHost?.querySelectorAll('[data-inventory-item]').forEach((control) => control.addEventListener('click', () => openItemEditor(root, control.dataset.inventoryItem)));
  };

  layer.querySelector('[name="inventorySearch"]')?.addEventListener('input', renderList);
  layer.querySelector('[data-inventory-item-controls]')?.addEventListener('click', (event) => openStockControls(event.currentTarget, 'items', manufacturer, renderList));
  layer.querySelector('[data-inventory-add-item]')?.addEventListener('click', () => openItemEditor(root, '', { manufacturer: manufacturer === EMPTY_MANUFACTURER ? '' : manufacturer }));
  renderList();
  notifyContext();
}

function movementJournalMarkup() {
  const movements = getInventoryMovements();
  if (!movements.length) return emptyState('Движений пока нет', 'Приходы и расходы будут собираться здесь блоками.');
  const rows = movements.map((movement, movementIndex) => {
    const header = `<button type="button" class="ui-list__item ui-list__item--group-header${movementIndex ? ' ui-list__item--group-start' : ''}" data-inventory-movement="${escapeHtml(movement.movementId)}" aria-label="Открыть движение ${escapeHtml(movementTitle(movement))}">
      <span class="ui-list__main"><span class="ui-list__title">${escapeHtml(movementTitle(movement))}</span>${movementSubtitle(movement) ? `<span class="ui-list__secondary">${escapeHtml(movementSubtitle(movement))}</span>` : ''}</span>
      <span class="ui-list__right-secondary"><span>${escapeHtml(movementMoment(movement.occurredAt))}</span></span>
    </button>`;
    const lines = (Array.isArray(movement.lines) ? movement.lines : []).map((line) => `<div class="ui-list__item">
      <span class="ui-list__main"><span class="ui-list__title">${escapeHtml(line.name || '')}</span></span>
      <span class="ui-list__right-secondary"><span>${escapeHtml(`${movementSign(line)}${numberText(line.quantity)} ${line.unit || ''}`)}</span></span>
    </div>`).join('');
    return header + lines;
  }).join('');
  return `<div class="ui-list ui-list--dense" data-ui-list>${rows}</div>`;
}

function orderMarkup() {
  const items = inventoryOrderSuggestions();
  if (!items.length) return emptyState('Заказывать пока нечего', 'Когда будет указан минимальный остаток, здесь появятся предложения.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.name,
    subtitle: `Осталось ${numberText(item.balance)} ${item.unit}`,
    rightTop: `${numberText(item.suggestedQuantity)} ${item.unit}`,
    rightBottom: 'Рекомендация',
    initial: '',
  })));
}

function inventoryCountMarkup() {
  const items = getInventoryItems();
  if (!items.length) return emptyState('Склад пуст', 'Сначала добавьте позиции.');
  return `<form data-inventory-count-form>${items.map((item, index) => twoColumnLayout(
    field({ label: item.name, name: `expected-${index}`, value: `${numberText(item.balance)} ${item.unit}`, readonly: true }),
    field({ label: 'По факту', name: `actual-${index}`, value: '', type: 'number', min: '0', step: '0.001', inputmode: 'decimal', data: `data-count-item="${escapeHtml(item.itemId)}"` }),
    { ariaLabel: `Инвентаризация ${item.name}` },
  )).join('')}</form>`;
}

function renderStock(root) {
  STOCK_VIEW.manufacturersType = '';
  root.innerHTML = `${context('Остатки', {
    a: { kind: 'settings', data: 'data-inventory-manufacturer-controls', aria: 'Сортировка и фильтр производителей' },
    c: { label: '+', data: 'data-inventory-add-item', aria: 'Добавить позицию' },
  })}${stockSearchField()}<div data-inventory-manufacturer-list>${stockManufacturerCardsMarkup()}</div>`;

  const listHost = root.querySelector('[data-inventory-manufacturer-list]');
  const renderManufacturers = () => {
    const query = root.querySelector('[name="inventorySearch"]')?.value || '';
    if (listHost) listHost.innerHTML = stockManufacturerCardsMarkup(query);
    if (listHost) bindManufacturerCards(root, listHost);
  };

  root.querySelector('[name="inventorySearch"]')?.addEventListener('input', renderManufacturers);
  root.querySelector('[data-inventory-manufacturer-controls]')?.addEventListener('click', (event) => openStockControls(event.currentTarget, 'manufacturers', '', renderManufacturers));
  root.querySelector('[data-inventory-add-item]')?.addEventListener('click', () => openItemEditor(root));
  renderManufacturers();
  notifyContext();
}

function renderMovements(root) {
  root.innerHTML = `${context('Движения', {
    c: { label: '+', data: 'data-inventory-add-movement', aria: 'Добавить движение' },
  })}${movementJournalMarkup()}`;
  root.querySelector('[data-inventory-add-movement]')?.addEventListener('click', (event) => openMovementKind(root, event.currentTarget));
  root.querySelectorAll('[data-inventory-movement]').forEach((control) => control.addEventListener('click', () => openMovementEditor(root, control.dataset.inventoryMovement)));
  notifyContext();
}

function renderOrders(root) {
  root.innerHTML = `${context('Заказ')}${orderMarkup()}`;
  notifyContext();
}

function renderInventoryCount(root) {
  root.innerHTML = `${context('Инвентаризация')}${inventoryCountMarkup()}${actionBlock(button('Завершить', { type: 'button', data: 'data-inventory-count-save', aria: 'Завершить инвентаризацию' }))}`;
  root.querySelector('[data-inventory-count-save]')?.addEventListener('click', async () => {
    const form = root.querySelector('[data-inventory-count-form]');
    if (!form) return;
    const lines = [...form.querySelectorAll('[data-count-item]')].map((input) => {
      const item = getInventoryItem(input.dataset.countItem);
      const raw = String(input.value || '').trim();
      if (!raw || !item) return null;
      const actual = Math.max(0, Number(raw.replace(',', '.')) || 0);
      const expected = Number(item.balance) || 0;
      const difference = actual - expected;
      if (Math.abs(difference) < 0.000001) return null;
      return {
        itemId: item.itemId,
        quantity: difference,
        expectedQuantity: expected,
        actualQuantity: actual,
      };
    }).filter(Boolean);
    if (!lines.length) {
      openNotice({ title: 'Инвентаризация', message: 'Расхождений нет или фактические значения не введены.' });
      return;
    }
    try {
      await createInventoryMovement({ kind: 'ADJUSTMENT', sourceType: 'inventory-count', note: 'Инвентаризация', lines });
      renderInventoryCount(root);
    } catch (error) {
      openNotice({ title: 'Не удалось завершить', message: error instanceof Error ? error.message : 'Ошибка склада' });
    }
  });
  notifyContext();
}

export async function renderInventory(root, section = 'stock') {
  root.innerHTML = emptyState('Склад', 'Загружаем данные…');
  try {
    await loadInventory();
  } catch (error) {
    root.innerHTML = emptyState('Склад недоступен', error instanceof Error ? error.message : 'Не удалось загрузить данные.');
    return () => {};
  }

  if (section === 'movements') renderMovements(root);
  else if (section === 'orders') renderOrders(root);
  else if (section === 'counts') renderInventoryCount(root);
  else renderStock(root);
  return () => {};
}
