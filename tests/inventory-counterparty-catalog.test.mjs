import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const schema = read('server/prisma/schema.prisma');
const migration = read('server/prisma/migrations/20261116220000_inventory_counterparty_catalog/migration.sql');
const exclusionMigration = read('server/prisma/migrations/20261118093000_inventory_catalog_exclusion/migration.sql');
const optionalUnitsMigration = read('server/prisma/migrations/20261120090000_inventory_supplier_offer_optional_units/migration.sql');
const controller = read('server/src/inventory/inventory-counterparty.controller.ts');
const service = read('server/src/inventory/inventory-counterparty.service.ts');
const admin = read('admin/commercial-catalog.js');
const readiness = read('server/src/saas-access/readiness-policy.ts');
const catalog = read('server/src/tenant-invitation/tenant-invitation.service.ts');
const inventory = read('server/src/inventory/inventory.service.ts');
for (const model of ['InventoryCounterparty', 'InventoryCounterpartyPriceList', 'InventoryCounterpartyCatalogItem']) {
  assert.ok(schema.includes('model ' + model + ' {'), 'Missing model ' + model);
  assert.ok(migration.includes('CREATE TABLE "' + model + '"'), 'Missing table ' + model);
}
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i);
assert.match(schema, /model InventoryCounterpartyCatalogItem \{[\s\S]*?excludedAt DateTime\?/);
assert.match(exclusionMigration, /ADD COLUMN "excludedAt"/);
assert.doesNotMatch(exclusionMigration, /DELETE FROM|DROP TABLE|TRUNCATE/i);
assert.match(migration, /ALTER TABLE "InventorySupplierOffer" ADD COLUMN "counterpartyId"/);
assert.match(admin, /cabinet\.inventory\.counterparties/);
assert.match(readiness, /'cabinet\.inventory\.counterparties': \['inventory\.counterparties\.access'\]/);
assert.match(catalog, /'inventory\.counterparties\.access'/);
assert.match(inventory, /catalogItemId: offer\.catalogItemId/);
for (const route of ["@Get('template/xlsx')","@Post(':id/pricelists/preview')","@Post(':id/pricelists')","@Get(':id/pricelists/:listId/download')","@Get(':id/catalog')","@Post(':id/catalog/selection')","@Post(':id/catalog/:rowId/link')","@Post(':id/link-item')"]) {
  assert.ok(controller.includes(route), 'Missing route ' + route);
}
assert.match(service, /ExcelJS\.Workbook/);
assert.match(service, /parseExcel\(file\.buffer\)/);
assert.match(service, /parsePdf\(file\.buffer\)/);
assert.match(service, /sheet\.getRow\(n\)/);
assert.match(service, /MAX_ROWS = 10000/);
assert.match(service, /format === 'pdf'/);
assert.match(service, /NEEDS_TEMPLATE/);
assert.match(service, /sourceFile: Uint8Array\.from\(file\.buffer\)/);
assert.match(service, /async setExcluded\(/);
assert.match(service, /excludedAt: excluded \? \{ not: null \} : null/);
assert.match(service, /this\.excludedFromPrevious\(prior, parsed\.rows\)/);
assert.match(service, /async linkCompany\(/);
assert.match(service, /async link\(/);
assert.match(service, /this\.access\.resolveCapability\(tenantId, 'inventory\.counterparties\.access'\)/);
assert.doesNotMatch(service, /inventoryMovement\.(create|update|delete)/);
assert.match(optionalUnitsMigration, /ALTER COLUMN "unitsPerOffer" DROP NOT NULL/);
assert.match(schema, /unitsPerOffer\s+Decimal\?/);
assert.match(service, /const size = explicit \?\?/);
assert.doesNotMatch(service, /Укажите unitsPerOffer для безопасной привязки/);
assert.match(service, /catalogItemId: row\.id/);
console.log('PASS: independent supplier catalog, permissions, PDF/Excel/template, import and links');
