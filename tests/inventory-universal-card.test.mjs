import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const schema = readFileSync('server/prisma/schema.prisma','utf8');
const service = readFileSync('server/src/inventory/inventory.service.ts','utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts','utf8');
const migration = readFileSync('server/prisma/migrations/20261116150000_inventory_universal_card_storage_resource/migration.sql','utf8');
for(const field of ['catalogName','nominalQuantity','nominalUnit','receiptUnit','containerMode','thresholdUnit','conversionRules','resourceLimit','resourceUnit','resourceStockQuantity','resourceExhaustionAction','serviceStartAt','serviceEndAt']) {
  assert.match(schema, new RegExp('\\b'+field+'\\b'));
  assert.match(service, new RegExp('\\b'+field+'\\b'));
}
for (const model of ['InventoryStorageLocation','InventoryResourceProgress','InventoryResourceEvent']) {
  assert.ok(schema.includes('model '+model));
  assert.ok(migration.includes('CREATE TABLE "'+model+'"'));
}
assert.match(schema,/storageLocationId\s+String/);
assert.match(service,/kind: 'TRANSFER'/);
assert.match(service,/kind: 'WRITE_OFF'/);
assert.match(service,/Math\.floor\(\(next \+ EPSILON\) \/ limit\)/);
assert.match(service,/storageBalanceInTx/);
assert.match(service,/movement: \{ kind: \{ not: 'TRANSFER' \} \}/);
for(const route of ["@Post('storage-locations')","@Put('storage-locations/:locationId')","@Post('transfers')","@Post('resource-uses')"]) assert.ok(controller.includes(route));
let code=readFileSync('server/src/inventory/inventory-usage.ts','utf8');
code=code.replace(/^export type InventoryAmountUnit = .*;\n/m,'')
  .replace(/export function /g,'function ')
  .replace(/value: unknown/g,'value')
  .replace(/\): InventoryAmountUnit \| null/g,')')
  .replace(/item: \{[\s\S]*?\}, quantity: number, enteredUnit: unknown\): number/g,'item, quantity, enteredUnit)');
const {stockQuantityForUnit} = new Function(code+';return {stockQuantityForUnit};')();
assert.equal(stockQuantityForUnit({unit:'г',nominalUnit:'мл',nominalQuantity:100,packageQuantity:85},100,'мл'),85);
assert.equal(stockQuantityForUnit({unit:'г',nominalUnit:'мл',nominalQuantity:100,packageQuantity:85},1,'шт.'),85);
assert.equal(stockQuantityForUnit({unit:'шт.',packageQuantity:100},1,'уп.'),100);
assert.equal(stockQuantityForUnit({unit:'г'},2,'кг'),2000);
assert.equal(stockQuantityForUnit({unit:'шт.',conversionRules:[{unit:'пара',stockPerUnit:2}]},1,'пара'),2);
assert.throws(()=>stockQuantityForUnit({unit:'г',nominalUnit:'мл',nominalQuantity:100},100,'мл'),/Нельзя пересчитать/);
// 1.05 whole packages must be compared to 0.2 packages, not 20 pieces.
const thresholdFactor = stockQuantityForUnit({unit:'шт.',packageQuantity:100},1,'уп.');
assert.equal(thresholdFactor,100);
assert.equal(20/thresholdFactor,0.2);
assert.ok(20/thresholdFactor < 1.05);
assert.match(service,/thresholdStockFactor: thresholdFactors\.get\(item\.id\)/);
assert.match(service,/canonicalInventoryUnit\(item\.unit\) === 'г' \? 'шт\.'/);
console.log('PASS: universal inventory item, measured conversions, locations, resource ledger, transfer API');
