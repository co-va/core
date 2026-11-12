// Prices for supplier offers are for one purchasable pack; stock quantities are in item.unit.
// This module deliberately has no Nest/Prisma dependency so price rules can be tested in isolation.
type PriceValue = number | string | null | undefined;
type OfferPrice = {
  offerId?: string;
  supplier?: string;
  listPrice?: PriceValue;
  discountPercent?: PriceValue;
  actualPrice?: PriceValue;
  unitsPerOffer?: PriceValue;
  isActive?: boolean;
};
type ItemPrice = {
  referencePrice?: PriceValue;
  packageQuantity?: PriceValue;
  primaryOfferId?: string | null;
};

function validNumber(value: PriceValue): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function positiveNumber(value: PriceValue): number | null {
  const numeric = validNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

// An explicitly supplied actual price overrides the catalog list price and discount.
export function effectiveSupplierOfferPrice(offer: OfferPrice): number | null {
  const actual = validNumber(offer.actualPrice);
  if (actual !== null) return money(actual);
  const list = validNumber(offer.listPrice);
  if (list === null) return null;
  const discount = validNumber(offer.discountPercent) ?? 0;
  return money(list * (1 - Math.min(discount, 100) / 100));
}

export function supplierOfferUnitPrice(offer: OfferPrice): number | null {
  const total = effectiveSupplierOfferPrice(offer);
  const units = positiveNumber(offer.unitsPerOffer) ?? 1;
  return total == null ? null : money(total / units);
}

// Base price is always comparable: price per nominal item package, not arbitrary supplier pack.
// When the nominated primary offer has no price, the manually entered reference price remains the fallback.
export function resolveInventoryBasePricing(item: ItemPrice, offers: OfferPrice[] = []) {
  const nominalUnits = positiveNumber(item.packageQuantity) ?? 1;
  const primary = offers.find((offer) => offer.isActive !== false && offer.offerId === item.primaryOfferId);
  const primaryUnitPrice = primary ? supplierOfferUnitPrice(primary) : null;
  if (primary && primaryUnitPrice !== null) {
    return {
      basePrice: money(primaryUnitPrice * nominalUnits),
      baseUnitPrice: primaryUnitPrice,
      basePriceSource: 'primary-offer',
      primarySupplier: primary.supplier || '',
    };
  }
  const reference = validNumber(item.referencePrice);
  return {
    basePrice: reference == null ? null : money(reference),
    baseUnitPrice: reference == null ? null : money(reference / nominalUnits),
    basePriceSource: reference == null ? 'unset' : 'reference',
    primarySupplier: primary?.supplier || '',
  };
}
