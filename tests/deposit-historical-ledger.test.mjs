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
console.log('Historical deposit ledger: PASS');
