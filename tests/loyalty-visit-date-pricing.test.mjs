import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolvePersonPriceCondition } from '../core/loyalty/price-condition.js';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const price = read('server/src/loyalty/price-condition.ts');
const record = read('server/src/record/record.service.ts');
const payment = read('server/src/finance/payment-settlement.service.ts');
const depositState = read('server/src/loyalty/deposit-state.ts');

const priceSource = price.slice(price.indexOf('function objectValue(')).replaceAll('export ', '');
assert.ok(priceSource.includes('function visitDatePriceMoment('));
const depositSource = depositState.slice(
  depositState.indexOf('function objectValue('),
  depositState.indexOf('export function depositPersonKey('),
).replaceAll('export ', '');

const depositRules = runInNewContext(
  stripTypeScriptTypes(depositSource, { mode: 'strip' }) + '\n({ depositTermActiveAt })',
);
const rows = [{
  personKey: 'person-1', depositId: 'deposit-1', status: 'active',
  terms: { termMode: 'dated', termStartDate: '2026-11-01', termEndDate: '2026-11-30',
    benefitType: 'discount', benefitValue: 20 },
}];
const atSources = async (_db, _tenantId, key, date) => rows
  .filter((item) => item.personKey === key && item.status === 'active'
    && depositRules.depositTermActiveAt(item.terms, date))
  .map((item) => ({ type: 'program', programType: 'deposit', depositId: item.depositId,
    name: 'Депозит', percent: item.terms.benefitValue }));
const selectedSource = async (db, tenantId, key, assignmentId, at) =>
  (await atSources(db, tenantId, key, at)).find((item) => item.depositId === assignmentId) || null;
const pricing = runInNewContext(
  stripTypeScriptTypes(priceSource, { mode: 'strip' })
    + '\n({ visitDatePriceMoment, resolveSelectedRecordProgramPricePercent })',
  {
    BadRequestException: class BadRequestException extends Error {},
    resolvePersonPriceCondition,
    activeDepositPriceSources: atSources,
    selectedDepositPriceSource: selectedSource,
    depositPersonKey: (person) => String(person?.key || person?.id || ''),
  },
);
const effective = async (date, selection = null) =>
  (await pricing.resolveSelectedRecordProgramPricePercent(
    {}, 'tenant-1', { key: 'person-1', discountPercent: 20 }, selection,
    pricing.visitDatePriceMoment(date),
  )).percent;
assert.equal(await effective('2026-11-29'), 20);
assert.equal(await effective('2026-11-30'), 20, 'End date in the "По" field is included');
assert.equal(await effective('2026-12-01'), 0, 'From the next day the deposit has no price benefit');
assert.equal(await effective('2026-12-05'), 0);
assert.equal(await effective('2026-11-30', { type: 'deposit', assignmentId: 'deposit-1' }), 20);
assert.equal(await effective('2026-12-01', { type: 'deposit', assignmentId: 'deposit-1' }), 0);
assert.equal(await effective('2026-11-30', { type: 'certificate' }), 0);
assert.throws(() => pricing.visitDatePriceMoment('2026-02-30'), /Некорректная дата визита/);
rows.push({
  personKey: 'person-1', depositId: 'deposit-2', status: 'active',
  terms: { termMode: 'dated', termStartDate: '2026-12-04', termEndDate: '2027-01-31',
    benefitType: 'discount', benefitValue: 30 },
});
assert.equal(await effective('2026-12-05'), 30, 'A new deposit applies its own rate');

assert.match(record, /visitDatePriceMoment\(visitDate\)/,
  'Record must price by its actual service date');
assert.match(record, /repriceUnpaidVisit/,
  'Rescheduling an unpaid Record must update the deposit condition');
assert.match(record, /storedPayment.paid <= 0.009/,
  'Unpaid Record display must follow newly issued/expired program terms');
assert.match(record, /this.finance.repriceSettlement\(/,
  'Record display must use the shared Settlement repricer');
assert.match(payment, /visitDatePriceMoment\(record\.date\)/,
  'Record prepayment must use the canonical visit date');
assert.match(payment, /source\.type === 'record'[\s\S]*?recordRow = await tx\.record\.findUnique/,
  'Payment must look up the Record, not trust a date supplied by the payer');
assert.match(payment, /resolvePersonPricePercent\(tx, tenantId, person, occurredAt\)/,
  'Non-Record payments still use actual operation dates');
console.log('Deposit visit date pricing: PASS');
