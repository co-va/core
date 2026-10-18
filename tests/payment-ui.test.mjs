import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { paymentForm, paymentMethods } from '../ui/payment/index.js';
import { paymentAllocationState } from '../ui/payment/methods.js';
import { calculateSettlement } from '../core/finance/index.js';
import { shortDate } from '../ui/utils/date-time.js';
import { zonedDateTimeParts, zonedDateTimeToDate } from '../core/time/index.js';

const html = paymentForm({
  workplace: 'Рабочее пространство',
  date: '11.09.26',
  time: '12:00 - 13:00',
  person: { uei: '0278', name: 'Наталья Гусева' },
  procedures: [
    { id: 'p1', name: 'Стрижка - Женская', cost: 7000, pricePercent: 0 },
    { id: 'p2', name: 'Очень длинное название процедуры без сокращения', cost: 2500, pricePercent: 10 },
  ],
  total: 9250,
});

assert.match(html, /data-payment-sections/);
assert.match(html, /data-v2-z-body-sections/);
assert.match(html, /payment-summary-mini-card/);
assert.match(html, /data-payment-price/);
assert.match(html, /data-payment-price-condition/);
assert.match(html, /data-payment-correction-percent/);
assert.match(html, /data-payment-correction-money/);
assert.match(html, /data-payment-action/);
assert.doesNotMatch(html, /data-payment-save|data-payment-submit/);
assert.equal((html.match(/<button\b[^>]*\bdata-payment-action(?:\s|>)/g) || []).length, 1);
assert.equal((html.match(/data-payment-procedure="/g) || []).length, 2);

const embeddedHtml = paymentForm({
  workplace: 'Тест', date: '11.09.26', time: '12:00 - 13:00',
  person: { uei: 'U1', name: 'Тест' },
  procedures: [{ id: 'p1', name: 'Процедура', cost: 1000 }],
  total: 1000,
  showActions: false,
});
assert.doesNotMatch(embeddedHtml, /data-payment-action/);

const automaticPercent = calculateSettlement([{ sourceId: 'p1', name: 'Стрижка', price: 5000 }], { pricePercent: 20 });
assert.equal(automaticPercent.planTotal, 4000);
assert.equal(automaticPercent.items[0].pricePercent, 20);

const correctedThenAutomatic = calculateSettlement([
  { sourceId: 'p1', name: 'Стрижка', price: 5000, correctionMode: 'percent', correctionPercent: 10 },
], { pricePercent: 20 });
assert.equal(correctedThenAutomatic.correctionTotal, 500);
assert.equal(correctedThenAutomatic.pricePercentTotal, 900);
assert.equal(correctedThenAutomatic.planTotal, 3600);

const methodsHtml = paymentMethods({
  wallets: [{ id: 'cash', name: 'Наличные' }, { id: 'card', name: 'СберБанк' }],
  deposits: [{ depositId: 'dep-1', programName: 'Депозит 10%', balance: 3500 }],
  personalAccount: { personKey: 'person-1', balance: 2400, availableAmount: 1800, spendLimitPercent: 50 },
  total: 7000,
});
assert.match(methodsHtml, /Депозит 10% · остаток 3 500 ₽/);
assert.match(methodsHtml, /Личный счёт · доступно 1 800 ₽/);
assert.match(methodsHtml, /data-payment-personal-account/);
assert.match(methodsHtml, /data-payment-allocation-row="0"/);
assert.match(methodsHtml, /data-payment-tips-row hidden/);

const mixed = paymentAllocationState([
  { walletId: 'cash', walletName: 'Наличные', amount: 1500 },
], 5000, [
  { depositId: 'dep-1', name: 'Депозит', balance: 3500, amount: 2500 },
], { amount: 1500, availableAmount: 1800 });
assert.equal(mixed.applied, 5000);
assert.equal(mixed.remaining, 0);
assert.equal(mixed.tips, 500);
assert.equal(mixed.valid, true);

assert.equal(shortDate('2026-09-11'), '11.09.26');
const moscowMoment = zonedDateTimeToDate('2026-09-21T14:30', 'Europe/Moscow');
assert.equal(moscowMoment.toISOString(), '2026-09-21T11:30:00.000Z');
assert.deepEqual(
  { date: zonedDateTimeParts(moscowMoment, 'Europe/Moscow').date, time: zonedDateTimeParts(moscowMoment, 'Europe/Moscow').time },
  { date: '2026-09-21', time: '14:30' },
);

const paymentSource = readFileSync(new URL('../ui/payment/index.js', import.meta.url), 'utf8');
const methodsSource = readFileSync(new URL('../ui/payment/methods.js', import.meta.url), 'utf8');
const paymentCss = readFileSync(new URL('../ui/payment/payment.css', import.meta.url), 'utf8');
const financeServiceSource = readFileSync(new URL('../core/finance/service.js', import.meta.url), 'utf8');
const paymentMechanismSource = readFileSync(new URL('../core/payment/record-payment.js', import.meta.url), 'utf8');
const journalDaySource = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
const recordViewSource = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');

assert.match(paymentSource, /const percentOptions = \[/);
assert.match(paymentSource, /data-payment-correction-mode/);
assert.match(paymentSource, /data-payment-price-percent/);
assert.match(paymentSource, /miniCard/);
assert.match(paymentSource, /v2ZBodySections/);
assert.match(paymentSource, /dirty \? 'Сохранить' : 'Оплатить'/);
assert.match(methodsSource, /const tips = Math\.max\(0, cashReceived - serviceFromCash\)/);
assert.match(methodsSource, /readOnlyReceipt/);
assert.match(paymentCss, /\.payment-edit-grid\{display:grid/);
assert.match(paymentCss, /data-payment-ui\]>\.modal-actions\{position:absolute/);

for (const command of ['cancelFinanceOperation', 'correctFinanceOperation', 'hardDeleteFinanceOperation', 'recordRefundExpense', 'recordPaymentIncome']) {
  assert.match(financeServiceSource, new RegExp(`export async function ${command}`));
}

assert.doesNotMatch(journalDaySource, /openRecordPaymentEntry|openRecordPayment/);
assert.match(recordViewSource, /import \{ openRecordPayment \} from '\.\.\/payment\/record-payment\.js'/);
assert.match(recordViewSource, /data-record-view-payment/);
assert.match(recordViewSource, /К оплате: \$\{formatMoney\(payment\.remaining\)\}/);
assert.match(recordViewSource, /openRecordPayment\(syncCurrent\(\)\)/);
assert.doesNotMatch(recordViewSource, /paymentForm|paymentMethods|recordPaymentIncome/);
assert.match(paymentMechanismSource, /export function openRecordPayment\(record\)/);
assert.match(paymentMechanismSource, /paymentForm\(/);
assert.match(paymentMechanismSource, /paymentMethods\(/);
assert.match(paymentMechanismSource, /recordPaymentIncome\(/);
assert.equal(existsSync(new URL('../journal/journal-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-payment.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../core/payment/record-payment.js', import.meta.url)), true);

console.log('payment UI tests: OK');
