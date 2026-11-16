// Optional preferences, not stock facts. All movements and balances remain in InventoryItem.unit.
export type InventoryAmountUnit = 'г' | 'мл' | 'шт.' | 'уп.' | 'кг' | 'л' | 'м' | 'см' | 'м²' | 'пара' | 'компл.';

export function canonicalInventoryUnit(value: unknown): InventoryAmountUnit | null {
  const unit = String(value ?? '').trim().toLocaleLowerCase('ru-RU');
  if (['г', 'гр', 'гр.', 'грамм', 'граммы'].includes(unit)) return 'г';
  if (['мл', 'миллилитр', 'миллилитры'].includes(unit)) return 'мл';
  if (['шт', 'шт.', 'штука', 'штуки'].includes(unit)) return 'шт.';
  if (['уп', 'уп.', 'упаковка', 'упаковки', 'пачка', 'пачки'].includes(unit)) return 'уп.';
  if (['кг', 'килограмм', 'килограммы'].includes(unit)) return 'кг';
  if (['л', 'литр', 'литры'].includes(unit)) return 'л';
  if (['м', 'метр', 'метры'].includes(unit)) return 'м';
  if (['см', 'сантиметр', 'сантиметры'].includes(unit)) return 'см';
  if (['м²', 'кв.м', 'кв. м'].includes(unit)) return 'м²';
  if (['пара', 'пары', 'пар'].includes(unit)) return 'пара';
  if (['компл.', 'комплект', 'комплекты'].includes(unit)) return 'компл.';
  return null;
}

// Converting a pack requires its explicitly known contents. The pack does
// not create another stock unit: 1 уп. -> N шт., N г, or N мл.
// Whole pieces of measured product are also convertible using their net
// contents. g <-> ml requires density and is never inferred.
export function stockQuantityForUnit(item: {
  unit?: unknown; packageQuantity?: unknown; netPackageWeight?: unknown;
  nominalQuantity?: unknown; nominalUnit?: unknown; conversionRules?: unknown;
}, quantity: number, enteredUnit: unknown): number {
  const stock = canonicalInventoryUnit(item.unit);
  const requested = canonicalInventoryUnit(enteredUnit);
  if (!stock || !requested) throw new Error('Неизвестная единица списания');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Укажите положительное количество');
  if (stock === requested) return quantity;
  // Intrinsic metric conversions never require a new stock unit.
  const metric = Object.fromEntries([['кг>г', 1000], ['г>кг', 0.001], ['л>мл', 1000], ['мл>л', 0.001], ['м>см', 100], ['см>м', 0.01]]);
  const intrinsic = metric[requested + '>' + stock];
  if (intrinsic) return Math.round(quantity * intrinsic * 1000) / 1000;
  const rules = Array.isArray(item.conversionRules) ? item.conversionRules : [];
  const explicit = rules.find((entry) => canonicalInventoryUnit(entry?.unit) === requested);
  if (explicit) {
    const factor = Number(explicit.stockPerUnit);
    if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('Неверный коэффициент пересчёта');
    return Math.round(quantity * factor * 1000) / 1000;
  }
  // A commercial nominal (100 ml) never implies a weight. A distinct,
  // explicitly saved stock quantity (85 g) is required for this conversion.
  const nominalUnit = canonicalInventoryUnit(item.nominalUnit);
  const nominal = Number(item.nominalQuantity);
  const stockPack = Number(item.packageQuantity);
  if (nominalUnit === requested && nominal > 0 && stockPack > 0 && Number.isFinite(nominal) && Number.isFinite(stockPack)) {
    return Math.round(quantity * stockPack / nominal * 1000) / 1000;
  }
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
