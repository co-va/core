// Optional preferences, not stock facts. All movements and balances remain in InventoryItem.unit.
export type InventoryAmountUnit = 'г' | 'мл' | 'шт.' | 'уп.';

export function canonicalInventoryUnit(value: unknown): InventoryAmountUnit | null {
  const unit = String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  if (['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(unit)) return 'г';
  if (['мл', 'миллилитр', 'миллилитры'].includes(unit)) return 'мл';
  if (['шт', 'шт.', 'штука', 'штуки'].includes(unit)) return 'шт.';
  if (['уп', 'уп.', 'упаковка', 'упаковки', 'пачка', 'пачки'].includes(unit)) return 'уп.';
  return null;
}

// Converting a pack requires its explicitly known contents. The pack does
// not create another stock unit: 1 уп. -> N шт., N г, or N мл.
// Whole pieces of measured product are also convertible using their net
// contents. g <-> ml requires density and is never inferred.
export function stockQuantityForUnit(item: {
  unit?: unknown; packageQuantity?: unknown; netPackageWeight?: unknown;
}, quantity: number, enteredUnit: unknown): number {
  const stock = canonicalInventoryUnit(item.unit);
  const requested = canonicalInventoryUnit(enteredUnit);
  if (!stock || !requested) throw new Error('Неизвестная единица списания');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Укажите положительное количество');
  if (stock === requested) return quantity;
  if (requested === 'уп.' || (requested === 'шт.' && (stock === 'г' || stock === 'мл'))) {
    if (!Number.isSafeInteger(quantity)) throw new Error('Количество упаковок и штук должно быть целым');
    const specifiedSize = item.packageQuantity == null || item.packageQuantity === ''
      ? NaN : Number(item.packageQuantity);
    const netMass = item.netPackageWeight == null || item.netPackageWeight === ''
      ? NaN : Number(item.netPackageWeight);
    const capacity = Number.isFinite(specifiedSize) && specifiedSize > 0 ? specifiedSize
      : stock === 'г' && Number.isFinite(netMass) && netMass > 0 ? netMass : null;
    if (capacity === null) throw new Error(
      requested === 'уп.' ? 'Укажите количество внутри упаковки' : 'Сначала укажите содержимое одной штуки',
    );
    return Math.round(quantity * capacity * 1000) / 1000;
  }
  throw new Error('Нельзя пересчитать единицу списания в единицу складского учёта');
}
