import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
assert.match(source, /items: orderedItems\.map/, 'Snapshot returns one shared position order');
assert.match(source, /position: item.position/, 'Manual numbers are included in inventory snapshot');
assert.match(source, /await this\.freeInventoryPosition\(owner, tenantId, manufacturer, nextPosition, current\.id,/,
  'Manual numbered insertion is automatic, not a duplicate error');
assert.match(source, /pg_advisory_xact_lock/, 'Both manual edits and drag reorder use a transaction lock');
assert.match(controller, /@Post\('items\/reorder'\)/, 'Single company reorder API is exposed');

const start = source.indexOf("    const collator = new Intl.Collator('ru',");
const end = source.indexOf('\n\n    return {', start);
assert.ok(start > 0 && end > start, 'Snapshot sort exists');
const sort = new Function('items',
  source.slice(start, end).replaceAll(': AnyRecord', '') + '\nreturn orderedItems;');
const all = Array.from({ length: 256 }, (_, index) => ({
  id: 'id-' + index, itemId: 'item-' + index,
  name: 'Оттенок ' + (index + 1),
  manufacturer: index < 200 ? 'CHI' : 'Wella', position: 0,
  balance: 110 + index,
}));
all[201].position = 1;
all[15].position = 3;
all[110].position = 25;
const sorted = sort(all);
assert.equal(sorted[0].manufacturer, 'CHI', 'Company grouping precedes manual numbers');
assert.equal(sorted[0].itemId, 'item-15');
assert.equal(sorted[1].itemId, 'item-110');
assert.equal(sorted.find(item => item.manufacturer === 'Wella').itemId, 'item-201');
assert.equal(all.filter(item => item.position > 0).length, 3, 'No numbering before explicit user action');

const rawHelpers = source.slice(source.indexOf('  private inventoryPosition('),
  source.indexOf('  // A drag only permutes explicit numbered slots', source.indexOf('  private inventoryPosition(')));
assert.ok(rawHelpers.startsWith('  private inventoryPosition('));
const helperFunctions = rawHelpers
  .replace('private inventoryPosition(value: unknown): number', 'function inventoryPosition(value)')
  .replace('private async lockInventoryOrder(tx: Tx, tenantId: string)', 'async function lockInventoryOrder(tx, tenantId)')
  .replace("private async freeInventoryPosition(tx: Tx, tenantId: string, manufacturer: string, position: number, excludeId = '', oldPosition = 0)",
    "async function freeInventoryPosition(tx, tenantId, manufacturer, position, excludeId = '', oldPosition = 0)")
  .replaceAll('const rows: AnyRecord[]', 'const rows')
  .replaceAll('const between: AnyRecord[]', 'const between');
const helpers = new Function('BadRequestException',
  helperFunctions + '\nreturn { inventoryPosition, lockInventoryOrder, freeInventoryPosition };')(Error);
assert.equal(helpers.inventoryPosition(0), 0, 'Blank number is represented as 0');
assert.equal(helpers.inventoryPosition(5), 5, 'No zero padding');
assert.throws(() => helpers.inventoryPosition(-1), /целым/);

const numbered = Array.from({length: 10}, (_,i) => ({
  id:'chi-' + i, manufacturer:'CHI', position:i+1,
}));
numbered.push({id:'wella-4',manufacturer:'Wella',position:4});
const mockDb = {
  $queryRaw: async () => [{locked:1}],
  inventoryItem: {
    findMany: async ({where}) => numbered.filter(item => item.manufacturer === where.manufacturer
      && item.position >= where.position.gte && item.id !== where.id?.not)
      .sort((a,b)=>a.position-b.position).map(item=>({...item})),
    update: async ({where,data}) => {
      const found = numbered.find(item=>item.id===where.id);
      assert.ok(found);
      assert.deepEqual(Object.keys(data), ['position'], 'Only positions change');
      found.position = data.position;
    },
  },
};
await helpers.freeInventoryPosition(mockDb,'tenant','CHI',4);
assert.deepEqual(numbered.filter(item=>item.manufacturer==='CHI').map(item=>item.position),
  [1,2,3,5,6,7,8,9,10,11], 'Inserting number 4 moves only CHI numbers 4–10');
assert.equal(numbered.find(item=>item.id==='wella-4').position,4,
  'The same number may exist in another company');
// Moving the item originally numbered 2 to number 4 compacts the vacated place.
const compact = Array.from({length:5},(_,i)=>({id:'g'+i,manufacturer:'CHI',position:i+1}));
const compactDb = {
  inventoryItem:{
    findMany:async({where})=>compact.filter(item =>
      (where.id?.not !== item.id) &&
      item.position > (where.position.gt ?? -1) &&
      item.position <= (where.position.lte ?? Infinity))
      .map(item=>({...item})),
    update:async({where,data})=>{compact.find(item=>item.id===where.id).position=data.position;}
  }
};
await helpers.freeInventoryPosition(compactDb,'tenant','CHI',4,'g1',2);
compact.find(item=>item.id==='g1').position=4;
assert.deepEqual(compact.map(item=>item.position),[1,4,2,3,5],
  'Moving number 2 to 4 shifts 3 and 4 down one slot');

const Prisma = {
  sql:(strings,...values)=>({ strings:Array.from(strings),values }),
  join:(values,separator)=>({joined:values,separator}),
};
const startReorder = source.indexOf('  async reorderItems(');
const endReorder = source.indexOf('  async createItem(', startReorder);
assert.ok(startReorder>0 && endReorder>startReorder);
const reorderFunction = source.slice(startReorder,endReorder)
  .replace('async reorderItems(tenantId: string, body: unknown)', 'async function reorderItems(tenantId, body)')
  .replaceAll('(tx: Tx)', '(tx)')
  .replaceAll('const items: AnyRecord[]', 'const items')
  .replaceAll('const changed: AnyRecord[]', 'const changed')
  .replaceAll('byId.get(id)!', 'byId.get(id)');
const reorder = new Function('objectValue','text','BadRequestException','Prisma',
  reorderFunction + '\nreturn reorderItems;')(
    value=>value && typeof value==='object' ? value : {},
    value=>String(value??'').trim(),Error,Prisma);

let writes = 0;
let rowsChanged = 0;
const tx = {
  inventoryItem: {
    findMany:async ({where}) => all.filter(item=>item.manufacturer===where.manufacturer)
      .map(({id,itemId,name,position})=>({id,itemId,name,position})),
  },
  $executeRaw:async (query)=>{
    writes++;
    const cases = query.values[0].joined;
    rowsChanged += cases.length;
    assert.equal(query.values[1], 'tenant');
    for(const row of cases){
      const [id,position] = row.values;
      const item=all.find(value=>value.id===id);
      item.position=position;
    }
  },
};
const context = {
  prisma:{$transaction:async(fn,options)=>{
    assert.ok(options.timeout>=20000);
    return fn(tx);
  }},
  lockInventoryOrder:async()=>{},
  snapshot:async()=>all,
};
const company = 'CHI';
const orderedBefore = sort(all).filter(item=>item.manufacturer===company).map(item=>item.itemId);
const first = orderedBefore[0], second = orderedBefore[1];
const reordered = [...orderedBefore];
[reordered[0],reordered[1]]=[reordered[1],reordered[0]];
const beforePositions = reordered.map(id=>all.find(item=>item.itemId===id).position);
await reorder.call(context,'tenant',{manufacturer:company,itemIds:reordered,previousPositions:beforePositions});
assert.equal(writes,1, 'One SQL write on drop');
assert.equal(rowsChanged,2, 'Only two swapped numbered rows changed, not all 200 goods');
assert.equal(all.filter(item=>item.manufacturer===company && item.position===0).length,198,
  'Unnumbered catalog remains unnumbered after drag');
assert.deepEqual(sort(all).filter(item=>item.manufacturer===company).map(item=>item.itemId),reordered,
  'Manual order after drag is persistent');
assert.equal(all.find(item=>item.itemId==='item-201').position,1,
  'Wella ordering remains unchanged');
assert.equal(all[30].balance,140,'Stock balances remain unchanged');
await assert.rejects(()=>reorder.call(context,'tenant',{
  manufacturer:company,itemIds:orderedBefore,
  previousPositions:orderedBefore.map(id=>id===first?3:id===second?25:0),
}),/Порядок изменён/,'Stale tab must not overwrite later changes');
assert.equal(writes,1,'Stale write rejected before SQL');

const unnumberedDrag = [...reordered];
[unnumberedDrag[3],unnumberedDrag[4]]=[unnumberedDrag[4],unnumberedDrag[3]];
await assert.rejects(()=>reorder.call(context,'tenant',{
  manufacturer:company,itemIds:unnumberedDrag,
  previousPositions:unnumberedDrag.map(id=>all.find(item=>item.itemId===id).position),
}),/Сначала назначьте номер/,'Unnumbered rows cannot be rearranged invisibly');
assert.equal(writes,1,'Unnumbered drag does not modify 200 products');
await assert.rejects(()=>reorder.call(context,'tenant',{
  manufacturer:company,itemIds:reordered.slice(1),
  previousPositions:reordered.slice(1).map(()=>0),
}),/Список материалов изменился/);

assert.match(source,/Обновите склад перед изменением номера/,
  'Legacy client without expected position is rejected');
assert.match(source,/Порядок изменился в другом окне/,
  'Stale single item number writes are rejected');
console.log('PASS: partial physical shelf numbering, stale-tab guard, no mass renumbering and isolation by manufacturer');
