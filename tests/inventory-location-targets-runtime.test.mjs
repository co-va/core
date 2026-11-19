import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
require('../server/node_modules/reflect-metadata');
const { InventoryService } = require('../server/dist/inventory/inventory.service.js');

const prismaSchema = readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261118191500_inventory_location_targets/migration.sql', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts','utf8');
assert.match(prismaSchema, /model InventoryLocationTarget/);
assert.match(prismaSchema, /targetStockMode\s+String\s+@default\("overall"\)/);
assert.match(migration, /ALTER TABLE "InventoryItem" ADD COLUMN "targetStockMode"/);
assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE|DROP TABLE/i);
assert.match(controller, /@Put\('items\/:itemId\/targets'\)/);

const item = { id:'db-item', tenantId:'tenant-A', itemId:'item-A', targetStock: null,
  targetStockMode: 'overall', minStock:null, archivedAt:null };
const allocations = [];
const places = [
  { locationId:'work-1', tenantId:'tenant-A', archivedAt:null },
  { locationId:'work-2', tenantId:'tenant-A', archivedAt:null },
];
const db = {
  $queryRaw: async()=>[{id:item.id}],
  inventoryItem: {
    findFirst: async({where}) => where.tenantId===item.tenantId
      && where.itemId===item.itemId ? item : null,
    update: async({data}) => { Object.assign(item,data);return item; },
  },
  inventoryStorageLocation: {
    findMany: async({where})=> places.filter(place=>where.locationId.in.includes(place.locationId)),
  },
  inventoryLocationTarget: {
    deleteMany: async()=>{allocations.length=0;return {count:2};},
    createMany: async({data})=>{allocations.push(...data);return {count:data.length};},
    findMany: async()=>allocations,
  },
  $transaction: async(callback)=>callback(db),
};
const service = new InventoryService(db,{});
service.snapshot = async()=>({item,allocations:allocations.map(row=>({...row}))});

const run = (mode,targetStock,values) => service.updateStockTargets('tenant-A','item-A',{
  mode, targetStock, locations: values.map(([locationId,targetStock])=>({locationId,targetStock})),
});
await run('overall',20,[['work-1',3],['work-2',2]]);
assert.equal(item.targetStock,20,'Total remains 20 with optional allocation 3+2');
assert.equal(item.targetStockMode,'overall');
assert.equal(allocations.length,2);
await run('overall',13,[['work-1',10],['work-2',10]]);
assert.equal(item.targetStock,20,'A total of 13 must be raised to the allocated 20');
await run('locations',100,[['work-1',3],['work-2',2]]);
assert.equal(item.targetStock,5,'Per-location mode derives the total, ignoring stale global input');
assert.equal(item.targetStockMode,'locations');
await run('locations',null,[['work-1',''],['work-2',null]]);
assert.equal(item.targetStock,null,'No location targets are unknown, not an invented zero goal');
assert.equal(allocations.length,0);
await assert.rejects(()=>run('overall',10,[['work-1',11],['work-1',1]]),/Повторяющееся/);
await assert.rejects(()=>run('overall',10,[['someone-else',2]]),/не найдено/);
await assert.rejects(()=>run('overall',10,[['work-1',-1]]),/неотрицательн|Некорректн/);
await assert.rejects(()=>run('automatic',10,[]),/Выберите расчёт/);
assert.equal(item.targetStock,null,'Failed updates do not change stored total');
console.log('PASS: 20 vs 3+2, 13 vs 10+10, location-derived goals, safe isolation and no invented zeros');
