import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
assert.match(source, /items: orderedItems\.map/, 'Snapshot returns one shared position order');
assert.match(source, /position: item.position/, 'Manual numbers are included in inventory snapshot');
assert.match(source, /await this\.freeInventoryPosition\(owner, tenantId, manufacturer, nextPosition,\s*current\.id,/,
  'Manual numbered insertion is automatic, not a duplicate error');
assert.match(source, /pg_advisory_xact_lock/, 'Both manual edits and drag reorder use a transaction lock');
assert.match(source, /const existing = await this\.compactInventoryPositions\(tx, tenantId, manufacturer\)/,
  'Creation first repairs older numbering gaps in its manufacturer');
assert.match(source, /position: assignedPosition/,
  'Every newly created product persists a positive assigned rank');
assert.match(source, /const nextPosition = requested > 0[\s\S]*?: existing\.length \+ \(changedManufacturer \? 1 : 0\)/,
  'Empty position on edit is resolved to the end of its manufacturer');

assert.match(controller, /@Post\('items\/reorder'\)/, 'Single company reorder API is exposed');

const start = source.indexOf("    const collator = new Intl.Collator('ru',");
const end = source.indexOf('    const targetsByItem =', start);
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
assert.equal(all.filter(item => item.position > 0).length, 3, 'Legacy fixture includes previously unnumbered items');

const rawHelpers = source.slice(source.indexOf('  private inventoryPosition('),
  source.indexOf('  // Every active item has a positive', source.indexOf('  private inventoryPosition(')));
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
assert.equal(helpers.inventoryPosition(0), 0, 'Zero is a request to move to the end, never a stored position');
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
assert.equal(rowsChanged,200, 'Legacy unnumbered items receive sequential ranks in the same transaction');
assert.deepEqual(sort(all).filter(item=>item.manufacturer===company).map(item=>item.position),
  Array.from({length:200},(_,i)=>i+1),
  'All 200 products receive a continuous nonzero rank after reorder');
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

const nextOrder = [...reordered];
[nextOrder[3],nextOrder[4]]=[nextOrder[4],nextOrder[3]];
await reorder.call(context,'tenant',{
  manufacturer:company,itemIds:nextOrder,
  previousPositions:nextOrder.map(id=>all.find(item=>item.itemId===id).position),
});
assert.equal(writes,2,'Existing numbered rows can be swapped in one additional SQL write');
await assert.rejects(()=>reorder.call(context,'tenant',{
  manufacturer:company,itemIds:reordered.slice(1),
  previousPositions:reordered.slice(1).map(()=>0),
}),/Список материалов изменился/);

assert.match(source,/Обновите склад перед изменением номера/,
  'Legacy client without expected position is rejected');
assert.match(source,/Порядок изменился в другом окне/,
  'Stale single item number writes are rejected');
// Clearing a number moves the selected item to the end, with positive
// contiguous ranks for every product including older legacy blanks.
assert.match(controller, /@Post\('items\/positions\/clear'\)/,
  'Atomic clear-and-renumber endpoint must exist');
assert.match(source, /await this\.compactInventoryPositions\(owner, tenantId,/,
  'Single-item number clearing must use the same algorithm');

const compactStart = source.indexOf('  private async compactInventoryPositions(');
const compactEnd = source.indexOf('  // A reorder is an atomic permutation', compactStart);
assert.ok(compactStart > 0 && compactEnd > compactStart, 'Canonical position compactor exists');
const compactSource = source.slice(compactStart, compactEnd)
  .replace(/private async compactInventoryPositions\(tx: Tx, tenantId: string, manufacturer: string,\s*clearItemIds: Set<string> = new Set\(\)\): Promise<\{ itemId: string; position: number \}\[]>/,
    'async compactInventoryPositions(tx, tenantId, manufacturer, clearItemIds = new Set())')
  .replace('async clearItemPositions(tenantId: string, body: unknown)', 'async clearItemPositions(tenantId, body)')
  .replaceAll('const rows: AnyRecord[]', 'const rows')
  .replaceAll('(item: AnyRecord)', '(item)')
  .replaceAll('const targets: AnyRecord[]', 'const targets')
  .replace('const positions: { itemId: string; position: number }[] = [];', 'const positions = [];')
  .replace('raw.map((entry: unknown) =>', 'raw.map(entry =>')
  .replaceAll('async (tx: Tx) =>', 'async tx =>');
const PositionEngine = new Function('Prisma', 'objectValue', 'text', 'BadRequestException',
  'return class PositionEngine { constructor(prisma) { this.prisma = prisma; } ' +
  'async lockInventoryOrder(tx, tenantId) { tx.lockCount++; }' +
  compactSource + '}')(Prisma,
  value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
  value => String(value ?? '').trim(), Error);

const examples = [1, 2, 3, 10, 11, 12, 15, 16, 20, 21].map((position, index) => ({
  id: 'db-' + index, tenantId: 'tenant', itemId: 'i-' + index,
  manufacturer: 'CHI', archivedAt: null, name: 'Product ' + index,
  position, balance: 10 + index,
}));
examples.push({ id: 'wella-1', tenantId: 'tenant', itemId: 'wella',
  manufacturer: 'Wella', archivedAt: null, name: 'Wella', position: 23, balance: 99 });
let massWrites = 0;
const positionTx = {
  lockCount: 0,
  inventoryItem: {
    findMany: async ({ where, select, orderBy }) => examples.filter(item =>
      item.tenantId === where.tenantId && item.archivedAt === null
      && (!('manufacturer' in where) || item.manufacturer === where.manufacturer)
      && (!where.itemId || where.itemId.in.includes(item.itemId)))
      .sort((left, right) => orderBy?.[0]?.position === 'asc' ? left.position - right.position : 0)
      .map(item => Object.fromEntries(Object.keys(select).map(key => [key, item[key]]))),
  },
  $executeRaw: async query => {
    massWrites++;
    for (const expr of query.values[0].joined) {
      const [id, position] = expr.values;
      examples.find(item => item.id === id).position = position;
    }
    return query.values[0].joined.length;
  },
};
const engine = new PositionEngine({ $transaction: async (callback, options) => {
  assert.ok(options.timeout >= 60000);
  return callback(positionTx);
}});
const cleared = await engine.clearItemPositions('tenant', { items: [
  { itemId: 'i-4', expectedPosition: 11 },
  { itemId: 'i-5', expectedPosition: 12 },
] });
assert.deepEqual(examples.slice(0, 10).map(item => item.position),
  [1, 2, 3, 4, 9, 10, 5, 6, 7, 8],
  'Cleared oxides move to the end (9, 10); all CHI ranks stay positive and sequential');
assert.equal(examples[10].position, 23, 'Other manufacturers are untouched');
assert.ok(examples.every((item, index) => item.balance === (index === 10 ? 99 : 10 + index)),
  'No stock balances or item details are changed');
assert.equal(massWrites, 1, 'Entire manufacturer is renumbered in one SQL statement');
assert.equal(positionTx.lockCount, 1, 'One transaction lock guards the entire clear');
assert.equal(cleared.clearedItemIds.length, 2);
assert.equal(cleared.positions.length, 10, 'Core confirms all affected numbers');

await assert.rejects(() => engine.clearItemPositions('tenant', { items: [
  { itemId: 'i-2', expectedPosition: 10 },
] }), /Порядок изменился/, 'Old browser tabs must not overwrite fresh order');
assert.equal(massWrites, 1, 'A stale request never mutates the database');

assert.match(controller, /@Post\('items\/positions\/repair'\)/,
  'Historical numbering repair is an explicit authenticated operation');
const repairStart = source.indexOf('  async repairItemPositions(');
const repairEnd = source.lastIndexOf('\n}');
assert.ok(repairStart > 0 && repairEnd > repairStart, 'Canonical rank repair exists');
const repairSource = source.slice(repairStart,repairEnd)
  .replace('async repairItemPositions(tenantId: string)', 'async repairItemPositions(tenantId)')
  .replace('const changedManufacturers: string[] = [];', 'const changedManufacturers = [];')
  .replace('const positions: { itemId: string; position: number }[] = [];','const positions = [];')
  .replaceAll('async (tx: Tx) =>', 'async tx =>')
  .replace('const rows: AnyRecord[]', 'const rows')
  .replace('new Map<string, number[]>()','new Map()')
  .replaceAll('groups.get(manufacturer)!','groups.get(manufacturer)');
const RepairEngine = new Function('PositionEngine',
  'return class RepairEngine extends PositionEngine { ' + repairSource + '}')(PositionEngine);
const repairEngine = new RepairEngine(engine.prisma);
// The oxides' missing numbers are restored atomically with their original
// relative order, without changing Wella or stock balances.
examples[4].position = 0;
examples[5].position = 0;
examples[10].position = 1; // Healthy Wella ordering must remain unchanged.
const repaired = await repairEngine.repairItemPositions('tenant');
assert.deepEqual(repaired.repairedManufacturers,['CHI']);
assert.equal(repaired.positions.length,10);
assert.deepEqual(examples.slice(0,10).map(item=>item.position).sort((a,b)=>a-b),
  [1,2,3,4,5,6,7,8,9,10],'Every legacy zero becomes a positive consecutive rank');
assert.equal(examples[10].position,1,'Healthy unrelated manufacturer is not rewritten');
assert.ok(examples.every((item,index)=>item.balance===(index===10?99:10+index)),
  'Position repair never changes stock quantities');
const repairWrites=massWrites;
const unchanged=await repairEngine.repairItemPositions('tenant');
assert.equal(unchanged.positions.length,0,'Healthy numbering is a no-op');
assert.equal(massWrites,repairWrites,'No unnecessary SQL rewrite after repair');

console.log('PASS: inventory order/reorder, automatic numbering and move-to-end clearing');

