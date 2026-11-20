import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const { InventoryService } = require('../dist/inventory/inventory.service.js');
const { InventoryCriteriaService } = require('../dist/inventory/inventory-criteria.service.js');

const prisma = new PrismaClient();
const tenantId = 'stock-rank-smoke-' + randomUUID();
const service = new InventoryService(prisma, null, new InventoryCriteriaService(prisma));
const item = async (manufacturer, id, position) => service.createItem(tenantId, {
  itemId: id, manufacturer, name: id, ...(position === undefined ? {} : {position}),
});
const rows = manufacturer => prisma.inventoryItem.findMany({
  where: {tenantId,manufacturer,archivedAt:null},
  select: {itemId:true,position:true},
  orderBy:[{position:'asc'},{itemId:'asc'}],
});
const assertRanks = async (manufacturer, expectedIds) => {
  const list = await rows(manufacturer);
  assert.deepEqual(list.map(row=>row.itemId),expectedIds,
    manufacturer + ': stable requested item order');
  assert.deepEqual(list.map(row=>row.position),expectedIds.map((_,i)=>i+1),
    manufacturer + ': no duplicate, missing or zero rank');
};
const oldPositions = async (manufacturer, itemIds) => {
  const current = await rows(manufacturer);
  const ranks = new Map(current.map(row=>[row.itemId,row.position]));
  return itemIds.map(id=>ranks.get(id));
};
try {
  await item('CHI','A');      // 1
  await item('CHI','B');      // 2
  await item('CHI','C');      // 3
  await item('CHI','D');      // 4
  await assertRanks('CHI',['A','B','C','D']);

  // Explicit insertion shifts positions 2,3,4 and never overwrites them.
  await item('CHI','E',2);
  await assertRanks('CHI',['A','E','B','C','D']);

  // Single-card move from #1 to #4 compacts the vacated slot.
  await service.updateItem(tenantId,'A',{position:4,expectedPosition:1});
  await assertRanks('CHI',['E','B','C','A','D']);

  // Clearing a number is a move to the end, not a stored empty number.
  await service.updateItem(tenantId,'B',{position:0,expectedPosition:2});
  await assertRanks('CHI',['E','C','A','D','B']);

  // Several selected items move to the tail atomically, preserving order.
  await service.clearItemPositions(tenantId,{items:[
    {itemId:'E',expectedPosition:1},{itemId:'A',expectedPosition:3},
  ]});
  await assertRanks('CHI',['C','D','B','E','A']);

  await item('Wella','W1');
  await item('Wella','W2');
  await assertRanks('Wella',['W1','W2']);

  // One mass request to Core swaps two manufacturers in one transaction.
  const plans=[
    {manufacturer:'CHI',itemIds:['B','D','C','E','A']},
    {manufacturer:'Wella',itemIds:['W2','W1']},
  ];
  const before=await Promise.all(plans.map(async plan=>({
    ...plan,previousPositions:await oldPositions(plan.manufacturer,plan.itemIds),
  })));
  await service.reorderItems(tenantId,{reorders:before});
  await assertRanks('CHI',['B','D','C','E','A']);
  await assertRanks('Wella',['W2','W1']);

  // A stale second manufacturer must reject the WHOLE request.
  const stale=[
    {manufacturer:'CHI',itemIds:['A','D','C','E','B'],
      previousPositions:await oldPositions('CHI',['A','D','C','E','B'])},
    {manufacturer:'Wella',itemIds:['W1','W2'],previousPositions:[99,1]},
  ];
  await assert.rejects(()=>service.reorderItems(tenantId,{reorders:stale}),
    /Порядок изменён/);
  await assertRanks('CHI',['B','D','C','E','A']);
  await assertRanks('Wella',['W2','W1']);

  // Archiving rank #2 must shift all following items in the same transaction.
  const archived=await service.archiveSelectedItems(tenantId,{itemIds:['D']});
  assert.deepEqual(archived.archivedItemIds,['D']);
  await assertRanks('CHI',['B','C','E','A']);
  await assertRanks('Wella',['W2','W1']);
  assert.deepEqual(archived.positions.map(row=>row.position),[1,2,3,4]);

  // The database itself rejects a new invalid active rank.
  await assert.rejects(()=>prisma.inventoryItem.update({
    where:{tenantId_itemId:{tenantId,itemId:'B'}},data:{position:0},
  }));
  await assertRanks('CHI',['B','C','E','A']);

  // With no holes left, repair must be an idempotent no-op.
  const healthy=await service.repairItemPositions(tenantId);
  assert.deepEqual(healthy.repairedManufacturers,[]);
  assert.deepEqual(healthy.positions,[]);
  console.log('PASS: PostgreSQL inventory ranks create/insert/move/clear/mass/archive/constraint');
} finally {
  // Isolated tenant: no global mutations, no persisted test items.
  await prisma.inventoryItem.deleteMany({where:{tenantId}});
  await prisma.inventoryClassificationGroup.deleteMany({where:{tenantId}});
  await prisma.inventoryCriteriaCatalog.deleteMany({where:{tenantId}});
  await prisma.$disconnect();
}
