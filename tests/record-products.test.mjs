import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { hydrateDaysFromServer } from '../core/day/index.js';
import { calculateSettlement, getSettlementItemTotals, hydrateFinanceFromServer } from '../core/finance/index.js';
import { createRecord, getRecords, hydrateRecordStateFromServer, updateRecord } from '../core/record/index.js';
import { canonicalFinanceState, paymentFixture, settlementRow } from './helpers/finance-canonical.mjs';

hydrateDaysFromServer([
  { date: '2026-09-11', workplaceId: 'studio', from: '09:00', to: '18:00' },
]);
hydrateRecordStateFromServer({ records: [], recordEvents: [] });
hydrateFinanceFromServer({ version: 6, settlements: [], operations: [], ledger: [], income: [], expense: [] });

const record = createRecord({
  date: '2026-09-11',
  workplaceId: 'studio',
  from: '10:00',
  to: '11:00',
  person: { key: 'person-products', name: 'Анна', surname: 'Товар' },
  procedures: [{ id: 'procedure-products', name: 'Стрижка', cost: 5000, duration: 60 }],
});
assert.ok(record);
assert.deepEqual(record.products, []);
assert.equal(record.finance.serviceTotal, 5000);

const withProduct = updateRecord(record.id, {
  products: [{ id: 'product-1', name: 'Шампунь', cost: 2000 }],
});
assert.ok(withProduct);
assert.equal(withProduct.products.length, 1);
assert.equal(withProduct.finance.serviceTotal, 7000);
assert.equal(withProduct.finance.planTotal, 7000);
assert.equal(withProduct.finance.items.find((item) => item.sourceId === 'product-1')?.sourceType, 'product');
assert.equal(withProduct.finance.items.find((item) => item.sourceId === 'procedure-products')?.sourceType, 'procedure');

// A one-off product reduction is a manual price correction, not a person/program percentage.
const correctedProductSettlement = calculateSettlement(withProduct.finance.items.map((item) => item.sourceType === 'product'
  ? { ...item, correctionMode: 'percent', correctionPercent: 10 }
  : { ...item, correctionMode: 'none', correctionPercent: 0, correctionMoney: 0 }));

const rejectedByRecord = updateRecord(record.id, { finance: correctedProductSettlement });
assert.equal(rejectedByRecord.finance.planTotal, 7000);

const payment = paymentFixture({
  id: 'payment-products',
  recordId: record.id,
  settlement: correctedProductSettlement,
  allocations: [{ walletId: 'cash', walletName: 'Наличные', amount: 6800 }],
  serviceAmount: 6800,
});
hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow(record.id, correctedProductSettlement)],
  payments: [payment],
}));

assert.equal(getSettlementItemTotals('procedure', 'procedure-products').factTotal, 5000);
assert.equal(getSettlementItemTotals('product', 'product-1').factTotal, 1800);
assert.equal(getRecords().find((item) => item.id === record.id)?.finance?.planTotal, 6800);

// Record View exposes only the Sale entry point; Sale owns product selection and persistence.
const recordViewSource = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const saleSource = readFileSync(new URL('../core/sale/sale.js', import.meta.url), 'utf8');
assert.match(recordViewSource, /import \{ openRecordSale \} from '\.\.\/sale\/sale\.js'/);
assert.match(recordViewSource, /button\('Продажа'/);
assert.match(recordViewSource, /data-record-view-sale/);
assert.match(recordViewSource, /openRecordSale\(syncCurrent\(\)/);
assert.doesNotMatch(recordViewSource, /getProducts|initMultiSelect|data-sale-product|updateRecord/);
assert.match(saleSource, /export function openSale\(/);
assert.match(saleSource, /export function openRecordSale\(/);
assert.match(saleSource, /getProducts\(\)/);
assert.match(saleSource, /initMultiSelect/);
assert.match(saleSource, /updateRecord\(current\.id, \{ products \}\)/);
assert.equal(existsSync(new URL('../core/sale/sale.js', import.meta.url)), true);
assert.equal(existsSync(new URL('../journal/journal-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-payment.js', import.meta.url)), false);

console.log('record product sale tests: OK');
