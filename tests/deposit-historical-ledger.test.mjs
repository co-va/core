import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../server/src/loyalty/deposit-history.ts', import.meta.url), 'utf8')
  .replaceAll('export ', '');
const { depositHistoricalLedger } = runInNewContext(
  stripTypeScriptTypes(source, { mode: 'strip' }) + '\n({ depositHistoricalLedger })',
);

const deposit = 'deposit-2024';
const terms = { benefitType: 'discount', benefitValue: 20 };
const op = (kind, at, amount, allocations = null) => ({
  kind, status: 'completed', occurredAt: at,
  sourceType: kind === 'deposit-funding' || kind === 'deposit-withdrawal' ? 'deposit' : 'record',
  sourceId: kind === 'deposit-funding' || kind === 'deposit-withdrawal' ? deposit : 'record-2024',
  data: allocations ? { depositAllocations: allocations } : { amount },
});
const used = (amount, principalAmount = amount, benefitAmount = 0) =>
  [{ depositId: deposit, amount, principalAmount, benefitAmount }];
const ops = [
  op('deposit-funding', '2024-01-02T12:00:00.000Z', 1000),
  op('deposit-funding', '2024-03-01T12:00:00.000Z', 500),
  op('payment', '2024-04-01T14:00:00.000Z', 300, used(300)),
  op('refund', '2024-05-01T14:00:00.000Z', 50, used(50)),
];
const run = (at, extra = 0, operations = ops, conditions = terms) =>
  depositHistoricalLedger(operations, deposit, conditions, new Date(at), extra);
assert.equal(run('2024-01-01T14:00:00.000Z').available, 0,
  'A 2024 visit cannot spend a deposit funded on a later day');
assert.equal(run('2024-02-01T14:00:00.000Z').available, 1000,
  'Current expired status does not erase the 2024 ledger');
assert.equal(run('2024-04-02T14:00:00.000Z').available, 1200,
  'Both funding events and an earlier service payment affect as-of balance');
assert.equal(run('2024-05-02T14:00:00.000Z').available, 1250,
  'Refund is recorded as a separate dated event');
assert.equal(run('2026-11-23T14:00:00.000Z').remaining, 1250,
  'Expiry retains the financial remainder instead of treating it as spent');
assert.equal(run('2026-11-23T14:00:00.000Z').remainingPrincipal, 1250,
  'Historical principal remains auditable after the deposit term');
assert.deepEqual(JSON.parse(JSON.stringify(run('2024-02-01T14:00:00.000Z', 750).allocation)),
  { amount: 750, principalAmount: 750, benefitAmount: 0 });
assert.throws(() => run('2024-02-01T14:00:00.000Z', 1000.01),
  /Недостаточно средств/, 'Never spend money before it was funded');
assert.throws(() => run('2024-02-01T14:00:00.000Z', 100, [
  op('deposit-funding', '2024-01-02T12:00:00.000Z', 1000),
  op('payment', '2024-04-01T14:00:00.000Z', 950, used(950)),
]), /последующих операций/,
'A new backdated payment cannot make a later confirmed service go negative');
const accrual = { benefitType: 'accrual', benefitValue: 20 };
const accrualOps = [op('deposit-funding', '2024-01-02T12:00:00.000Z', 1000)];
assert.equal(run('2024-01-03T12:00:00.000Z', 0, accrualOps, accrual).available, 1200);
assert.deepEqual(JSON.parse(JSON.stringify(run('2024-01-03T12:00:00.000Z', 1100, accrualOps, accrual).allocation)),
  { amount: 1100, principalAmount: 1000, benefitAmount: 100 },
  'Accompanying bonus cannot be mistaken for the actual principal');
assert.equal(run('2024-02-01T12:00:00.000Z', 0, [
  ...ops, op('deposit-withdrawal', '2024-01-31T12:00:00.000Z', 700),
]).available, 0, 'Deposit withdrawal closes the old balance');

