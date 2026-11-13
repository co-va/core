import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
assert.match(service, /position: item.position/, 'Snapshot exposes stored number');
assert.match(service, /items: orderedItems\.map/, 'Snapshot respects user sort order');
assert.match(service, /item\.position > 0/, 'Only positive numbers are considered assigned');
assert.match(service, /data\.position = source\.position/, 'Individual item update stores its number');
assert.match(service, /source\.position < 0/, 'Invalid negative numbers are rejected');
assert.doesNotMatch(service, /async moveItem\(/, 'Mass renumbering must not exist');
assert.doesNotMatch(controller, /@Post\('items\/:itemId\/move'\)/, 'No mass renumbering endpoint');

const start = service.indexOf("    const collator = new Intl.Collator('ru',");
const end = service.indexOf('\n\n    return {', start);
assert.ok(start > 0 && end > start, 'Snapshot sorting block exists');
const code = service.slice(start, end).replaceAll(': AnyRecord', '');
const sort = new Function('items', code + '\nreturn orderedItems;');
const items = Array.from({ length: 256 }, (_, i) => ({
  itemId: 'item-' + i, name: 'Оттенок ' + (i + 1),
  manufacturer: i < 200 ? 'CHI' : 'Other', position: 0,
}));
items[110].position = 30;
items[70].position = 2;
items[15].position = 8;
let sorted = sort(items);
const group = sorted.filter(row => row.manufacturer === 'CHI');
assert.deepEqual(group.slice(0, 3).map(row => row.itemId), ['item-70', 'item-15', 'item-110']);
assert.equal(group[3].position, 0, 'Unnumbered products remain unnumbered');
assert.equal(items.filter(row => row.position > 0).length, 3, 'Nothing is auto-numbered');
items[70].position = 0;
sorted = sort(items);
assert.equal(sorted.filter(row => row.manufacturer === 'CHI')[0].itemId, 'item-15',
  'Removing an assigned number returns item to the unnumbered group');
assert.equal(items.filter(row => row.position > 0).length, 2, 'Only chosen positions remain');

console.log('PASS: 256 products retain blank numbers, snapshot orders only explicit positions');
