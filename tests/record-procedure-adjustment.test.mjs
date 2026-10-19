import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const recordRuntime = readFileSync(new URL('../ui/record/runtime.js', import.meta.url), 'utf8');
const paymentAdjustment = readFileSync(new URL('../core/payment/procedure-adjustment.js', import.meta.url), 'utf8');

assert.match(recordRuntime, /v2ListEntry\(\{/);
assert.match(recordRuntime, /v2ListEntries\(serviceRows\)/);
assert.match(recordView, /data-record-view-procedure-settings/);
assert.match(recordView, /label: '⚙'/);
assert.match(recordView, /variant: 'x'/);
assert.match(recordView, /label: 'Длительность, мин'/);
assert.match(recordView, /label: 'Цена'/);
assert.match(recordView, /label: 'Скидка %'/);
assert.match(recordView, /label: 'Скидка ₽'/);
assert.match(recordView, /button\('Удалить процедуру'/);
assert.match(recordView, /data-record-procedure-delete/);
assert.match(recordView, /saveRecordProcedurePaymentAdjustment/);
assert.match(recordView, /deleteRecordProcedurePaymentAdjustment/);
assert.match(recordView, /checkRecordTime\(/);
assert.match(recordView, /updateRecord\(latest\.id, \{ procedures: nextProcedures, to: nextTo \}\)/);
assert.match(recordView, /payment\.hasPayments \? \{\} : \{/);
assert.doesNotMatch(recordView, /querySelector\('\.record-confirmation-view__procedures'\)/);
assert.doesNotMatch(recordView, /saveSettlementSnapshot/);

assert.match(paymentAdjustment, /saveSettlementSnapshot/);
assert.match(paymentAdjustment, /function assertProcedureMutable\(record\)[\s\S]*getRecordPaymentState\(record\)\.hasPayments/);
assert.match(paymentAdjustment, /export async function saveRecordProcedurePaymentAdjustment/);
assert.match(paymentAdjustment, /export async function deleteRecordProcedurePaymentAdjustment/);
assert.match(paymentAdjustment, /settlement\.items\s*\.filter\(/);

console.log('record procedure adjustment: ok');
