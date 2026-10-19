import { readFileSync } from 'node:fs';

const errors = [];

const financeIndex = readFileSync('core/finance/index.js', 'utf8');
if (!financeIndex.includes('recordSettlementPriceCondition') || !financeIndex.includes('recordSettlementPricePercent')) {
  errors.push('core/finance/index.js must expose the canonical price-condition resolver');
}

const financeRules = readFileSync('core/finance/rules.js', 'utf8');
if (!financeRules.includes('correctionForItem') || !financeRules.includes('pricePercentMoney')) {
  errors.push('core/finance/rules.js must keep factual discount percent/money in canonical Settlement');
}
if (!financeRules.includes('automaticPercent > 0') || !financeRules.includes("{ mode: 'none', percent: 0, money: 0 }")) {
  errors.push('program discount must have precedence over editable personal/manual discount');
}

const priceCondition = readFileSync('core/loyalty/price-condition.js', 'utf8');
if (!priceCondition.includes('personalPricePercentSource') || !priceCondition.includes('resolvePersonPriceCondition')) {
  errors.push('core/loyalty/price-condition.js must remain the shared price-condition resolver');
}

const settlement = readFileSync('core/finance/settlement.js', 'utf8');
if (!settlement.includes('resolvePersonPriceCondition') || !settlement.includes('recordSettlementPriceCondition')) {
  errors.push('core/finance/settlement.js must resolve the selected program percent through the shared price-condition resolver');
}
if (
  !settlement.includes('record?.loyaltyProgram')
  || !settlement.includes('resolvePersonPriceCondition(null, [{')
  || settlement.includes('getPersonDepositPriceConditions')
) {
  errors.push('record pricing must use only the explicitly selected program and must not auto-apply an assigned deposit');
}
if (!settlement.includes('personalPricePercentSource') || !settlement.includes("correctionMode: 'percent'")) {
  errors.push('personal discount must seed the editable payment discount instead of becoming an automatic program condition');
}

const recordServer = readFileSync('server/src/record/record.service.ts', 'utf8');
if (
  !recordServer.includes('resolveSelectedRecordProgramPricePercent')
  || !recordServer.includes('this.pricePercent')
  || !recordServer.includes('loyaltyProgram')
  || !recordServer.includes('programChanged')
) {
  errors.push('server record owner must persist the selected program and reprice Settlement only from that explicit selection');
}

const serverPriceCondition = readFileSync('server/src/loyalty/price-condition.ts', 'utf8');
if (
  !serverPriceCondition.includes('resolvePersonPricePercent')
  || !serverPriceCondition.includes('resolveSelectedRecordProgramPricePercent')
  || !serverPriceCondition.includes('selectedDepositPriceSource')
  || !serverPriceCondition.includes('resolvePersonPriceCondition(null, source ? [source] : [])')
  || !serverPriceCondition.includes('condition.conflict')
) {
  errors.push('server price-condition owner must preserve shared conflict resolution and validate the concrete selected deposit for Record');
}

const paymentUi = readFileSync('ui/payment/index.js', 'utf8');
if (!paymentUi.includes("field({ label: 'Цена'") || !paymentUi.includes("data: 'data-payment-price'")) {
  errors.push('payment UI must expose the factual price field for an existing Record item');
}
if (!paymentUi.includes("label: 'Скидка %'") || !paymentUi.includes("label: 'Скидка ₽'")) {
  errors.push('payment UI must expose discount as percent and ruble equivalent');
}
if (!paymentUi.includes('columnLayout([') || !paymentUi.includes("{ columns: 3, ariaLabel: 'Цена и скидка' }")) {
  errors.push('payment item must use the canonical three-column layout: Цена | Скидка % | Скидка ₽');
}
if (paymentUi.includes("label: 'Условие'") || paymentUi.includes('data-payment-price-condition')) {
  errors.push('payment UI must never create a fourth condition field; the discount fields are the condition');
}
if (!paymentUi.includes('data-payment-program-discount') || !paymentUi.includes('syncProgramDiscountLock')) {
  errors.push('program discount must render in the same discount fields and own their edit lock');
}
if (!paymentUi.includes('trigger.disabled = locked') || !paymentUi.includes('moneyInput.disabled = locked')) {
  errors.push('program discount must lock both percent and ruble-equivalent editing while leaving price editable');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('price condition architecture check: OK');
