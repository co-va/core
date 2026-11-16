import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = path.resolve('server/tsconfig.json');
require('./../server/node_modules/reflect-metadata');
require('./../server/node_modules/ts-node/register/transpile-only');
const ExcelJS = require('./../server/node_modules/exceljs');
const PDFDocument = require('./../server/node_modules/pdfkit');
const { InventoryCounterpartyService } = require('../server/src/inventory/inventory-counterparty.service.ts');

const schema = readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = readFileSync('server/prisma/migrations/20261116220000_inventory_counterparty_catalog/migration.sql','utf8');
const admin = readFileSync('admin/commercial-catalog.js','utf8');
const readiness = readFileSync('server/src/saas-access/readiness-policy.ts','utf8');
const invSnapshot = readFileSync('server/src/inventory/inventory.service.ts','utf8');
assert.match(schema, /model InventoryCounterparty \{/);
assert.match(schema, /model InventoryCounterpartyPriceList \{/);
assert.match(schema, /model InventoryCounterpartyCatalogItem \{/);
assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/);
assert.match(migration, /ALTER TABLE "InventorySupplierOffer" ADD COLUMN "counterpartyId"/);
assert.match(admin, /cabinet\.inventory\.counterparties/);
assert.match(readiness, /'cabinet\.inventory\.counterparties': \['inventory\.counterparties\.access'\]/);
assert.match(invSnapshot, /catalogItemId: offer\.catalogItemId/);

const wb = new ExcelJS.Workbook();
const sheet = wb.addWorksheet('Прайс');
sheet.addRow(['Артикул','Наименование','Производитель','Цена','Скидка %','Единица','В упаковке']);
sheet.addRow(['001', 'Color 7.1', 'Hair Co.', 320, 10, 'шт.', 1]);
sheet.addRow(['002', 'Color 8.1', 'Hair Co.', 410, 0, 'шт.', 1]);
const buf = Buffer.from(await wb.xlsx.writeBuffer());
const file = { buffer: buf, size: buf.length, originalname: 'price.xlsx' };
const existing = { id: 'company-1', tenantId: 't-1', name: 'Supplier One' };
const lists = [], savedRows = [];
const db = {
  inventoryCounterparty: { findFirst: async () => existing },
  inventoryCounterpartyPriceList: { findFirst: async () => null },
  $transaction: async fn => fn({
    $queryRaw: async () => [{ locked: 1 }],
    inventoryCounterpartyPriceList: {
      findFirst: async () => null,
      create: async ({ data }) => {
        const row = { id: 'list-1', ...data };
        lists.push(row); return row;
      },
    },
    inventoryCounterpartyCatalogItem: {
      createMany: async ({ data }) => { savedRows.push(...data); return { count: data.length }; },
    },
  }),
};
const service = new InventoryCounterpartyService(db, {
  resolveCapability: async () => ({ enabled: true }),
});
const preview = await service.preview('t-1', 'company-1', file);
assert.equal(preview.status,'READY');
assert.equal(preview.count, 2);
assert.equal(preview.sample[0].supplierSku, '001');
assert.equal(preview.sample[0].listPrice, 320);
const saved = await service.import('t-1','company-1',file);
assert.equal(saved.revision, 1);
assert.equal(saved.count, 2);
assert.equal(savedRows.length, 2);
assert.equal(savedRows[1].name, 'Color 8.1');
assert.equal(lists[0].sourceFile.length, buf.length);
assert.ok(!('balance' in savedRows[0]), 'Price list cannot generate stock movements');
const sample = await service.template('t-1');
const template = new ExcelJS.Workbook();
await template.xlsx.load(sample);
assert.equal(template.worksheets[0].getRow(1).getCell(2).value, 'Наименование');

const invalid = Buffer.from('not-an-xlsx');
await assert.rejects(() => service.preview('t-1','company-1',
  { buffer: invalid, size: invalid.length, originalname: 'price.xlsx' }), /Поддерживаются/);
const textOnlyPdf = await new Promise((resolve, reject) => {
  const pdf = new PDFDocument();
  const chunks = [];
  pdf.on('data', chunk => chunks.push(chunk));
  pdf.on('error', reject);
  pdf.on('end', () => resolve(Buffer.concat(chunks)));
  pdf.text('A supplier PDF without recognizable product table');
  pdf.end();
});
const pdfPreview = await service.preview('t-1','company-1', {
  buffer: textOnlyPdf, size: textOnlyPdf.length, originalname: 'price.pdf',
});
assert.equal(pdfPreview.format, 'pdf');
assert.equal(pdfPreview.status, 'NEEDS_TEMPLATE');
assert.equal(pdfPreview.count, 0);

const forbidden = new InventoryCounterpartyService(db, {
  resolveCapability: async () => ({ enabled: false }),
});
await assert.rejects(() => forbidden.list('t-1'), /недоступны/);
console.log('PASS: Core registration, Excel import/template, PDF fallback, tenant access and stock isolation');
