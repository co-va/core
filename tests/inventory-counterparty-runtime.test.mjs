import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../server/node_modules/reflect-metadata');
const ExcelJS = require('../server/node_modules/exceljs');
const PDFDocument = require('../server/node_modules/pdfkit');
const { InventoryCounterpartyService } = require('../server/dist/inventory/inventory-counterparty.service.js');

let counter = 0;
const company = { id: 'company', tenantId: 'tenant', name: 'Supply Store', kind: 'SUPPLIER' };
const stock = { id: 'stock-db-1', itemId: 'stock-1', tenantId: 'tenant', name: 'Working Dye',
  sku: '001', barcode: '', unit: 'г', packageQuantity: 70 };
const lists = [], rows = [], offers = [];
const savedHistory = [{ id: 'historical-movement', price: 150 }];
const latest = () => lists.at(-1);
const priceListRepository = {
  findFirst: async ({ where } = {}) => {
    if (where?.sha256) return lists.find(row => row.sha256 === where.sha256 && row.counterpartyId === where.counterpartyId) || null;
    if (where?.parserStatus) return lists.filter(row => row.parserStatus === where.parserStatus).at(-1) || null;
    return latest() || null;
  },
  create: async ({ data }) => {
    const value = { id: 'list-' + ++counter, ...data };
    lists.push(value);
    return value;
  },
};
const matchingCatalogRows = (where = {}) => rows.filter(row =>
  (!where.priceListId || row.priceListId === where.priceListId)
  && (!where.supplierSku?.in || where.supplierSku.in.includes(row.supplierSku))
  && (!where.id?.in || where.id.in.includes(row.id))
  && (where.excludedAt === null ? !row.excludedAt
    : where.excludedAt?.not === null ? Boolean(row.excludedAt) : true));
const db = {
  inventoryCounterparty: { findFirst: async ({ where }) =>
    where.tenantId === 'tenant' && where.id === company.id ? company : null },
  inventoryItem: {
    findFirst: async () => stock,
    findMany: async () => [stock],
  },
  inventoryCounterpartyPriceList: priceListRepository,
  inventoryCounterpartyCatalogItem: {
    findFirst: async ({ where }) => rows.find(row => row.id === where.id) || null,
    findMany: async ({ where }) => matchingCatalogRows(where),
    count: async ({ where }) => matchingCatalogRows(where).length,
  },
  inventorySupplierOffer: {
    findMany: async () => offers.filter(offer => offer.isActive !== false),
    findFirst: async ({ where }) => offers.find(offer =>
      offer.counterpartyId === where.counterpartyId
      && (!where.inventoryItemId || offer.inventoryItemId === where.inventoryItemId)
      && (!where.catalogItemId || offer.catalogItemId === where.catalogItemId)
      && (!where.supplierSku || offer.supplierSku === where.supplierSku)
      && offer.isActive !== false) || null,
    create: async ({ data }) => { offers.push({ id: 'offer-' + ++counter, isActive: true, ...data }); },
  },
  $transaction: async callback => callback({
    $queryRaw: async () => [{ locked: 1 }],
    inventoryCounterpartyPriceList: priceListRepository,
    inventoryItem: { findFirst: async ({ where }) => where.itemId === stock.itemId ? stock : null },
    inventoryCounterpartyCatalogItem: {
      findFirst: async ({ where }) => matchingCatalogRows(where).find(row => row.id === where.id) || null,
      createMany: async ({ data }) => { rows.push(...data.map(row => ({ id: 'row-' + ++counter, ...row }))); },
      findMany: async ({ where }) => matchingCatalogRows(where),
      count: async ({ where }) => matchingCatalogRows(where).length,
      updateMany: async ({ where, data }) => {
        const found = matchingCatalogRows(where);
        found.forEach(row => Object.assign(row, data));
        return { count: found.length };
      },
    },
    inventorySupplierOffer: {
      findFirst: async ({ where }) => db.inventorySupplierOffer.findFirst({ where }),
      create: async ({ data }) => db.inventorySupplierOffer.create({ data }),
      findMany: async ({ where }) => offers.filter(offer => offer.counterpartyId === where.counterpartyId
        && offer.isActive !== false && offer.catalogItemId && where.supplierSku.in.includes(offer.supplierSku)),
      update: async ({ where, data }) => Object.assign(offers.find(offer => offer.id === where.id), data),
    },
  }),
};
const service = new InventoryCounterpartyService(db, { resolveCapability: async () => ({ enabled: true }) });
const excelFile = async price => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Supplier');
  sheet.addRow(['Артикул', 'Наименование', 'Производитель', 'Цена', 'Единица', 'В упаковке']);
  sheet.addRow(['001', 'Dye 7.1', 'Dye Co', price, 'шт.', 1]);
  sheet.addRow(['002', 'Dye 7.2', 'Dye Co', price + 20, 'шт.', 1]);
  const buf = Buffer.from(await workbook.xlsx.writeBuffer());
  return { originalname: 'supply.xlsx', buffer: buf, size: buf.length };
};

