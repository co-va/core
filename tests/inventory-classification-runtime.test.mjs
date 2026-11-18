import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../server/node_modules/reflect-metadata');
const { InventoryService } = require('../server/dist/inventory/inventory.service.js');

const schema = readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261118103000_inventory_classification_groups/migration.sql', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
const excel = readFileSync('server/src/inventory/inventory-excel-final.service.ts', 'utf8');
assert.match(schema, /model InventoryClassificationGroup/);
assert.match(schema, /classificationGroupId\s+String\?/);
assert.match(migration, /UPDATE "InventoryItem" SET "classificationGroupId"/);
assert.doesNotMatch(migration, /UPDATE "InventoryMovement"|DELETE FROM|DROP TABLE/i);
for (const route of ["@Get('classification-groups')", "@Post('classification-groups')",
  "@Put('classification-groups/:groupId')"]) assert.ok(controller.includes(route));
assert.match(excel, /groupColumns/);
assert.match(excel, /workbook\.addWorksheet\('Группы'\)/);

const records = [], assignments = [];
let count = 0;
const match = (obj, where = {}) => Object.entries(where).every(([key, expected]) => {
  const actual = obj[key];
  if (expected && typeof expected === 'object') {
    if ('equals' in expected) return String(actual).toLocaleLowerCase('ru-RU')
      === String(expected.equals).toLocaleLowerCase('ru-RU');
    if ('not' in expected) return actual !== expected.not;
  }
  return actual === expected;
});
const groups = {
  findMany: async ({ where } = {}) => records.filter(row => match(row, where)),
  findFirst: async ({ where } = {}) => records.find(row => match(row, where)) || null,
  create: async ({ data }) => {
    const row = { id: 'db-' + ++count, archivedAt: null, position: 0, ...data };
    records.push(row);
    return row;
  },
  update: async ({ where, data }) => {
    const row = records.find(item => item.id === where.id);
    assert.ok(row, 'Group exists');
    Object.assign(row, data);
    return row;
  },
};
const db = {
  inventoryClassificationGroup: groups,
  inventoryItem: { findFirst: async ({ where }) =>
    assignments.find(row => match(row, where)) || null },
  $queryRaw: async () => [{ locked: 1 }],
};
db.$transaction = async callback => callback(db);
const service = new InventoryService(db, {});

let parent = '';
for (let depth = 1; depth <= 7; depth++) {
  const list = await service.createClassificationGroup('tenant-A', {
    name: 'Level ' + depth, parentGroupId: parent,
  });
  assert.equal(list.length, depth);
  parent = list.find(group => group.name === 'Level ' + depth).groupId;
}
assert.equal((await service.groupPath(db, 'tenant-A', parent)).length, 7,
  'More than six named classification levels must be supported');
assert.equal((await service.resolveItemGroup(db, 'tenant-A', { classificationGroupId: parent })), parent);
await assert.rejects(() => service.resolveItemGroup(db, 'tenant-B',
  { classificationGroupId: parent }), /не найдена/,
  'Groups cannot be borrowed from another tenant');

await assert.rejects(() => service.createClassificationGroup('tenant-A',
  { name: 'level 7', parentGroupId: records[5].groupId }), /уже существует/,
  'Case-insensitive duplicate must be rejected');
await assert.rejects(() => service.updateClassificationGroup('tenant-A',
  records[0].groupId, { parentGroupId: parent }), /внутрь себя/,
  'Move into own descendant must be rejected');

const beforeMove = parent;
await service.updateClassificationGroup('tenant-A', beforeMove, { name: 'Renamed 7' });
assert.equal(records.at(-1).name, 'Renamed 7');
await assert.rejects(() => service.updateClassificationGroup('tenant-A',
  records[0].groupId, { archived: true }), /подгруппы/,
  'Nonempty parent cannot be deleted');
assignments.push({ tenantId: 'tenant-A', classificationGroupId: beforeMove });
await assert.rejects(() => service.updateClassificationGroup('tenant-A',
  beforeMove, { archived: true }), /содержит/,
  'Item membership prevents deleting its group');
assignments.length = 0;
await service.updateClassificationGroup('tenant-A', beforeMove, { archived: true });
assert.equal((await service.listClassificationGroups('tenant-A')).length, 6);
await service.createClassificationGroup('tenant-A',
  { name: 'Renamed 7', parentGroupId: records[5].groupId });
assert.equal((await service.listClassificationGroups('tenant-A')).length, 7,
  'Archived name can be restored without duplicating the group ID');
assert.equal(records.length, 7);

const legacy = await service.resolveItemGroup(db, 'tenant-B', {
  manufacturer: 'Alpha', category: 'Color', productType: 'Oxidants',
});
assert.equal((await service.groupPath(db, 'tenant-B', legacy)).length, 3,
  'Old fixed fields are imported into the same nested model');
const again = await service.resolveItemGroup(db, 'tenant-B', {
  manufacturer: 'Alpha', category: 'Color', productType: 'Oxidants',
});
assert.equal(legacy, again, 'Repeated item import reuses the group path');

console.log('PASS: nested Stock classifications 7 levels, tenant isolation, no duplicates, safe rename/archive, legacy migration');
