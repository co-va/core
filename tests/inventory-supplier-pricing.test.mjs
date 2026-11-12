import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

// These are pure, executable pricing calculations; no DB or Nest instance is required.
const pureSource = stripTypeScriptTypes(fs.readFileSync('server/src/inventory/inventory-pricing.ts', 'utf8'));
const {
  effectiveSupplierOfferPrice,
  supplierOfferUnitPrice,
  resolveInventoryBasePricing,
} = await import('data:text/javascript;base64,' + Buffer.from(pureSource).toString('base64'));

const standard = { offerId: 'main', supplier: 'Обычный поставщик', listPrice: 1000,
  discountPercent: 10, actualPrice: null, unitsPerOffer: 250 };
const onSale = { offerId: 'market', supplier: 'Маркетплейс', actualPrice: 770, unitsPerOffer: 250 };
const primaryProduct = { packageQuantity: 250, referencePrice: 950, primaryOfferId: 'main' };

assert.equal(effectiveSupplierOfferPrice(standard), 900, 'list price minus discount');
assert.equal(effectiveSupplierOfferPrice({ ...standard, actualPrice: 820 }), 820, 'actual offer cost overrides discounted price');
assert.equal(supplierOfferUnitPrice(standard), 3.6, 'one stocked ml costs 3.6');
assert.equal(supplierOfferUnitPrice(onSale), 3.08, 'secondary supplier retains its own cost');
assert.deepEqual(resolveInventoryBasePricing(primaryProduct, [standard, onSale]), {
  basePrice: 900, baseUnitPrice: 3.6, basePriceSource: 'primary-offer', primarySupplier: 'Обычный поставщик',
}, 'primary supplier determines baseline, not newest or cheapest offer');

const changedSecondary = { ...onSale, actualPrice: 600 };
assert.equal(resolveInventoryBasePricing(primaryProduct, [standard, changedSecondary]).basePrice, 900,
  'changing a secondary offer does not alter the baseline');
assert.equal(resolveInventoryBasePricing(primaryProduct, [standard, { ...onSale, actualPrice: 1000 }]).basePrice, 900,
  'secondary offer can be more expensive without changing the baseline');
assert.equal(resolveInventoryBasePricing({ ...primaryProduct, primaryOfferId: 'market' }, [standard, onSale]).basePrice, 770,
  'changing the primary offer changes the baseline');
assert.equal(resolveInventoryBasePricing(primaryProduct, [onSale]).basePrice, 950,
  'archived or missing primary offer falls back to manual reference price');
assert.equal(resolveInventoryBasePricing({ packageQuantity: 250 }, []).basePrice, null, 'missing price is not silently zero');

assert.deepEqual(resolveInventoryBasePricing({ packageQuantity: 250, primaryOfferId: 'large' }, [
  { offerId: 'large', supplier: 'Большая упаковка', actualPrice: 1500, unitsPerOffer: 500 },
]), { basePrice: 750, baseUnitPrice: 3, basePriceSource: 'primary-offer', primarySupplier: 'Большая упаковка' },
'compare prices for the SAME nominal size');
assert.equal(resolveInventoryBasePricing({ packageQuantity: 9, primaryOfferId: 'pack' }, [
  { offerId: 'pack', supplier: 'Упаковка', actualPrice: 1000, unitsPerOffer: 3 },
]).basePrice, 3000, 'round total AFTER pack conversion');
assert.equal(effectiveSupplierOfferPrice({ actualPrice: 0, listPrice: 900 }), 0, 'explicit zero is not missing');

const controller = fs.readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
for (const route of [
  "@Post('items/:itemId/offers')",
  "@Put('items/:itemId/offers/:offerId')",
  "@Delete('items/:itemId/offers/:offerId')",
  "@Put('items/:itemId/primary-offer')",
]) assert.ok(controller.includes(route), 'Missing supplier API: ' + route);
const service = fs.readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
assert.match(service, /where: \{ tenantId, inventoryItemId: item\.id, offerId, isActive: true \}/,
  'supplier CRUD must be tenant- and product-scoped');
assert.match(service, /line\.unitCost \?\? offerUnitPrice/, 'explicit purchase price has precedence');
assert.match(service, /supplier: lotSupplier/, 'actual receipt supplier is captured in its historical lot');
assert.match(service, /data: \{ isActive: false \}/, 'offers must be archived, not physically deleted');
assert.match(service, /Единицу учёта нельзя менять после складских движений/,
  'historical quantities cannot be reinterpreted');
const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8');
assert.match(schema, /referencePrice\s+Decimal\?/);
assert.match(schema, /primaryOfferId\s+String\?/);
assert.match(schema, /unitsPerOffer\s+Decimal/);
const migration = fs.readFileSync('server/prisma/migrations/20261112183000_inventory_supplier_base_prices/migration.sql', 'utf8');
assert.match(migration, /ADD COLUMN "unitsPerOffer"/);
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|TRUNCATE/, 'migration must preserve stock history');

console.log('Inventory supplier offers: normalized prices, primary baseline, archive and API contract: OK');
