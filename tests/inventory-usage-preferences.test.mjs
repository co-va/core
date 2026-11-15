import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync('server/src/inventory/inventory-usage.ts', 'utf8')
  .replace(/^export type[^;]*;\s*/gm, '')
  .replace(/export function /g, 'function ')
  .replace(/: unknown/g, '').replace(/: number/g, '')
  .replace(/: InventoryAmountUnit \| null/g, '')
  .replace(/: \{[\s\S]*?\}, quantity/g, ', quantity')
  .replace(/: number \{/g, ' {');
assert.match(readFileSync('server/prisma/schema.prisma', 'utf8'), /consumeQuantity\s+Decimal\?/);
assert.match(readFileSync('server/src/inventory/inventory.service.ts', 'utf8'), /applyMovementQuantityUnits\(lines, items as AnyRecord\[\]\)/);
assert.match(readFileSync('server/src/inventory/inventory.service.ts', 'utf8'), /consumeUnit: item.consumeUnit/);
console.log('PASS: persisted inventory usage schema and canonical movement normalization');
