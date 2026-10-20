import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const payment = readFileSync(new URL('../core/payment/record-payment.js', import.meta.url), 'utf8');

assert.match(payment, /export function openRecordPaymentActions\(record, \{ onSaved = \(\) => \{\}, extraActions = '' \} = \{\}\)/);
assert.match(payment, /button\('Корректировка оплаты'/);
assert.match(payment, /button\('Возврат'/);
assert.match(payment, /button\('Удаление оплаты'/);
assert.match(payment, /paymentActionsBody\(state, extraActions\)/);
assert.match(payment, /extraActions,\s*\]\.filter\(Boolean\)\.join\(''\)/s);
assert.match(recordView, /import \{ openRecordPaymentActions \} from '\.\.\/payment\/record-payment\.js'/);
assert.match(recordView, /import \{ openPersonHistoryQ \} from '\.\.\/people\/people\.js'/);
assert.match(recordView, /const paymentState = getRecordPaymentState\(source\);\s*if \(paymentState\.hasPayments\) \{\s*const actions = openRecordPaymentActions\(source,/s);
assert.match(recordView, /extraActions: button\('История', \{ variant: 'secondary', data: 'data-record-view-history' \}\)/);
assert.match(recordView, /return openPersonHistoryQ\(document\.body, person\);/);
assert.doesNotMatch(recordView, /insertAdjacentHTML\('beforeend', button\('История'/);
assert.doesNotMatch(payment, /openPersonHistoryQ|people\/people\.js/);
assert.doesNotMatch(recordView, /correctFinanceOperation|recordRefundExpense|hardDeleteFinanceOperation/);

console.log('record paid V actions: ok');
