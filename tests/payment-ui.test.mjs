import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { paymentForm, paymentMethods } from '../ui/payment/index.js';
import { paymentAllocationState } from '../ui/payment/methods.js';
import { calculateSettlement } from '../core/finance/index.js';
import { projectRecordLifecycle, RECORD_EVENT_TYPES } from '../core/record/index.js';
import { shortDate } from '../ui/utils/date-time.js';
import { zonedDateTimeParts, zonedDateTimeToDate } from '../core/time/index.js';

const html = paymentForm({
  workplace: 'Рабочее пространство',
  date: '11.09.26',
  time: '12:00 - 13:00',
  person: { uei: '0278', name: 'Наталья Гусева' },
  procedures: [
    { id: 'p1', name: 'Стрижка - Женская', cost: 7000, pricePercent: 0 },
    { id: 'p2', name: 'Очень длинное название процедуры без сокращения', cost: 2500, pricePercent: 10, pricePercentMoney: 250 },
  ],
  total: 9250,
});

assert.match(html, /data-payment-sections/);
assert.match(html, /data-v2-z-body-sections/);
assert.match(html, /payment-summary-mini-card/);
assert.match(html, /data-payment-price/);
assert.doesNotMatch(html, /data-payment-price-condition/);
assert.match(html, /data-payment-correction-percent/);
assert.match(html, /data-payment-correction-money/);
assert.equal((html.match(/column-layout column-layout--3/g) || []).length, 2);
assert.match(html, /data-payment-program-discount="true"/);
assert.match(html, /value="10"[^>]*data-payment-correction-percent/);
assert.match(html, /value="250"[^>]*data-payment-correction-money/);
assert.match(html, /data-payment-action/);
assert.doesNotMatch(html, /data-payment-save|data-payment-submit/);
assert.equal((html.match(/<button\b[^>]*\bdata-payment-action(?:\s|>)/g) || []).length, 1);
assert.equal((html.match(/data-payment-procedure="/g) || []).length, 2);

const editableDiscountHtml = paymentForm({
  workplace: 'Тест', date: '11.09.26', time: '12:00 - 13:00',
  person: { uei: 'U1', name: 'Тест' },
  procedures: [{ id: 'p1', name: 'Процедура', cost: 10000, pricePercent: 0, correctionMode: 'percent', correctionPercent: 20, correctionMoney: 2000 }],
  total: 8000,
});
assert.match(editableDiscountHtml, /data-payment-program-discount="false"/);
assert.match(editableDiscountHtml, /value="20"[^>]*data-payment-correction-percent/);
assert.match(editableDiscountHtml, /value="2000"[^>]*data-payment-correction-money/);

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
assert.equal(correctedThenAutomatic.correctionTotal, 0);
assert.equal(correctedThenAutomatic.pricePercentTotal, 1000);
assert.equal(correctedThenAutomatic.planTotal, 4000);

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

// A zero-due service still accepts real money as pure Tips.
const gratuityOnly = paymentAllocationState([
  { walletId: 'cash', walletName: 'Наличные', amount: 5000 },
], 0, [], null);
assert.equal(gratuityOnly.applied, 0);
assert.equal(gratuityOnly.remaining, 0);
assert.equal(gratuityOnly.tips, 5000);
assert.equal(gratuityOnly.received, 5000);
assert.equal(gratuityOnly.valid, true);

// With no money there is no Finance payment; the Record completion action owns the fact.
const zeroNoMoney = paymentAllocationState([], 0, [], null);
assert.equal(zeroNoMoney.received, 0);
assert.equal(zeroNoMoney.tips, 0);
assert.equal(zeroNoMoney.valid, false);
const completedLifecycle = projectRecordLifecycle(
  { createdAt: '2026-09-11T10:00:00.000Z' },
  [{ type: RECORD_EVENT_TYPES.COMPLETED, at: '2026-09-11T13:00:00.000Z' }],
);
assert.equal(completedLifecycle.completed, true);
assert.equal(completedLifecycle.completedAt, '2026-09-11T13:00:00.000Z');
assert.equal(completedLifecycle.attendance, 'arrived');

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
const modalCss = readFileSync(new URL('../ui/modals/modal.css', import.meta.url), 'utf8');
const buttonCss = readFileSync(new URL('../ui/buttons/buttons.css', import.meta.url), 'utf8');
const recordCss = readFileSync(new URL('../ui/record/record.css', import.meta.url), 'utf8');
const pageSource = readFileSync(new URL('../ui/page/page.js', import.meta.url), 'utf8');
const recordCreationSource = readFileSync(new URL('../ui/record/creation-flow.js', import.meta.url), 'utf8');
const financeServiceSource = readFileSync(new URL('../core/finance/service.js', import.meta.url), 'utf8');
const financeServerSource = readFileSync(new URL('../server/src/finance/finance.service.ts', import.meta.url), 'utf8');
const paymentMechanismSource = readFileSync(new URL('../core/payment/record-payment.js', import.meta.url), 'utf8');
const recordEventsSource = readFileSync(new URL('../core/record/events.js', import.meta.url), 'utf8');
const recordServiceSource = readFileSync(new URL('../core/record/service.js', import.meta.url), 'utf8');
const journalDaySource = readFileSync(new URL('../journal/день.js', import.meta.url), 'utf8');
const recordViewSource = readFileSync(new URL('../core/records/view.js', import.meta.url), 'utf8');

assert.match(paymentSource, /const percentOptions = \[/);
assert.match(paymentSource, /data-payment-correction-mode/);
assert.match(paymentSource, /data-payment-price-percent/);
assert.match(paymentSource, /data-payment-program-discount/);
assert.match(paymentSource, /function syncProgramDiscountLock/);
assert.match(paymentSource, /trigger\.disabled = locked/);
assert.match(paymentSource, /moneyInput\.disabled = locked/);
assert.match(paymentSource, /miniCard/);
assert.match(paymentSource, /v2ZBodySections/);
assert.match(paymentSource, /columnLayout\(\[/);
assert.doesNotMatch(paymentSource, /payment-edit-grid/);
assert.doesNotMatch(paymentSource, /data-payment-price-condition/);
assert.match(paymentSource, /dirty \? 'Сохранить' : 'Оплатить'/);
assert.match(paymentSource, /const zeroDueService =/);
assert.match(methodsSource, /const tips = Math\.max\(0, cashReceived - serviceFromCash\)/);
assert.match(methodsSource, /readOnlyReceipt/);
assert.doesNotMatch(paymentCss, /\.payment-edit-grid/);
assert.doesNotMatch(paymentCss, /record-payment-q \[data-v2-q-body\]/);
assert.doesNotMatch(paymentCss, /data-payment-ui\]>\.modal-actions\{position:absolute/);
assert.doesNotMatch(recordCss, /\.record-view-actions\{position:absolute/);
assert.doesNotMatch(recordCss, /\.record-creation-flow__actions\{display:grid/);
assert.match(pageSource, /class="profile-actions modal-actions/);
assert.match(modalCss, /\[data-v2-z-body\]/);
assert.match(modalCss, /\[data-v2-q-body\]/);
assert.match(modalCss, /\.modal-actions\{position:absolute/);
assert.doesNotMatch(modalCss, /\.record-view-actions/);
assert.doesNotMatch(modalCss, /\.record-creation-flow__actions/);
assert.match(modalCss, /left:36px;right:36px/);
assert.match(modalCss, /bottom:calc\(24px \+ env\(safe-area-inset-bottom\)\)/);
assert.doesNotMatch(modalCss, /\.modal-actions[^}]*height\s*:/);
assert.match(buttonCss, /\.ui-button\{[^}]*width:100%[^}]*min-height:48px/);
assert.doesNotMatch(recordViewSource, /class="record-view-actions"/);
assert.doesNotMatch(recordCreationSource, /record-creation-flow__actions/);
assert.match(recordCreationSource, /actionBlock\(`/);

for (const command of ['cancelFinanceOperation', 'correctFinanceOperation', 'hardDeleteFinanceOperation', 'recordRefundExpense', 'recordPaymentIncome']) {
  assert.match(financeServiceSource, new RegExp(`export async function ${command}`));
}

assert.doesNotMatch(journalDaySource, /openRecordPaymentEntry|openRecordPayment/);
assert.match(recordViewSource, /import \{ openRecordPayment \} from '\.\.\/payment\/record-payment\.js'/);
assert.match(recordViewSource, /professional: Object\.freeze\(\{[\s\S]*sale: true,[\s\S]*payment: true/);
assert.match(recordViewSource, /account: Object\.freeze\(\{[\s\S]*sale: false,[\s\S]*payment: false/);
assert.match(recordViewSource, /data-record-view-payment/);
assert.match(recordViewSource, /К оплате: \$\{formatMoney\(payment\.remaining\)\}/);
assert.match(recordViewSource, /capabilities\.sale && !payment\.hasPayments \? button\('Продажа'/);
assert.match(recordViewSource, /button\('Оплачено', \{ disabled: true \}\)/);
assert.match(recordViewSource, /openRecordPayment\(syncCurrent\(\),\s*\{/);
assert.match(recordViewSource, /onCompleted:\s*\(\)\s*=>\s*\{[\s\S]*?syncCurrent\(\);[\s\S]*?render\(\);/);
assert.match(recordViewSource, /professional: Object\.freeze\(\{[\s\S]*settings: true/);
assert.match(recordViewSource, /account: Object\.freeze\(\{[\s\S]*settings: false/);
assert.match(recordViewSource, /settings: capabilities\.settings/);
assert.match(recordViewSource, /bindRecordSettings\(layer, openActions\)/);
assert.doesNotMatch(recordViewSource, /data-record-view-actions/);
assert.match(recordViewSource, /querySelector\('\.record-confirmation-view__card'\)/);
assert.match(recordViewSource, /openRecordZReport\(syncCurrent\(\)\)/);
assert.doesNotMatch(recordViewSource, /querySelector\('\.record-confirmation-view__procedures'\)/);
assert.doesNotMatch(recordViewSource, /paymentForm|paymentMethods|recordPaymentIncome/);

// Record payment now goes directly to one X with payment sources. Price/discount editing stays with procedure settings.
assert.match(paymentMechanismSource, /export function openRecordPayment\(record,/);
assert.match(paymentMechanismSource, /data-record-payment-entry-host/);
assert.match(paymentMechanismSource, /variant: 'x'/);
assert.match(paymentMechanismSource, /paymentMethods\(/);
assert.match(paymentMechanismSource, /recordPaymentIncome\(/);
assert.doesNotMatch(paymentMechanismSource, /paymentForm\(/);
assert.doesNotMatch(paymentMechanismSource, /name="recordPaymentDate"/);
assert.match(paymentMechanismSource, /function recordServiceOccurredAt\(record\)/);
assert.match(paymentMechanismSource, /occurredAt: recordServiceOccurredAt|const occurredAt = recordServiceOccurredAt/);
assert.match(paymentMechanismSource, /if \(state\.fullyPaid \|\| paymentInFlightRecords\.has\(recordId\)\)/);
assert.doesNotMatch(paymentMechanismSource, /if \(state\.hasPayments \|\| paymentInFlightRecords\.has\(recordId\)\)/);
assert.match(paymentMechanismSource, /const gratuityOnly = total <= 0\.009/);
assert.match(paymentMechanismSource, /gratuityOnly\s*\?\s*\[\[\], null\]/);
assert.match(paymentMechanismSource, /button\(gratuityOnly \? 'Завершить' : 'Оплатить'/);
assert.match(paymentMechanismSource, /const label = gratuityOnly && !hasMoney \? 'Завершить' : 'Оплатить'/);
assert.match(paymentMechanismSource, /await persistRecordCompletion\(latest\)/);
assert.match(paymentMechanismSource, /serviceAmount: allocationState\.applied/);
assert.match(paymentMechanismSource, /tips: allocationState\.tips/);
assert.doesNotMatch(paymentMechanismSource, /data-record-payment-allocation-primary/);
assert.doesNotMatch(paymentMechanismSource, /openRecordPaymentZReport|payment-summary-mini-card-wrap/);

// Finance keeps two dates: occurredAt is the economic/service date, recordedAt is the actual entry timestamp.
assert.match(financeServerSource, /occurredAt: row\.occurredAt\.toISOString\(\), recordedAt: row\.createdAt\.toISOString\(\)/);
assert.match(recordEventsSource, /COMPLETED: 'completed'/);
assert.match(recordServiceSource, /export function completeRecord/);
assert.equal(existsSync(new URL('../journal/journal-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-view.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../journal/record-payment.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../core/payment/record-payment.js', import.meta.url)), true);

console.log('payment UI tests: OK');