// Matches the supplier's multi-sheet order form without storing its proprietary file in the repository.
const faroukFixture = new ExcelJS.Workbook();
const farouk = faroukFixture.addWorksheet('Farouk');
farouk.addRow(['', '', '', '', 'Минимальная сумма заказа - 20 000 руб.']);
farouk.addRow([]);
farouk.addRow(['Есть/нет на складе ', 'Штрих код', 'Артикул', 'Номенклатура', '', 'Кол-во штук ', 'FAROUK БЦО (вкл НДС)', 'FAROUK РРЦ (вкл НДС)']);
farouk.addRow(['', '', 'CHI', '01. COLOR GENERATOR']);
farouk.addRow(['да', '633911000111', 'CHI01', 'Оксид CHI 10 Vol', 'Новинка', '', 960, 'Не для продажи']);
farouk.addRow(['нет', '633911000222', 'CHI02', 'Оксид CHI 20 Vol', '', '', 1890, 3200]);
const helper = faroukFixture.addWorksheet('Лист5');
helper.addRow(['Артикул','Номенклатура']);
helper.addRow(['CHI01','Оксид CHI 10 Vol']);
const faroukData = Buffer.from(await faroukFixture.xlsx.writeBuffer());
const faroukPreview = await service.preview('tenant', company.id,
  { originalname: 'supplier-form.xlsx', buffer: faroukData, size: faroukData.length });
assert.equal(faroukPreview.status, 'READY', JSON.stringify(faroukPreview.errors));
assert.equal(faroukPreview.count, 2, 'Brand headings and lookup sheets are not inventory products');
assert.equal(faroukPreview.sample[0].supplierAvailable, true);
assert.equal(faroukPreview.sample[1].supplierAvailable, false);
assert.equal(faroukPreview.sample[0].listPrice, 960, 'BCO is the supplier base price');
assert.equal(faroukPreview.sample[0].retailPrice, null, 'Not for sale is not a numeric price or column');
assert.equal(faroukPreview.sample[1].retailPrice, 3200, 'RRP remains separate');
assert.equal(faroukPreview.sample[0].supplierNote, 'Новинка');
assert.equal(faroukPreview.sample[0].brand, 'CHI');
assert.equal(faroukPreview.sample[0].category, '01. COLOR GENERATOR');
assert.equal(faroukPreview.sample[0].actualPrice, null, 'Never invent a personal discount');

const file = await excelFile(320);
const preview = await service.preview('tenant', company.id, file);
assert.equal(preview.status, 'READY');
assert.equal(preview.count, 2);
assert.equal(preview.sample[0].supplierSku, '001');
assert.equal(preview.sample[0].listPrice, 320);
const first = await service.import('tenant', company.id, file);
assert.equal(first.revision, 1);
assert.equal(first.count, 2);
assert.equal(lists[0].sourceFile.length, file.buffer.length);
assert.equal(rows.length, 2);
assert.equal(rows[0].name, 'Dye 7.1');
assert.equal(offers.length, 0, 'Uploading a price list must not create working stock offers');
const duplicate = await service.import('tenant', company.id, file);
assert.equal(duplicate.duplicate, true);
assert.equal(lists.length, 1);

const hiddenRow = rows[1];
assert.deepEqual((await service.linkStatuses('tenant', company.id)).statuses
  .find(result => result.catalogItemId === rows[0].id),
  { catalogItemId: rows[0].id, status: 'matched', itemId: stock.itemId },
  'Unique matching manufacturer SKU suggests existing stock but does not link');
