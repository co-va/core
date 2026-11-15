import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let code=readFileSync('server/src/inventory/inventory-usage.ts','utf8');
code=code.replace(/^export type InventoryAmountUnit = .*;\n/m,'')
  .replace(/export function /g,'function ')
  .replace(/value: unknown/g,'value')
  .replace(/\): InventoryAmountUnit \| null/g,')')
  .replace(/item: \{[\s\S]*?\}, quantity: number, enteredUnit: unknown\): number/g,
    'item, quantity, enteredUnit)');
const { canonicalInventoryUnit, stockQuantityForUnit } =
  new Function(code+';return {canonicalInventoryUnit,stockQuantityForUnit};')();

assert.equal(canonicalInventoryUnit('уп.'),'уп.');
assert.equal(canonicalInventoryUnit('пачка'),'уп.');
assert.equal(canonicalInventoryUnit('упаковка'),'уп.');
assert.equal(stockQuantityForUnit({unit:'шт.',packageQuantity:100},2,'уп.'),200);
assert.equal(stockQuantityForUnit({unit:'г',netPackageWeight:75},1,'уп.'),75);
assert.equal(stockQuantityForUnit({unit:'мл',packageQuantity:250},2,'уп.'),500);
assert.equal(stockQuantityForUnit({unit:'г',netPackageWeight:75},2,'шт.'),150);
assert.equal(stockQuantityForUnit({unit:'шт.',packageQuantity:100},3,'шт.'),3);
assert.throws(()=>stockQuantityForUnit({unit:'шт.',packageQuantity:null},1,'уп.'),/количество внутри упаковки/i);
assert.throws(()=>stockQuantityForUnit({unit:'шт.',packageQuantity:100},1.5,'уп.'),/целым/i);
assert.throws(()=>stockQuantityForUnit({unit:'г'},1,'мл'),/нельзя пересчитать/i);
assert.match(readFileSync('server/src/inventory/inventory.service.ts','utf8'),/\['шт\.', 'уп\.'\]\.includes\(requestedUnit\)/);
console.log('PASS: sale and consumption of whole packs, stock units and physical container counts');
