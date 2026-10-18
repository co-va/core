import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hydrateDaysFromServer } from '../core/day/index.js';
import {
  calculateSettlement,
  getSettlementItemTotals,
  getWalletBalance,
  hydrateFinanceFromServer,
  hydrateWalletsFromServer,
} from '../core/finance/index.js';
import {
  createRecord,
  getRecord,
  getRecords,
  hydrateRecordStateFromServer,
  moveRecord,
  setRecordAttendance,
  updateRecord,
} from '../core/record/index.js';
import {
  canonicalFinanceState,
  paymentFixture,
  refundFixture,
  settlementRow,
} from './helpers/finance-canonical.mjs';

const recordServiceSource = readFileSync(new URL('../core/record/service.js', import.meta.url), 'utf8');
const serverRecordSource = readFileSync(new URL('../server/src/record/record.service.ts', import.meta.url), 'utf8');

assert.doesNotMatch(recordServiceSource, /from ['"][^'"]*finance\/index\.js['"]/);
assert.match(recordServiceSource, /'finance'/);
assert.match(serverRecordSource, /this\.finance\.upsertSettlement/);
assert.match(serverRecordSource, /const \{ finance: _financeProjection, \.\.\.currentRecord \} = current/);
assert.match(serverRecordSource, /const requestedCost = Number\(draft\?\.cost \?\? draft\?\.price\);/);
assert.match(serverRecordSource, /cost: Number\.isFinite\(requestedCost\) && requestedCost >= 0 \? requestedCost : item\.cost/);

// Record owns source facts; a personal discount is only an editable payment suggestion.
hydrateDaysFromServer([
  { date: '2026-09-20', workplaceId: 'workplace-1', from: '09:00', to: '20:00' },
  { date: '2026-09-21', workplaceId: 'workplace-1', from: '09:00', to: '20:00' },
  { date: '2026-09-22', workplaceId: 'workplace-1', from: '09:00', to: '20:00' },
  { date: '2026-09-23', workplaceId: 'workplace-1', from: '09:00', to: '20:00' },
]);
hydrateRecordStateFromServer({ records: [], recordEvents: [] });
hydrateFinanceFromServer({ version: 7, settlements: [], operations: [], ledger: [] });
hydrateWalletsFromServer([]);

const person = { id: 'person-1', key: 'person-1', name: 'Анна', discountPercent: 20 };
const record = createRecord({
  date: '2026-09-20',
  workplaceId: 'workplace-1',
  from: '10:00',
  to: '11:00',
  person,
  procedures: [{ id: 'procedure-1', name: 'Стрижка', cost: 5000 }],
});
assert.ok(record);
assert.equal(record.finance.serviceTotal, 5000);
assert.equal(record.finance.pricePercent, 0);
assert.equal(record.finance.correctionTotal, 1000);
assert.equal(record.finance.planTotal, 4000);

// Source price correction belongs to Record; the suggested discount follows the factual price.
const corrected = updateRecord(record.id, {
  procedures: [{ id: 'procedure-1', name: 'Стрижка', cost: 8000 }],
});
assert.equal(corrected.procedures[0].cost, 8000);
assert.equal(corrected.finance.serviceTotal, 8000);
assert.equal(corrected.finance.correctionTotal, 1600);
assert.equal(corrected.finance.planTotal, 6400);

// Closing and reopening the Record reads the corrected source price and the same recalculated total.
const reopenedAfterCorrection = getRecord(record.id);
assert.equal(reopenedAfterCorrection.procedures[0].cost, 8000);
assert.equal(reopenedAfterCorrection.finance.serviceTotal, 8000);
assert.equal(reopenedAfterCorrection.finance.planTotal, 6400);

const moved = moveRecord(record.id, {
  date: '2026-09-21',
  workplaceId: 'workplace-1',
  from: '12:00',
  to: '13:00',
});
assert.equal(moved.finance.planTotal, 6400);

// A server payment snapshot stores the actually applied personal discount as the payment fact.
const correctedSettlement = calculateSettlement([
  {
    sourceType: 'procedure',
    sourceId: 'procedure-1',
    name: 'Стрижка',
    price: 8000,
    correctionMode: 'percent',
    correctionPercent: 20,
  },
]);
const payment = paymentFixture({
  id: 'payment-1',
  recordId: record.id,
  settlement: correctedSettlement,
  allocations: [{ walletId: 'cash', walletName: 'Наличные', amount: 6400 }],
  serviceAmount: 6400,
});
hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow(record.id, correctedSettlement)],
  payments: [payment],
}));

