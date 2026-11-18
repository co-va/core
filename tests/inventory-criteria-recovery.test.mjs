import assert from 'node:assert/strict';
import { InventoryCriteriaRecoveryService } from '../server/dist/inventory/inventory-criteria-recovery.service.js';

const tenantId='tenant-recovery-test';
let items=[
  {tenantId,archivedAt:null,itemId:'1',sku:'CHI1050',manufacturer:'CHI',
    category:'48',productType:'Уход',name:'Кр-7C',balance:40,unit:'г',price:1000},
  {tenantId,archivedAt:null,itemId:'2',sku:'CHI1010',manufacturer:'CHI',
    category:'Уход',productType:'ГЕЛЬ',name:'Кр-11N',balance:55,unit:'г',price:1200},
  {tenantId,archivedAt:null,itemId:'3',sku:'CHI5208',manufacturer:'CHI',
    category:'Стайлинг',productType:'STYLING',name:'Style',balance:7,unit:'шт.',price:800},
  {tenantId,archivedAt:null,itemId:'4',sku:'CHI100',manufacturer:'CHI',
    category:'Краситель',productType:'КРЕМ',name:'Duplicate',balance:3},
  {tenantId,archivedAt:null,itemId:'5',sku:'CHI100',manufacturer:'CHI',
    category:'Уход',productType:'КРЕМ',name:'Duplicate 2',balance:4},
  {tenantId:'other-tenant',archivedAt:null,itemId:'6',sku:'CHI1050',manufacturer:'CHI',
    category:'Уход',productType:'КРЕМ',name:'Other user',balance:250},
];
const initial=structuredClone(items);
const matches=(item,where)=>Object.entries(where).every(([k,v])=>{
  if(k==='itemId'&&v&&typeof v==='object')return v.in.includes(item.itemId);
  return item[k]===v;
});
const prisma={
  inventoryItem:{findMany:async({where,select})=>items.filter(x=>matches(x,where))
    .map(x=>Object.fromEntries(Object.keys(select).map(k=>[k,x[k]])))},
  $transaction:async work=>{
    const before=structuredClone(items);
    const tx={
      $queryRawUnsafe:async()=>[{locked:1}],
      inventoryItem:{
        findMany:async({where,select})=>items.filter(x=>matches(x,where))
          .map(x=>Object.fromEntries(Object.keys(select).map(k=>[k,x[k]]))),
        updateMany:async({where,data})=>{
          let count=0;
          for(const item of items) if(matches(item,where)){Object.assign(item,data);count++;}
          return {count};
        },
      },
    };
    try{return await work(tx);}
    catch(e){items=before;throw e;}
  },
};
const service=new InventoryCriteriaRecoveryService(prisma);
const source=[
  {sku:'CHI1050',manufacturer:'CHI',category:'Краситель',productType:'КРЕМ'},
  {sku:'CHI1010',manufacturer:'CHI',category:'Краситель',productType:'КРЕМ'},
  {sku:'CHI5208',manufacturer:'CHI',category:'Стайлинг',productType:'STYLING'},
  {sku:'CHI100',manufacturer:'CHI',category:'Краситель',productType:'КРЕМ'},
  {sku:'MISSING',manufacturer:'CHI',category:'Уход',productType:'Маска'},
];
const preview=await service.preview(tenantId,{rows:source});
assert.equal(preview.sourceCount,5);
assert.equal(preview.changes.length,2);
assert.equal(preview.unchangedCount,1);
assert.deepEqual(preview.notFound,['MISSING']);
assert.deepEqual(preview.ambiguous,['CHI100']);
assert.equal(preview.stockCount,5);
assert.deepEqual(items,initial,'Read-only preview must not write to InventoryItem');

await assert.rejects(service.preview(tenantId,{rows:[source[0],source[0]]}),/повторяется артикул/i);
await assert.rejects(service.apply(tenantId,{changes:[{...preview.changes[0],beforeCategory:'wrong'}]}),/изменился/i);
assert.deepEqual(items,initial,'Stale edit must not partially change stock');

const restored=await service.apply(tenantId,{changes:preview.changes});
assert.equal(restored.updatedCount,2);
assert.deepEqual(items.slice(0,3).map(x=>[x.category,x.productType]),[
  ['Краситель','КРЕМ'],['Краситель','КРЕМ'],['Стайлинг','STYLING']]);
assert.deepEqual(items.map(x=>x.balance),initial.map(x=>x.balance));
assert.deepEqual(items.map(x=>x.price),initial.map(x=>x.price));
assert.equal(items[5].category,'Уход','Other tenant is not modified');
await assert.rejects(service.apply(tenantId,{changes:preview.changes}),/изменился/i);

console.log('PASS: classification preview, partial source, SKU duplicates, stale guard, atomic restore and unchanged stock');