await service.setExcluded('tenant', company.id, { rowIds: [hiddenRow.id], excluded: true });
assert.ok(hiddenRow.excludedAt instanceof Date);
assert.equal((await service.catalog('tenant', company.id)).count, 1, 'Excluded row is hidden, not erased');
assert.equal((await service.catalog('tenant', company.id, '', 0, true)).count, 1, 'Excluded row is recoverable');
await assert.rejects(() => service.setExcluded('tenant', company.id, {
  rowIds: ['not-in-current-catalog'], excluded: true,
}), /устарел/);
await assert.rejects(() => service.link('tenant', company.id, rows[0].id, stock.itemId),
  /Единицы поставщика и склада различаются/,
  'Mismatched units cannot be silently interpreted as the stock card pack');
const offer = await service.link('tenant', company.id, rows[0].id, stock.itemId, 70);
assert.equal(offer.itemId, stock.itemId);
assert.equal(offers.length, 1);
assert.equal(offers[0].unitsPerOffer, 70, 'Explicitly confirmed offer quantity is preserved');
assert.equal((await service.linkStatuses('tenant', company.id)).statuses
  .find(result => result.catalogItemId === rows[0].id)?.status, 'linked',
  'Only a saved supplier offer produces a confirmed green link');
await service.link('tenant', company.id, rows[0].id, stock.itemId, 70);
assert.equal(offers.length, 1, 'Repeated binding to same card is idempotent');
await assert.rejects(() => service.link('tenant', company.id, rows[1].id, stock.itemId, 70),
  /не найдена/, 'Excluded supplier entries cannot be linked');
assert.equal(savedHistory[0].price, 150);
// The price on a real invoice and the personal discount are entered separately.
offers[0].actualPrice = 278;
offers[0].discountPercent = 7;
const second = await service.import('tenant', company.id, await excelFile(390));
assert.equal(second.revision, 2);
assert.equal(lists.length, 2);
assert.equal((await service.catalog('tenant', company.id)).count, 1,
  'Unambiguously excluded supplier SKU stays hidden across revisions');
const restored = await service.catalog('tenant', company.id, '', 0, true);
assert.equal(restored.count, 1);
assert.equal(restored.items[0].supplierSku, '002');
await service.setExcluded('tenant', company.id, { rowIds: [restored.items[0].id], excluded: false });
assert.equal((await service.catalog('tenant', company.id)).count, 2,
  'Restoring affects the latest version without touching stock or source file');
assert.equal(offers[0].listPrice, 390, 'Linked offers follow new supplier price');
assert.equal(offers[0].actualPrice, 278, 'Supplier price revisions cannot overwrite invoice purchase price');
assert.equal(offers[0].discountPercent, 7, 'Supplier price revisions cannot invent a different personal discount');
assert.equal(savedHistory[0].price, 150, 'Previous receipts must retain their price');
assert.equal(stock.name, 'Working Dye', 'Worker-owned item attributes must not be overwritten');

const template = new ExcelJS.Workbook();
await template.xlsx.load(await service.template('tenant'));
assert.equal(template.worksheets[0].getRow(1).getCell(2).value, 'Наименование');

const pdfBuffer = await new Promise((resolve, reject) => {
  const pdf = new PDFDocument();
  const parts = [];
  pdf.on('data', part => parts.push(part));
  pdf.on('end', () => resolve(Buffer.concat(parts)));
  pdf.on('error', reject);
  pdf.text('A supplier catalog without structured rows');
  pdf.end();
});
const pdfFile = { originalname: 'suppliers.pdf', buffer: pdfBuffer, size: pdfBuffer.length };
const pdfPreview = await service.preview('tenant', company.id, pdfFile);
assert.equal(pdfPreview.format, 'pdf');
assert.equal(pdfPreview.status, 'NEEDS_TEMPLATE');
assert.equal(pdfPreview.count, 0);
const savedPdf = await service.import('tenant', company.id, pdfFile);
assert.equal(savedPdf.parserStatus, 'NEEDS_TEMPLATE');
assert.equal(lists.at(-1).sourceFile.length, pdfBuffer.length);
assert.equal(offers[0].listPrice, 390, 'Unrecognized PDF never corrupts linked prices');

const blocked = new InventoryCounterpartyService(db, { resolveCapability: async () => ({ enabled: false }) });
await assert.rejects(() => blocked.list('tenant'), /недоступны/);
console.log('PASS: actual XLSX/PDF ingestion, template, revisions, price refresh, idempotency and isolation');
