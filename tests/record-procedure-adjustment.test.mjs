import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const paymentAdjustment = readFileSync(new URL('../core/payment/procedure-adjustment.js', import.meta.url), 'utf8');

assert.match(recordView, /v2ListEntries\(\[/);
assert.match(recordView, /v2ListEntry\(\{/);
assert.match(recordView, /data-record-view-procedure-settings/);
assert.match(recordView, /actionIcon: '⚙'/);
assert.match(recordView, /variant: 'x'/);
assert.match(recordView, /label: 'Длительность, мин'/);
assert.match(recordView, /label: 'Цена'/);
assert.match(recordView, /label: 'Скидка %'/);
assert.match(recordView, /label: 'Скидка ₽'/);
assert.match(recordView, /saveRecordProcedurePaymentAdjustment/);
assert.match(recordView, /checkRecordTime\(/);
assert.match(recordView, /updateRecord\(latest\.id, \{ procedures: nextProcedures, to: nextTo \}\)/);
assert.match(recordView, /actionData: payment\.hasPayments \? '' : 'data-record-view-procedure-settings'/);
assert.doesNotMatch(recordView, /saveSettlementSnapshot/);

assert.match(paymentAdjustment, /saveSettlementSnapshot/);
assert.match(paymentAdjustment, /getRecordPaymentState\(current\)\.hasPayments/);
assert.match(paymentAdjustment, /export async function saveRecordProcedurePaymentAdjustment/);

console.log('record procedure adjustment: ok');
