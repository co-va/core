import { canUseBookCapability } from '../access.js';

const INVENTORY_NAVIGATION = [
  { id: 'stock', label: 'Остатки', capability: 'inventory.stock.access' },
  { id: 'movements', label: 'Движения', capability: 'inventory.movements.access' },
  { id: 'orders', label: 'Заказ', capability: 'inventory.order.access' },
  { id: 'counts', label: 'Инвентаризация', capability: 'inventory.stocktake.access' },
];

export function inventoryNavigationItems() {
  return INVENTORY_NAVIGATION.filter((item) => canUseBookCapability(item.capability)).map(({ id, label }) => ({ id, label }));
}

export async function renderInventorySection(root, section = 'stock') {
  const allowed = inventoryNavigationItems();
  const target = allowed.some((item) => item.id === section) ? section : allowed[0]?.id;
  if (!target) { root.replaceChildren(); return; }
  const { renderInventory } = await import('./inventory.js');
  const cleanup = await renderInventory(root, target);
  const { enhanceInventoryExcel } = await import('./excel-v2.js');
  enhanceInventoryExcel(root, target);
  return cleanup;
}
