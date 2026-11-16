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
  unit: 'г', packageQuantity: 70 };
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
const db = {
  inventoryCounterparty: { findFirst: async ({ where }) =>
    where.tenantId === 'tenant' && where.id === company.id ? company : null },
  inventoryItem: { findFirst: async () => stock },
  inventoryCounterpartyPriceList: priceListRepository,
  inventoryCounterpartyCatalogItem: {
    findFirst: async ({ where }) => rows.find(row => row.id === where.id) || null,
  },
  inventorySupplierOffer: {
    findFirst: async ({ where }) => offers.find(offer =>
      offer.counterpartyId === where.counterpartyId && offer.inventoryItemId === where.inventoryItemId
      && offer.supplierSku === where.supplierSku) || null,
    create: async ({ data }) => { offers.push({ id: 'offer-' + ++counter, ...data }); },
  },
  $transaction: async callback => callback({
    $queryRaw: async () => [{ locked: 1 }],
    inventoryCounterpartyPriceList: priceListRepository,
    inventoryCounterpartyCatalogItem: {
      createMany: async ({ data }) => { rows.push(...data.map(row => ({ id: 'row-' + ++counter, ...row }))); },
      findMany: async ({ where }) => rows.filter(row => row.priceListId === where.priceListId && where.supplierSku.in.includes(row.supplierSku)),
    },
    inventorySupplierOffer: {
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

const offer = await service.link('tenant', company.id, rows[0].id, stock.itemId);
assert.equal(offer.itemId, stock.itemId);
assert.equal(offers.length, 1);
assert.equal(offers[0].unitsPerOffer, 70, 'No fake conversion from supplier pieces to working stock grams');
assert.equal(savedHistory[0].price, 150);
const second = await service.import('tenant', company.id, await excelFile(390));
assert.equal(second.revision, 2);
assert.equal(lists.length, 2);
assert.equal(offers[0].listPrice, 390, 'Linked offers follow new supplier price');
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
