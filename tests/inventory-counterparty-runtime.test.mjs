import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../server/node_modules/reflect-metadata');
const ExcelJS = require('../server/node_modules/exceljs');
const PDFDocument = require('../server/node_modules/pdfkit');
const { InventoryCounterpartyService } = require('../server/dist/inventory/inventory-counterparty.service.js');
const { effectiveSupplierOfferPrice } = require('../server/dist/inventory/inventory-pricing.js');
assert.equal(effectiveSupplierOfferPrice({
  agreementPriced: true, listPrice: 1500, discountPercent: 10, actualPrice: 1300,
}), 1350, 'Current contract price ignores a legacy manually entered price');
assert.equal(effectiveSupplierOfferPrice({
  agreementPriced: false, listPrice: 1500, discountPercent: 10, actualPrice: 1300,
}), 1300, 'Legacy manual offer price stays unchanged without agreement');


let counter = 0;
const company = { id: 'company', tenantId: 'tenant', name: 'Supply Store',
  kind: 'SUPPLIER', discountPercent: null };
const stock = { id: 'stock-db-1', itemId: 'stock-1', tenantId: 'tenant', name: 'Working Dye',
  sku: '001', barcode: '', unit: 'г', packageQuantity: 70 };
const lists = [], rows = [], offers = [];
const savedHistory = [{ id: 'historical-movement', price: 150 }];
const companies = [company];
const createCompany = async ({ data }) => {
  const item = { id: 'new-company-' + ++counter, ...data };
  companies.push(item);
  return item;
};
const findCompanies = async ({ where }) => companies.filter(row => row.tenantId === where.tenantId
  && !row.archivedAt && (!where.name || row.name.toLocaleLowerCase('ru-RU') ===
    String(where.name.equals).toLocaleLowerCase('ru-RU')));
const priceListRepository = {
  findFirst: async ({ where } = {}) => {
    const scoped = lists.filter(row => !where?.counterpartyId || row.counterpartyId === where.counterpartyId);
    if (where?.sha256) return scoped.find(row => row.sha256 === where.sha256) || null;
    if (where?.parserStatus) return scoped.filter(row => row.parserStatus === where.parserStatus).at(-1) || null;
    return scoped.at(-1) || null;
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
  inventoryCounterparty: {
    findFirst: async ({ where }) => companies.find(row => row.tenantId === where.tenantId
      && row.id === where.id && !row.archivedAt) || null,
    findMany: findCompanies,
    create: createCompany,
    updateMany: async ({ data }) => { Object.assign(company, data); return { count: 1 }; },
  },
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
    inventoryCounterparty: {
      findFirst: async ({ where }) => companies.find(row => row.tenantId === where.tenantId
        && row.id === where.id && !row.archivedAt) || null,
      findMany: findCompanies,
      create: createCompany,
      updateMany: async ({ data }) => { Object.assign(company, data); return { count: 1 }; },
    },
    inventoryItem: { findFirst: async ({ where }) => where.itemId === stock.itemId ? stock : null },
    inventoryCounterpartyCatalogItem: {
      findFirst: async ({ where }) => matchingCatalogRows(where).find(row => row.id === where.id) || null,
      createMany: async ({ data }) => { rows.push(...data.map(row => ({ id: 'row-' + ++counter, ...row }))); },
      findMany: async ({ where }) => matchingCatalogRows(where),
      count: async ({ where }) => matchingCatalogRows(where).length,
      update: async ({ where, data }) => {
        const item = rows.find(row => row.id === where.id);
        assert.ok(item, 'Supplier row must exist');
        Object.assign(item, data);
        return item;
      },
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
      updateMany: async ({ where, data }) => {
        const selected = offers.filter(offer => offer.counterpartyId === where.counterpartyId
          && (!where.catalogItemId || where.catalogItemId === offer.catalogItemId
            || where.catalogItemId.in?.includes(offer.catalogItemId))
          && offer.isActive !== false);
        selected.forEach(offer => Object.assign(offer, data));
        return { count: selected.length };
      },
    },
  }),
};
const service = new InventoryCounterpartyService(db, { resolveCapability: async () => ({ enabled: true }) });
// Contract of the entire Professional editor: no field may be silently ignored on create.
const inputCompany = {
  name: 'Supplier One', kind: 'DISTRIBUTOR', contactName: 'Alex',
  phone: '+79990000000', email: 'supply@example.com', website: 'https://example.com',
  note: 'Agreed terms', discountPercent: 12.5,
};
const createdCompany = await service.create('tenant', inputCompany);
for (const [field, value] of Object.entries(inputCompany)) {
  assert.equal(createdCompany[field], value, 'Create must persist Professional field: ' + field);
}
assert.equal(createdCompany.tenantId, 'tenant');
assert.equal((await service.create('tenant', { name: 'Zero discount', discountPercent: 0 })).discountPercent, 0,
  'Explicit zero must not be mistaken for a missing discount');
