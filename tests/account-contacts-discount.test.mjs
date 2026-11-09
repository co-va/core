import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolvePersonPriceCondition } from '../core/loyalty/price-condition.js';

// Exercise the actual production projection and AccountContactsService method,
// without a database or copies of the discount calculation in this test.
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const service = read('server/src/account-contacts/account-contacts.service.ts');
const deposits = read('server/src/loyalty/deposit-state.ts');
const controller = read('server/src/account-contacts/account-contacts.controller.ts');

function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'Expected source block: ' + from);
  return source.slice(start, end);
}

const accountHelpers = between(service, 'function text(value: unknown)', 'function profilePhones(');
const depositHelpers = between(deposits, 'function objectValue(value: unknown)', 'export function depositPersonKey(');
const depositProjection = between(deposits, 'export function depositPriceSourcesFromRows(', 'export async function activeDepositPriceSources(');
const contactProjection = between(service, 'function personBelongsToAccount(', 'function completedRecord(');
const contactsMethod = between(service, '  private async accountDiscounts(', '  private async projectedRecords(')
  .replace('  private async accountDiscounts(', 'async function accountDiscounts(');

const fixtureSource = [accountHelpers, depositHelpers, depositProjection, contactProjection, contactsMethod]
  .join('\n').replaceAll('export function ', 'function ');
const runnable = stripTypeScriptTypes(fixtureSource, { mode: 'strip' });
const runtime = runInNewContext(
  runnable + '\n({ accountDiscounts, effectiveDiscountForPerson, personBelongsToAccount, depositPriceSourcesFromRows })',
  { resolvePersonPriceCondition },
);

const me = { key: 'person-me', accounts: ['account-me'], phones: ['79990000000'], discountPercent: 12 };
const other = { key: 'person-other', accounts: ['account-other'], phones: ['79991111111'], discountPercent: 47 };
const program = {
  tenantId: 'pro-a', personKey: me.key, status: 'active',
  depositId: 'deposit-1', programId: 'program-1', programName: 'Сезонная программа',
  terms: { termMode: 'dated', termStartDate: '2020-01-01', termEndDate: '2099-12-31', benefitType: 'discount', benefitValue: 20 },
};
const at = new Date('2026-11-09T12:00:00.000Z');
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(runtime.effectiveDiscountForPerson(me, [], at)),
  { percent: 12, source: 'personal', programName: '' },
  'Manual discount is passed from Person without duplicating its calculation');

assert.deepEqual(plain(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [program], at)),
  { percent: 20, source: 'program', programName: 'Сезонная программа' },
  'Active assigned program discount is passed, without copying it to Person');

assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [
  { ...program, terms: { ...program.terms, termEndDate: '2000-01-01' } },
], at), null, 'Expired program discount disappears even before status housekeeping');

assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [
  { ...program, status: 'expired' },
], at), null, 'Ended instance does not leave a stale percent');
assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [], at), null,
  'Empty manual discount field stays empty, not 0%');
assert.equal(runtime.effectiveDiscountForPerson(me, [program], at), null,
  'Two conflicting discount sources must not be silently added or selected');
assert.equal(runtime.personBelongsToAccount({ ...other, phones: me.phones }, 'account-me', me.phones[0]), false,
  'Another explicitly linked account cannot inherit a discount through matching phone');

let personRows = [
  { tenantId: 'pro-a', key: me.key, data: me },
  { tenantId: 'pro-a', key: other.key, data: other },
  { tenantId: 'pro-b', key: 'other-b', data: { ...other, key: 'other-b' } },
];
let depositRows = [];
let personReads = 0;
let depositReads = 0;
const prisma = {
  person: { async findMany({ where }) {
    personReads += 1;
    return personRows.filter((row) => where.tenantId.in.includes(row.tenantId));
  } },
  loyaltyDepositInstance: { async findMany({ where }) {
    depositReads += 1;
    return depositRows.filter((row) => where.tenantId.in.includes(row.tenantId) && row.status === 'active');
  } },
};
const listDiscounts = () => runtime.accountDiscounts.call({ prisma }, 'account-me', '79990000000', ['pro-a', 'pro-b']);

let result = await listDiscounts();
assert.deepEqual(plain(result.get('pro-a')), { percent: 12, source: 'personal', programName: '' });
assert.equal(result.get('pro-b'), null, 'Unrelated professional must not reveal another Person discount');
assert.equal(personReads, 1, 'Single batch read of Person');
assert.equal(depositReads, 1, 'Single batch read of assigned programs');

