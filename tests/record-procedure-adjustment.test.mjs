import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const recordView = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');
const recordsFlow = readFileSync(new URL('../core/records/records.js', import.meta.url), 'utf8');
const recordRuntime = readFileSync(new URL('../ui/record/runtime.js', import.meta.url), 'utf8');
const paymentAdjustment = readFileSync(new URL('../core/payment/procedure-adjustment.js', import.meta.url), 'utf8');

assert.match(recordRuntime, /v2ListEntry\(\{/);
assert.match(recordRuntime, /v2ListEntries\(serviceRows\)/);

// View only renders the list/action and delegates the gear to the existing Records flow owner.
assert.match(recordView, /data-record-view-procedure-settings/);
assert.match(recordView, /label: '⚙'/);
assert.match(recordView, /import \{ openProcedureAdjustment, openRecords \} from '\.\/records\.js'/);
assert.match(recordView, /openProcedureAdjustment\(syncCurrent\(\), procedure\.id/);
assert.match(recordView, /payment\.hasPayments \? \{\} : \{/);
assert.doesNotMatch(recordView, /data-record-procedure-adjustment-save|data-record-procedure-delete/);
assert.doesNotMatch(recordView, /saveRecordProcedurePaymentAdjustment|deleteRecordProcedurePaymentAdjustment/);
assert.doesNotMatch(recordView, /checkRecordTime\(|checkTimeAvailability\(/);
assert.doesNotMatch(recordView, /updateRecord/);
assert.doesNotMatch(recordView, /querySelector\('\.record-confirmation-view__procedures'\)/);
assert.doesNotMatch(recordView, /saveSettlementSnapshot/);

// Existing Records flow owns the procedure-correction X and the Record mutation.
assert.match(recordsFlow, /export function openProcedureAdjustment/);
assert.match(recordsFlow, /variant: 'x'/);
assert.match(recordsFlow, /label: 'Длительность, мин'/);
assert.match(recordsFlow, /label: 'Цена'/);
assert.match(recordsFlow, /label: 'Скидка %'/);
assert.match(recordsFlow, /label: 'Скидка ₽'/);
assert.match(recordsFlow, /button\('Удалить процедуру'/);
assert.match(recordsFlow, /data-record-procedure-delete/);
assert.match(recordsFlow, /checkTimeAvailability\(/);
assert.match(recordsFlow, /updateRecord\(latest\.id, \{ procedures: nextProcedures, to: nextTo \}\)/);
assert.match(recordsFlow, /saveRecordProcedurePaymentAdjustment/);
assert.match(recordsFlow, /deleteRecordProcedurePaymentAdjustment/);

// Finance still owns settlement mutations and blocks them after the first payment fact.
assert.match(paymentAdjustment, /saveSettlementSnapshot/);
assert.match(paymentAdjustment, /function assertProcedureMutable\(record\)[\s\S]*getRecordPaymentState\(record\)\.hasPayments/);
assert.match(paymentAdjustment, /export async function saveRecordProcedurePaymentAdjustment/);
assert.match(paymentAdjustment, /export async function deleteRecordProcedurePaymentAdjustment/);
assert.match(paymentAdjustment, /settlement\.items\s*\.filter\(/);

console.log('record procedure adjustment: ok');