assert.equal((await service.create('tenant', { name: 'No discount' })).discountPercent, null,
  'Unset agreement remains nullable');
await assert.rejects(() => service.create('tenant', { name: 'Bad agreement', discountPercent: 120 }),
  /0 до 100/, 'Create must reject an invalid agreement instead of silently ignoring it');
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
assert.equal(offers[0].discountPercent, 0,
  'Agreement-priced offers use the current contract (no discount when unset)');
assert.equal(savedHistory[0].price, 150, 'Previous receipts must retain their price');
assert.equal(stock.name, 'Working Dye', 'Worker-owned item attributes must not be overwritten');

// Supplier agreement and catalog prices are independent of Stock and historical receipts.
const immutableOriginal = Buffer.from(lists[1].sourceFile);
await service.update('tenant', company.id, { discountPercent: 10 });
assert.equal(company.discountPercent, 10);
assert.equal(offers[0].discountPercent, 10, 'Linked offer follows supplier agreement');
assert.equal(offers[0].agreementPriced, true);
assert.equal((await service.catalog('tenant', company.id)).items[0].effectivePrice, 351,
  '390 base less 10 percent = 351 purchase proposal');
await assert.rejects(() => service.update('tenant', company.id, { discountPercent: 120 }), /0 до 100/);
const beforeBatch = rows.filter(row => row.priceListId === lists[1].id);
await service.changeCatalogPrices('tenant', company.id, {
  rowIds: beforeBatch.map(row => row.id), mode: 'percent', value: 10,
});
assert.equal(offers[0].listPrice, 429, 'Bulk +10% synchronizes linked offer base');
assert.equal((await service.catalog('tenant', company.id)).items[0].effectivePrice, 386.1);
await assert.rejects(() => service.changeCatalogPrices('tenant', company.id, {
  rowIds: ['not-existing'], mode: 'amount', value: 100,
}), /устарел/);
const edited = await service.editCatalogRow('tenant', company.id, beforeBatch[0].id, {
  name: 'Correct supplier long name', category: 'Supplier own group',
  listPrice: 500, discountPercent: 0,
});
assert.equal(edited.effectivePrice, 500, 'Item-specific 0% overrides the 10% agreement');
assert.equal(edited.discountSource, 'product');
assert.equal(offers[0].discountPercent, 0);
assert.equal(offers[0].listPrice, 500);
assert.equal(stock.name, 'Working Dye', 'Supplier edits never overwrite Stock short name');
assert.equal(stock.packageQuantity, 70, 'Supplier edits never touch Stock packaging');
assert.equal(savedHistory[0].price, 150, 'Historical costs remain immutable');
assert.deepEqual(Buffer.from(lists[1].sourceFile), immutableOriginal,
  'Correcting current catalog must not modify uploaded original Excel');

const template = new ExcelJS.Workbook();
await template.xlsx.load(await service.template('tenant'));
assert.equal(template.worksheets[0].getRow(1).getCell(1).value, 'Контрагент');
assert.equal(template.worksheets[0].getRow(1).getCell(3).value, 'Наименование');

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
assert.equal(offers[0].listPrice, 500, 'Unrecognized PDF never corrupts the latest manually corrected linked price');