// Exercise the production expired-deposit allocation path, not just its pure
// ledger helper, with a transaction stub that forbids materialized writes.
const state = readFileSync(new URL('../server/src/loyalty/deposit-state.ts', import.meta.url), 'utf8');
const body = state.slice(state.indexOf('function objectValue('),
  state.indexOf('export async function restoreDepositAllocations(')).replaceAll('export ', '');
const { consumeDepositAllocations, expireDepositInstances } = runInNewContext(
  stripTypeScriptTypes(body, { mode: 'strip' }) + '\n({ consumeDepositAllocations, expireDepositInstances })',
  { depositHistoricalLedger, BadRequestException: class extends Error {} },
);
let updates = 0;
const autoExpiryWrites = [];
const oldDeposit = {
  id: deposit, depositId: deposit, status: 'active',
  terms: { ...terms, termMode: 'dated', termStartDate: '2024-01-01', termEndDate: '2025-01-31' },
  balance: 1250, principalBalance: 1250, benefitBalance: 0,
};
const expiryDb = {
  loyaltyDepositInstance: {
    findMany: async () => [oldDeposit],
    update: async (value) => { autoExpiryWrites.push(value.data); },
  },
};
await expireDepositInstances(expiryDb, 'tenant-1', deposit);
assert.deepEqual(JSON.parse(JSON.stringify(autoExpiryWrites)), [{ status: 'expired' }],
  'On expiry Core must only change status, NEVER zero unused principal/benefit/balance');
autoExpiryWrites.length = 0;
await expireDepositInstances({
  loyaltyDepositInstance: {
    findMany: async () => [{
      ...oldDeposit,
      terms: { ...oldDeposit.terms, termStartDate: '2099-01-01', termEndDate: '2099-12-31' },
    }],
    update: async (value) => { autoExpiryWrites.push(value.data); },
  },
}, 'tenant-1', deposit);
assert.equal(autoExpiryWrites.length, 0, 'A future start must not be confused with expiration');
const expired = {
  id: deposit, depositId: deposit, personKey: 'person-1', status: 'expired',
  terms: { ...terms, termMode: 'dated', termStartDate: '2024-01-01', termEndDate: '2025-01-31' },
  fundedAt: new Date('2024-01-02T12:00:00.000Z'),
  balance: 0, principalBalance: 0, benefitBalance: 0,
};
const tx = {
  loyaltyDepositInstance: {
    findUnique: async () => expired,
    update: async () => { updates += 1; throw new Error('Historical payment may not reopen deposit'); },
  },
  financeOperation: { findMany: async () => ops },
};
const receipt = await consumeDepositAllocations(tx, 'tenant-1',
  [{ depositId: deposit, amount: 200 }], 'person-1', new Date('2024-03-15T14:00:00Z'), true);
assert.equal(receipt.length, 1);
assert.equal(receipt[0].amount, 200);
assert.equal(receipt[0].principalAmount, 200);
assert.equal(updates, 0, 'Backfill never changes the expired status or materialized financial facts');
await assert.rejects(
  consumeDepositAllocations(tx, 'tenant-1', [{ depositId: deposit, amount: 100 }],
    'person-OTHER', new Date('2024-03-15T14:00:00Z'), true),
  /другому человеку|принадлежит/,
);
await assert.rejects(
  consumeDepositAllocations(tx, 'tenant-1', [{ depositId: deposit, amount: 100 }],
    'person-1', new Date('2025-02-01T14:00:00Z'), true),
  /недоступен/,
);

const currentViewSource = readFileSync(new URL('../server/src/loyalty/deposit.service.ts', import.meta.url), 'utf8');
assert.match(currentViewSource, /row.status === 'expired'\s*\? depositHistoricalLedger/,
  'Already-zeroed deposits must display their actual unused balance from FinanceOperation');
const paySource = readFileSync(new URL('../server/src/finance/payment-settlement.service.ts', import.meta.url), 'utf8');
assert.match(paySource, /recordVisitAt && !historicalRecordPayment \? recordVisitAt : occurredAt/,
  'Prepaid deposits must be validated against the visit date, not transaction date');
console.log('Historical deposit ledger: PASS');