const attended = setRecordAttendance(record.id, 'arrived');
assert.equal(attended.finance.planTotal, 6400);
assert.equal(attended.finance.factTotal, 6400);
assert.equal(getRecords()[0].finance.factTotal, 6400);
assert.equal(getWalletBalance('cash'), 6400);
assert.equal(getSettlementItemTotals('procedure', 'procedure-1').factTotal, 6400);

// Record must reject a direct Settlement write. A person without a suggested discount
// can reach the same one-off amount only through the canonical manual price correction.
const noDiscount = createRecord({
  date: '2026-09-22',
  workplaceId: 'workplace-1',
  from: '14:00',
  to: '15:00',
  person: { id: 'person-2', key: 'person-2', name: 'Ирина', discountPercent: 0 },
  procedures: [{ id: 'procedure-2', name: 'Окрашивание', cost: 8000 }],
});
assert.equal(noDiscount.finance.planTotal, 8000);

const paymentStageSettlement = calculateSettlement([
  {
    sourceType: 'procedure',
    sourceId: 'procedure-2',
    name: 'Окрашивание',
    price: 8000,
    correctionMode: 'percent',
    correctionPercent: 20,
  },
]);
const rejectedByRecord = updateRecord(noDiscount.id, { finance: paymentStageSettlement });
assert.equal(rejectedByRecord.finance.planTotal, 8000);

hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow(noDiscount.id, paymentStageSettlement)],
}));
assert.equal(getRecord(noDiscount.id).finance.planTotal, 6400);
assert.equal(getRecord(noDiscount.id).finance.pricePercent, 0);
assert.equal(getRecord(noDiscount.id).finance.correctionTotal, 1600);

const stagePayment = paymentFixture({
  id: 'payment-stage',
  recordId: noDiscount.id,
  settlement: paymentStageSettlement,
  allocations: [{ walletId: 'cash', walletName: 'Наличные', amount: 6400 }],
  serviceAmount: 6400,
});
hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow(noDiscount.id, paymentStageSettlement)],
  payments: [stagePayment],
}));
assert.equal(getRecord(noDiscount.id).finance.factTotal, 6400);

// Refund is a Finance OUT fact and reopens the amount due.
const refund = refundFixture({
  id: 'refund-stage',
  paymentId: 'payment-stage',
  recordId: noDiscount.id,
  settlement: paymentStageSettlement,
  walletId: 'cash',
  walletName: 'Наличные',
  serviceAmount: 1000,
});
hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow(noDiscount.id, paymentStageSettlement)],
  payments: [stagePayment],
  refunds: [refund],
}));
assert.equal(getRecord(noDiscount.id).finance.factTotal, 5400);

// Another device restores plain Record facts plus the Finance-owned manual correction/Ledger.
hydrateRecordStateFromServer({
  records: [{
    id: 'restored-record',
    date: '2026-09-23',
    workplaceId: 'workplace-1',
    from: '16:00',
    to: '17:00',
    person: { id: 'person-3', key: 'person-3', name: 'Мария', discountPercent: 0 },
    procedures: [{ id: 'procedure-restored', name: 'Услуга', cost: 8000 }],
    products: [],
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  }],
  recordEvents: [],
});
const restoredSettlement = calculateSettlement([
  {
    sourceType: 'procedure',
    sourceId: 'procedure-restored',
    name: 'Услуга',
    price: 8000,
    correctionMode: 'percent',
    correctionPercent: 20,
  },
]);
const restoredPayment = paymentFixture({
  id: 'payment-restored',
  recordId: 'restored-record',
  settlement: restoredSettlement,
  allocations: [{ walletId: 'cashless', walletName: 'Безналичные', amount: 6400 }],
  serviceAmount: 6400,
});
hydrateFinanceFromServer(canonicalFinanceState({
  settlements: [settlementRow('restored-record', restoredSettlement)],
  payments: [restoredPayment],
}));
const restored = getRecord('restored-record');
assert.equal(restored.finance.pricePercent, 0);
assert.equal(restored.finance.correctionTotal, 1600);
assert.equal(restored.finance.planTotal, 6400);
assert.equal(restored.finance.factTotal, 6400);

console.log('critical record flow tests: OK');
