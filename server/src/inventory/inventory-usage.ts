// Optional preferences, not stock facts. All movements and balances remain in InventoryItem.unit.
export type InventoryAmountUnit = 'г' | 'мл' | 'шт.';

export function canonicalInventoryUnit(value: unknown): InventoryAmountUnit | null {
  const unit = String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  if (['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(unit)) return 'г';
  if (['мл', 'миллилитр', 'миллилитры'].includes(unit)) return 'мл';
  if (['шт', 'шт.', 'штука', 'штуки'].includes(unit)) return 'шт.';
  return null;
}

// The only supported cross-unit conversion is a whole piece into known
// content per piece (e.g. a tube into net grams). g <-> ml needs density
// and is deliberately NOT inferred. Neither is a pack of unknown size.
export function stockQuantityForUnit(item: {
  unit?: unknown; packageQuantity?: unknown; netPackageWeight?: unknown;
}, quantity: number, enteredUnit: unknown): number {
  const stock = canonicalInventoryUnit(item.unit);
  const requested = canonicalInventoryUnit(enteredUnit);
  if (!stock || !requested) throw new Error('Неизвестная единица списания');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Укажите положительное количество');
  if (stock === requested) return quantity;
  if (requested === 'шт.' && (stock === 'г' || stock === 'мл')) {
    const size = Number(item.packageQuantity);
    const knownNet = stock === 'г' ? Number(item.netPackageWeight) : NaN;
    const capacity = Number.isFinite(size) && size > 0 ? size
      : Number.isFinite(knownNet) && knownNet > 0 ? knownNet : null;
    if (capacity === null) throw new Error('Сначала укажите содержимое одной штуки');
    if (!Number.isSafeInteger(quantity)) throw new Error('Количество штук должно быть целым');
    return Math.round(quantity * capacity * 1000) / 1000;
  }
  throw new Error('Нельзя пересчитать единицу списания в единицу складского учёта');
}
