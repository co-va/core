import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
assert.match(source, /position: item.position/, 'Position must be returned in inventory snapshot');
const from = source.indexOf('  async moveItem(');
const to = source.indexOf('  private async findCatalogItem(', from);
assert.ok(from > 0 && to > from, 'Atomic item move must exist');
const method = source.slice(from, to)
  .replace('async moveItem(tenantId: string, itemId: string, body: unknown)', 'async function moveItem(tenantId, itemId, body)')
  .replaceAll('(tx: Tx)', '(tx)')
  .replaceAll('const rows: AnyRecord[]', 'const rows')
  .replaceAll('(row: AnyRecord)', '(row)');
const move = new Function('objectValue', 'BadRequestException', 'NotFoundException',
  method + ';return moveItem;')(value => value && typeof value === 'object' ? value : {}, Error, Error);
const all = Array.from({ length: 256 }, (_, i) => ({
  id: `id-${i}`, itemId: `item-${i}`,
  name: `Оттенок ${String(i + 1).padStart(3, '0')}`,
  manufacturer: i < 200 ? 'CHI' : 'Other', position: 0,
}));
let writes = 0;
const tx = {
  inventoryItem: {
    findFirst: async ({ where }) => all.find(row => row.itemId === where.itemId && !row.archivedAt) || null,
    findMany: async ({ where }) => all.filter(row => row.manufacturer === where.manufacturer).map(row => ({ ...row })),
    update: async ({ where, data }) => {
      const row = all.find(item => item.id === where.id);
      row.position = data.position;
      writes++;
    },
  },
};
let transactions = 0;
const context = {
  prisma: { $transaction: async (fn, options) => {
    assert.ok(options.timeout >= 20000, 'Batch reindex must have adequate transaction timeout');
    transactions++;
    return fn(tx);
  } },
  snapshot: async () => all.map(item => ({ ...item })),
};
await move.call(context, 'tenant', 'item-99', { position: 1 });
assert.equal(all.find(row => row.itemId === 'item-99').position, 1);
assert.equal(new Set(all.filter(row => row.manufacturer === 'CHI').map(row => row.position)).size, 200);
assert.equal(all.find(row => row.itemId === 'item-200').position, 0, 'Other manufacturer is unchanged');
assert.equal(transactions, 1);
assert.equal(writes, 200, 'One move reindexes the entire unnumbered manufacturer automatically');
await move.call(context, 'tenant', 'item-99', { position: 150 });
assert.equal(all.find(row => row.itemId === 'item-99').position, 150);
assert.equal(new Set(all.filter(row => row.manufacturer === 'CHI').map(row => row.position)).size, 200);
await assert.rejects(() => move.call(context, 'tenant', 'item-99', { position: 0 }), /положительным/);
console.log('PASS: 256 catalog items, automatic manufacturer numbering, atomic moves and validation');