personRows = personRows.map((row) => row.key === me.key
  ? { ...row, data: { ...me, discountPercent: 0 } } : row);
depositRows = [program];
result = await listDiscounts();
assert.deepEqual(plain(result.get('pro-a')),
  { percent: 20, source: 'program', programName: 'Сезонная программа' });

depositRows = [{ ...program, terms: { ...program.terms, termEndDate: '2000-01-01' } }];
result = await listDiscounts();
assert.equal(result.get('pro-a'), null, 'Program ended: discount field is cleared on the next API read');

depositRows = [];
personRows = [
  { tenantId: 'pro-a', key: 'ambiguous-1', data: { key: 'ambiguous-1', phones: me.phones, discountPercent: 10 } },
  { tenantId: 'pro-a', key: 'ambiguous-2', data: { key: 'ambiguous-2', phones: me.phones, discountPercent: 30 } },
];
result = await listDiscounts();
assert.equal(result.get('pro-a'), null, 'Ambiguous identity must not disclose any discount');

// The already-assigned program must expose its actual active discount as
// a numeric field without changing the original nominal or balance.
const visibleMethod = between(service, '  private async visibleDepositSummaries(', '  private async programSummaries(')
  .replace('  private async visibleDepositSummaries(', 'async function visibleDepositSummaries(');
const summariesMethod = between(service, '  private async programSummaries(', '  // Both list and detail')
  .replace('  private async programSummaries(', 'async function programSummaries(');
const programRuntime = runInNewContext(
  stripTypeScriptTypes(accountHelpers + '\n' + visibleMethod + '\n' + summariesMethod, { mode: 'strip' })
    + '\n({ visibleDepositSummaries, programSummaries })',
  {
    depositPriceSourcesFromRows: runtime.depositPriceSourcesFromRows,
    expireDepositInstances: async () => {},
  },
);
let assignedRows = [{
  ...program, initialAmount: 15000, balance: 12000,
}];
const context = {
  prisma: {
    loyaltyDepositInstance: { findMany: async () => assignedRows },
    loyaltyDepositProgram: {
      findMany: async () => [{ programId: program.programId, data: { showToAll: true } }],
    },
  },
  personalAccounts: { endUserSummary: async () => null },
};
context.visibleDepositSummaries = programRuntime.visibleDepositSummaries.bind(context);
const assignedPrograms = () => programRuntime.programSummaries.call(context, 'pro-a', { key: me.key });

let assigned = await assignedPrograms();
assert.equal(assigned.length, 1);
assert.equal(assigned[0].discountPercent, 20, 'Program card receives numeric active discount');
assert.equal(assigned[0].fundedAmount, 15000, 'Original program nominal is unchanged');
assert.equal(assigned[0].balance, 12000, 'Original program balance is unchanged');
assert.equal(assigned[0].terms.benefit, '', 'Existing program terms remain as before');

assignedRows = [{
  ...assignedRows[0],
  terms: { ...program.terms, termEndDate: '2000-01-01' },
}];
assigned = await assignedPrograms();
assert.equal(assigned[0].discountPercent, 0, 'Expired program cannot advertise an active percent');
assert.equal(assigned[0].fundedAmount, 15000, 'Expiry does not rewrite nominal');

assignedRows = [{ ...assignedRows[0], status: 'closed', terms: program.terms }];
assigned = await assignedPrograms();
assert.equal(assigned[0].discountPercent, 0, 'Closed program cannot advertise an active percent');

assert.match(service, /depositPriceSourcesFromRows\(rows, personKey, new Date\(\)\)/,
  'Program discount and Person discount use one existing canonical source');

// Both existing endpoints must return the same shape; program assignment
// and existing program nominal/amount fields are not modified.
assert.match(controller, /@Get\(\)\s*list\(/);
assert.match(controller, /@Get\(':tenantId'\)\s*detail\(/);
assert.match(service, /discount: discounts\.get\(tenantId\) \|\| null/);
assert.match(service, /discount: discounts\.get\(context\.tenantId\) \|\| null/);
assert.match(service, /programs,\s*\};/);
assert.match(service, /fundedAmount: Number\(deposit\.fundedAmount \|\| 0\)/);
assert.doesNotMatch(contactProjection, /workplace|scope:/i, 'Discount does not depend on a workplace');

console.log('Account contacts discount: personal, active program, expiry, no discount, identity and API contract PASS');
