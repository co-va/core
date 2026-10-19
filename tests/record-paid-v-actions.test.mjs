import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const payment = readFileSync(new URL('../core/payment/record-payment.js', import.meta.url), 'utf8');

assert.match(payment, /export function openRecordPaymentActions\(/);
assert.match(payment, /button\('Корректировка оплаты'/);
assert.match(payment, /button\('Возврат'/);
assert.match(payment, /button\('Удаление оплаты'/);
assert.match(recordView, /import \{ openRecordPaymentActions \} from '\.\.\/payment\/record-payment\.js'/);
assert.match(recordView, /const paymentState = getRecordPaymentState\(source\);\s*if \(paymentState\.hasPayments\) \{\s*openRecordPaymentActions\(source,/s);
assert.doesNotMatch(recordView, /correctFinanceOperation|recordRefundExpense|hardDeleteFinanceOperation/);

console.log('record paid V actions: ok');
