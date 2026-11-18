import assert from 'node:assert/strict';
import { InventoryCriteriaService } from '../server/dist/inventory/inventory-criteria.service.js';

const tenantId='criterion-test-tenant';
let saved=null;
const items=[
  {tenantId,itemId:'paint-1',name:'Paint 01',manufacturer:'CHI',
    category:'Краситель',productType:'Крем',balance:4,criteriaValues:null,archivedAt:null},
  {tenantId,itemId:'paint-2',name:'Paint 02',manufacturer:'CHI',
    category:'Краситель',productType:'Гель',balance:9,criteriaValues:null,archivedAt:null},
  {tenantId,itemId:'mask-1',name:'Mask 01',manufacturer:'SEKTA',
    category:'Уход',productType:'Крем',balance:6,criteriaValues:null,archivedAt:null},
];
const original=structuredClone(items);
const tx={
  $queryRawUnsafe:async()=>[{locked:1}],
  inventoryCriteriaCatalog:{
    findUnique:async()=>saved?{data:structuredClone(saved)}:null,
    upsert:async({create,update})=>{
      saved=structuredClone(saved?update.data:create.data);
      return {tenantId,data:structuredClone(saved)};
    },
    update:async({data})=>{
      saved=structuredClone(data.data);
      return {tenantId,data:structuredClone(saved)};
    },
  },
  inventoryItem:{
    findMany:async({where,select})=>items
      .filter(item=>item.tenantId===where.tenantId && item.archivedAt==null)
      .map(item=>Object.fromEntries(Object.keys(select).map(key=>[key,item[key]]))),
    updateMany:async({where,data})=>{
      let count=0;
      for(const item of items) {
        if(item.tenantId!==where.tenantId||item.archivedAt!=null)continue;
        if(Object.keys(where).some(key=>key!=='tenantId'&&key!=='archivedAt'&&item[key]!==where[key]))
          continue;
        Object.assign(item,data);count++;
      }
      return {count};
    },
  },
};
const criteria=new InventoryCriteriaService({$transaction:async work=>work(tx)});
const initial=await criteria.list(tenantId);
assert.deepEqual(initial.map(group=>group.name),['Производитель','Категория','Тип']);
assert.deepEqual(initial[0].values.map(v=>v.name),['CHI','SEKTA']);
assert.deepEqual(initial[1].values.map(v=>v.name),['Краситель','Уход']);
assert.deepEqual(initial[2].values.map(v=>v.name),['Гель','Крем']);
assert.deepEqual(items,original,'Initial catalog must not rewrite existing inventory');

const extra=await criteria.create(tenantId,{name:'Серия'});
const series=extra.find(group=>group.name==='Серия');
assert.ok(series.id);
let next=await criteria.createValue(tenantId,series.id,{name:'Ionic'});
const ionic=next.find(group=>group.id===series.id).values[0];
assert.ok(ionic.id);
const map=await criteria.validateSelections(tx,tenantId,{[series.id]:ionic.id});
assert.equal(map[series.id],ionic.id);
const preserved=await criteria.validateSelections(tx,tenantId,{[series.id]:''},{[series.id]:ionic.id,archived:'previous'});
assert.equal(preserved[series.id],undefined);
assert.equal(preserved.archived,'previous');

next=await criteria.update(tenantId,'manufacturer',{name:'Бренд'});
assert.equal(next[0].name,'Бренд');
assert.deepEqual(items,original,'Group display-name edit must not rewrite legacy values');

const paint=next.find(group=>group.id==='category').values.find(v=>v.name==='Краситель');
await criteria.updateValue(tenantId,'category',paint.id,{name:'Окрашивание'});
assert.deepEqual(items.map(item=>item.category),['Окрашивание','Окрашивание','Уход']);
assert.deepEqual(items.map(item=>item.balance),[4,9,6]);
await assert.rejects(
  criteria.updateValue(tenantId,'category',paint.id,{archived:true}),
  /используется в товарах/,
);
const manufacturer=next.find(group=>group.id==='manufacturer');
const reversed=manufacturer.values.map(v=>v.id).reverse();
next=await criteria.reorderValues(tenantId,'manufacturer',{valueIds:reversed});
assert.deepEqual(next.find(group=>group.id==='manufacturer').values.map(v=>v.id),reversed);

await criteria.update(tenantId,'manufacturer',{archived:true});
assert.equal((await criteria.list(tenantId)).some(g=>g.id==='manufacturer'),false);
await criteria.update(tenantId,'category',{archived:true});
await criteria.update(tenantId,'productType',{archived:true});
await criteria.update(tenantId,series.id,{archived:true});
assert.deepEqual(await criteria.list(tenantId),[],
  'Archived built-in criteria must not reappear as default groups');
assert.deepEqual(items.map(item=>item.manufacturer),original.map(item=>item.manufacturer));
console.log('PASS: existing manufacturer/category/type lists, group/values CRUD, rename, order, archive, and preserved stock');
