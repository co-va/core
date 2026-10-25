const INVENTORY_NAVIGATION = [
  { id: 'stock', label: 'Остатки' },
  { id: 'movements', label: 'Движения' },
  { id: 'orders', label: 'Заказ' },
  { id: 'counts', label: 'Инвентаризация' },
];

export function inventoryNavigationItems() {
  return INVENTORY_NAVIGATION.map((item) => ({ ...item }));
}

export async function renderInventorySection(root, section = 'stock') {
  const target = INVENTORY_NAVIGATION.some((item) => item.id === section) ? section : 'stock';
  const { renderInventory } = await import('./inventory.js');
  const cleanup = await renderInventory(root, target);
  const { enhanceInventoryExcel } = await import('./excel-v2.js');
  enhanceInventoryExcel(root, target);
  return cleanup;
}
