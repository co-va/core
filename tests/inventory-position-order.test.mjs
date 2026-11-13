import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');

assert.match(service, /position: item\.position/, 'API snapshot exposes the user-provided number');
assert.match(service, /items: orderedItems\.map/, 'Snapshot uses the shared position sorting');
assert.match(service, /data\.position = this\.inventoryPosition\(source\.position\)/,
  'Single product update stores the assigned number');
assert.match(service, /await this\.ensureInventoryPositionAvailable\(tx, tenantId, position\)/,
  'Creation validates uniqueness');
assert.match(service, /await this\.ensureInventoryPositionAvailable\(owner, tenantId, data\.position, current\.id\)/,
  'Updates validate uniqueness globally');
assert.match(service, /this\.prisma\.\$transaction\(async \(tx: Tx\) =>/,
  'Ordinary updates use transactions for number changes');
assert.match(service, /pg_advisory_xact_lock/, 'Cross-request serialization prevents concurrent duplicate assignment');
assert.doesNotMatch(service, /async moveItem\(/, 'No mass renumbering');
assert.doesNotMatch(controller, /@Post\('items\/:itemId\/move'\)/, 'No mass move endpoint');

const start = service.indexOf("    const collator = new Intl.Collator('ru',");
const end = service.indexOf('\n\n    return {', start);
assert.ok(start > 0 && end > start, 'Snapshot sorting block exists');
const sortCode = service.slice(start, end).replaceAll(': AnyRecord', '');
const sort = new Function('items', sortCode + '\nreturn orderedItems;');
const items = Array.from({ length: 256 }, (_, i) => ({
  id: `id-${i}`, itemId: `item-${i}`, name: `Оттенок ${i + 1}`,
  manufacturer: i < 200 ? 'CHI' : 'Wella', position: 0,
}));
items[201].position = 1;
items[15].position = 3;
items[110].position = 25;
let sorted = sort(items);
assert.deepEqual(sorted.slice(0, 3).map(item => item.itemId),
  ['item-201', 'item-15', 'item-110'],
  'Global numbering must override manufacturer grouping');
assert.equal(sorted[3].position, 0, 'Unnumbered materials follow assigned positions');
assert.equal(items.filter(item => item.position > 0).length, 3, 'No automatic numbering');
items[201].position = 0;
sorted = sort(items);
assert.equal(sorted[0].itemId, 'item-15', 'Cleared number returns to unnumbered positions');

const from = service.indexOf('  private inventoryPosition(');
const to = service.indexOf('  async createItem(', from);
assert.ok(from > 0 && to > from, 'Position-validation methods exist');
const methods = service.slice(from, to)
  .replace('private inventoryPosition(value: unknown): number', 'function inventoryPosition(value)')
  .replace(
    "private async ensureInventoryPositionAvailable(owner: Tx, tenantId: string, position: number, excludeId = '')",
    "async function ensureInventoryPositionAvailable(owner, tenantId, position, excludeId = '')"
  );
const handlers = new Function('BadRequestException',
  methods + '\nreturn { inventoryPosition, ensureInventoryPositionAvailable };')(Error);

assert.equal(handlers.inventoryPosition(null), 0);
assert.equal(handlers.inventoryPosition(undefined), 0);
assert.equal(handlers.inventoryPosition(0), 0);
assert.equal(handlers.inventoryPosition(7), 7, 'No leading zero padding');
assert.throws(() => handlers.inventoryPosition(-1), /целым/);
assert.throws(() => handlers.inventoryPosition(1.5), /целым/);
assert.throws(() => handlers.inventoryPosition(2147483648), /целым/);
assert.throws(() => handlers.inventoryPosition('7'), /целым/);

let locks = 0;
const db = {
  $queryRaw: async () => { locks++; return [{ locked: 1 }]; },
  inventoryItem: {
    findFirst: async ({ where }) => items.find(item =>
      item.position === where.position &&
      item.itemId !== 'archived' &&
      (!where.id?.not || item.id !== where.id.not)) || null,
  },
};
items[15].position = 7;
await assert.rejects(() => handlers.ensureInventoryPositionAvailable(db, 'tenant-1', 7),
  /№ 7 уже занят: CHI · Оттенок 16/);
await handlers.ensureInventoryPositionAvailable(db, 'tenant-1', 7, 'id-15');
assert.equal(locks, 2, 'Number validation is transaction-locked');
await handlers.ensureInventoryPositionAvailable(db, 'tenant-1', 0);
assert.equal(locks, 2, 'Unlimited blank numbers do not reserve a slot');
await handlers.ensureInventoryPositionAvailable(db, 'tenant-1', 9);
assert.equal(locks, 3, 'A unique number is accepted');

console.log('PASS: 256 goods; unique global numbers, empty allowed, cross-brand duplicates rejected');