// Global Excel intake: preview identifies the supplier, then import atomically creates
// the missing supplier and saves the catalog. Repeat imports must not duplicate companies.
const globalWorkbook = new ExcelJS.Workbook();
const globalSheet = globalWorkbook.addWorksheet('Прайс');
globalSheet.addRow(['Контрагент','Артикул','Наименование','Цена']);
globalSheet.addRow(['Вася Пупкин','VP-01','Краска 1',110]);
globalSheet.addRow(['','VP-02','Краска 2',120]);
const globalBytes = Buffer.from(await globalWorkbook.xlsx.writeBuffer());
const globalFile = { originalname: 'va-supplier.xlsx', buffer: globalBytes, size: globalBytes.length };
const globalPreview = await service.previewGlobal('tenant', globalFile);
assert.equal(globalPreview.status, 'READY', JSON.stringify(globalPreview.errors));
assert.equal(globalPreview.supplierName, 'Вася Пупкин');
assert.equal(globalPreview.count, 2);
assert.equal(globalPreview.matchedCounterpartyId, null);
const globalFirst = await service.importGlobal('tenant', globalFile);
assert.equal(globalFirst.createdCompany, true);
assert.equal(globalFirst.counterpartyName, 'Вася Пупкин');
assert.equal(globalFirst.count, 2);
assert.equal(companies.filter(x => x.name === 'Вася Пупкин').length, 1);
assert.equal((await service.catalog('tenant', globalFirst.counterpartyId)).count, 2);
assert.equal((await service.catalog('tenant', company.id)).count, 2,
  'Global import must not overwrite another supplier');
const afterPreview = await service.previewGlobal('tenant', globalFile);
assert.equal(afterPreview.matchedCounterpartyId, globalFirst.counterpartyId);
const repeated = await service.importGlobal('tenant', globalFile);
assert.equal(repeated.duplicate, true, 'Repeat Excel upload must preserve the original revision');
assert.equal(repeated.createdCompany, false);
assert.equal(companies.filter(x => x.name === 'Вася Пупкин').length, 1);
// Legacy Excel without an explicit supplier requires the user to choose an existing
// supplier or supply a name; it must not create an unnamed or guessed company.
const anonymousSupplierFile = await excelFile(555);
await assert.rejects(() => service.importGlobal('tenant', anonymousSupplierFile),
  /Укажите поставщика/);
const inferredKnown = await service.previewGlobal('tenant',
  { ...await excelFile(555), originalname: 'Supply Store.xlsx' });
assert.equal(inferredKnown.matchedCounterpartyId, company.id,
  'An unchanged supplier Excel can identify its existing company by exact filename');
await assert.rejects(() => service.importGlobal('tenant', globalFile,
  { counterpartyId: company.id }), /другой поставщик/,
  'File identity must not be silently assigned to a different supplier');
const manualExisting = await service.importGlobal('tenant', await excelFile(555),
  { counterpartyId: globalFirst.counterpartyId });
assert.equal(manualExisting.counterpartyId, globalFirst.counterpartyId);
assert.equal(manualExisting.createdCompany, false);
assert.equal(companies.filter(x => x.name === 'Вася Пупкин').length, 1);
const mixedWorkbook = new ExcelJS.Workbook();
const mixedSheet = mixedWorkbook.addWorksheet('Прайс');
mixedSheet.addRow(['Контрагент','Артикул','Наименование','Цена']);
mixedSheet.addRow(['Первый','A1','Товар А',100]);
mixedSheet.addRow(['Второй','B1','Товар Б',120]);
const mixedBuffer = Buffer.from(await mixedWorkbook.xlsx.writeBuffer());
const mixedFile = { originalname: 'mixed.xlsx', buffer: mixedBuffer, size: mixedBuffer.length };
const mixedPreview = await service.previewGlobal('tenant', mixedFile);
assert.equal(mixedPreview.status, 'NEEDS_TEMPLATE');
assert.match(mixedPreview.errors[0], /несколько поставщиков/);
await assert.rejects(() => service.importGlobal('tenant', mixedFile), /несколько поставщиков/);
assert.equal(companies.filter(x => x.name === 'Первый' || x.name === 'Второй').length, 0);

const blocked = new InventoryCounterpartyService(db, { resolveCapability: async () => ({ enabled: false }) });
await assert.rejects(() => blocked.list('tenant'), /недоступны/);
console.log('PASS: actual XLSX/PDF ingestion, template, revisions, price refresh, idempotency and isolation');
