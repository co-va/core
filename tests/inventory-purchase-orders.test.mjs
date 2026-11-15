import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Actual Core methods, adapted only to remove type annotations for a no-DB test.
const service = readFileSync('server/src/inventory/inventory.service.ts', 'utf8');
const finance = readFileSync('server/src/finance/finance.service.ts', 'utf8');
const controller = readFileSync('server/src/inventory/inventory.controller.ts', 'utf8');
const schema = readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261115202000_inventory_purchase_orders/migration.sql', 'utf8');
for (const route of [
  "@Post('orders')", "@Put('orders/:orderId')", "@Delete('orders/:orderId')",
  "@Post('orders/:orderId/pay')", "@Post('orders/:orderId/receive')",
]) assert.ok(controller.includes(route), `Missing purchase API: ${route}`);
assert.match(schema, /model InventoryPurchaseOrder \{/);
assert.match(schema, /model InventoryPurchaseOrderLine \{/);
assert.match(migration, /FOREIGN KEY \("purchaseOrderId"\)/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
assert.match(service, /createMovementInTx\(tx, tenantId/);
assert.match(service, /allowPurchaseOrderReceipt: true/);
assert.match(service, /!options\.allowPurchaseOrderReceipt/);
assert.match(finance, /source: \{ type: 'inventory-purchase-order', id: orderId \}/);
assert.match(finance, /systemKey: 'MATERIALS'/);
assert.match(finance, /'inventory-purchase-order'\) throw new BadRequestException/);

const start = service.indexOf('  private async preparePurchaseOrderLines(');
const end = service.indexOf('  private inventoryPosition(', start);
assert.ok(start > 0 && end > start);
const body = service.slice(start, end)
  .replace(/\bprivate async /g, 'async ')
  .replace(/: Tx\b|: string\b|: unknown\b|: AnyRecord\b/g, '')
  .replace(/\s+as Prisma\.TransactionClient\b|\s+as AnyRecord\[\]|\s+as AnyRecord\b/g, '');
const text = value => String(value ?? '').trim();
let sequence = 0;
const Purchase = new Function(
  'objectValue', 'text', 'optionalText', 'BadRequestException',
  'randomUUID', 'decimalNumber', 'supplierOfferUnitPrice',
  'return class TestedPurchaseOwner {' + body + '}',
)(
  value => value && typeof value === 'object' ? value : {},
  text, text, Error,
  () => 'order-' + (++sequence),
  value => Number(value) || 0,
  offer => offer.actualPrice / offer.unitsPerOffer,
);

const catalog = [
  { id: 'db-a', itemId: 'a', name: 'Color', manufacturer: 'CHI',
    unit: 'г', packageQuantity: 60, referencePrice: 500 },
  { id: 'db-b', itemId: 'b', name: 'Gloves', manufacturer: 'CHI',
    unit: 'шт.', packageQuantity: null, referencePrice: 100 },
  { id: 'db-c', itemId: 'c', name: 'Colour unknown tare', manufacturer: 'CHI',
    unit: 'г', packageQuantity: null, grossWeight: 80, tareWeight: null, referencePrice: 500 },
  { id: 'db-d', itemId: 'd', name: 'Colour unknown full weight', manufacturer: 'CHI',
    unit: 'г', packageQuantity: null, grossWeight: null, tareWeight: null, referencePrice: 500 },
  { id: 'db-e', itemId: 'e', name: 'Colour with measured tare', manufacturer: 'CHI',
    unit: 'г', packageQuantity: null, grossWeight: 80, tareWeight: 10, referencePrice: 500 },
];
const orders = [], receipts = [], expenses = [];
const tx = {
  inventoryItem: {
    findMany: async ({ where }) => catalog.filter(item => where.itemId.in.includes(item.itemId)),
  },
  inventorySupplierOffer: { findMany: async () => [] },
  inventoryPurchaseOrder: {
    create: async ({ data }) => {
      const row = { id: data.orderId, orderId: data.orderId, status: 'formed',
        supplier: data.supplier, note: data.note, financeOperationId: '', lines: data.lines.create };
      orders.push(row); return row;
    },
    updateMany: async ({ where, data }) => {
      const row = orders.find(order => order.orderId === where.orderId
        && order.status === where.status
        && (!where.financeOperationId || order.financeOperationId !== ''));
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
    findUnique: async ({ where }) => orders.find(order => order.orderId === where.tenantId_orderId.orderId) || null,
    update: async ({ where, data }) => {
      const order = orders.find(order => order.id === where.id);
      Object.assign(order, data);
      return order;
    },
  },
  inventoryPurchaseOrderLine: {
    deleteMany: async ({ where }) => {
      orders.find(order => order.id === where.purchaseOrderId).lines = [];
    },
    createMany: async ({ data }) => {
      orders.find(order => order.id === data[0].purchaseOrderId).lines = data;
    },
  },
  inventoryMovement: {
    findFirst: async ({ where }) => receipts.find(movement => movement.sourceId === where.sourceId) || null,
  },
};
const owner = new Purchase();
owner.prisma = {
  $transaction: async fn => fn(tx),
  inventoryPurchaseOrder: { deleteMany: async ({ where }) => {
    const index = orders.findIndex(order => order.orderId === where.orderId && order.status === where.status);
    if (index < 0) return { count: 0 };
    orders.splice(index, 1);
    return { count: 1 };
  } },
};
owner.finance = {
  recordInventoryPurchaseExpenseInTx: async (...args) => {
    expenses.push(args);
    return { id: 'finance-expense' };
  },
};
owner.createMovementInTx = async (db, tenantId, movement, options) => {
  receipts.push({ ...movement, options });
};
owner.snapshot = async () => ({ orders, receipts, expenses });

const created = await owner.createPurchaseOrder('tenant', {
  supplier: 'Seller', lines: [{ itemId: 'a', packages: 2 }, { itemId: 'b', packages: 3 }],
});
const orderId = created.orders[0].orderId;
assert.equal(orders.length, 1);
assert.equal(orders[0].lines[0].packageSize, 60);
const physicalOrder = await owner.createPurchaseOrder('tenant', {
  supplier: 'Seller', lines: [{itemId:'c',packages:2}],
});
const unknownMassOrder = await owner.createPurchaseOrder('tenant', {
  supplier: 'Seller', lines: [{itemId:'d',packages:2}],
});
const measuredTareOrder = await owner.createPurchaseOrder('tenant', {
  supplier: 'Seller', lines: [{itemId:'e',packages:2}],
});
assert.equal(physicalOrder.orders[1].lines[0].packages, 2);
assert.equal(physicalOrder.orders[1].lines[0].packageSize, 0,
  'Missing tare must not invent grams for either order or receipt');
await owner.updatePurchaseOrder('tenant', orderId, {
  supplier: 'Seller', lines: [{ itemId: 'a', packages: 3, packPrice: 550 }],
});
assert.equal(orders[0].lines[0].packages, 3);
await owner.payPurchaseOrder('tenant', orderId, { walletId: 'wallet', walletName: 'Cash' });
await owner.payPurchaseOrder('tenant', orderId, { walletId: 'wallet', walletName: 'Cash' });
assert.equal(expenses.length, 1);
assert.equal(orders[0].status, 'paid');
await owner.receivePurchaseOrder('tenant', orderId, { receivedAt: '2026-11-16T12:00:00Z' });
await owner.receivePurchaseOrder('tenant', orderId, { receivedAt: '2026-11-16T12:00:00Z' });
assert.equal(receipts.length, 1);
assert.equal(receipts[0].lines[0].quantity, 180);
assert.equal(receipts[0].lines[0].containerDelta, 3);
assert.equal(receipts[0].options.allowPurchaseOrderReceipt, true);
await owner.payPurchaseOrder('tenant', orders[1].orderId,
  {walletId:'wallet', walletName:'Cash'});
await owner.receivePurchaseOrder('tenant', orders[1].orderId,
  {receivedAt:'2026-11-16T12:00:00Z'});
assert.equal(receipts.length, 2, 'Receipt of physical tubes must succeed without known tare');
assert.equal(receipts[1].lines[0].containerDelta, 2);
assert.equal(receipts[1].lines[0].quantity, 160,
  'Unknown tare means gross grams count as product until measured');
assert.equal(receipts[1].lines[0].unitCost, 500 / 80,
  'Full gross grams are the temporary costing denominator');
await owner.receivePurchaseOrder('tenant', orders[1].orderId,
  {receivedAt:'2026-11-16T12:00:00Z'});
assert.equal(receipts.length, 2, 'Physical receipt remains idempotent');
await owner.payPurchaseOrder('tenant', unknownMassOrder.orders[2].orderId,
  {walletId:'wallet',walletName:'Cash'});
await owner.receivePurchaseOrder('tenant', unknownMassOrder.orders[2].orderId,
  {receivedAt:'2026-11-16T12:00:00Z'});
assert.equal(receipts[2].lines[0].containerDelta, 2);
assert.equal(receipts[2].lines[0].quantity, 0,
  'Unknown full weight must not invent grams, but can receive pieces');
assert.equal(receipts[2].lines[0].unitCost, null);
await owner.payPurchaseOrder('tenant', measuredTareOrder.orders[3].orderId,
  {walletId:'wallet',walletName:'Cash'});
await owner.receivePurchaseOrder('tenant', measuredTareOrder.orders[3].orderId,
  {receivedAt:'2026-11-16T12:00:00Z'});
assert.equal(receipts[3].lines[0].containerDelta, 2);
assert.equal(receipts[3].lines[0].quantity, 140,
  'Gross 80 minus measured tare 10 = 70 g per tube');
assert.equal(receipts[3].lines[0].unitCost, 500 / 70);
await assert.rejects(() => owner.updatePurchaseOrder('tenant', orderId, { lines: [{ itemId: 'a', packages: 4 }] }));
await assert.rejects(() => owner.deletePurchaseOrder('tenant', orderId));
await assert.rejects(() => owner.createPurchaseOrder('tenant', { lines: [{ itemId: 'a', packages: 1.5 }] }));

console.log('PASS: purchase orders persist, amounts in whole packs, Finance once, canonical receipt once');
