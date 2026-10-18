import { readFileSync } from 'node:fs';

const errors = [];

const financeIndex = readFileSync('core/finance/index.js', 'utf8');
if (!financeIndex.includes('recordSettlementPriceCondition') || !financeIndex.includes('recordSettlementPricePercent')) {
  errors.push('core/finance/index.js must expose the canonical price-condition resolver');
}

const financeRules = readFileSync('core/finance/rules.js', 'utf8');
if (!financeRules.includes('correctionForItem') || !financeRules.includes('pricePercentMoney')) {
  errors.push('core/finance/rules.js must keep manual price correction and automatic price percent as separate stages');
}

const priceCondition = readFileSync('core/loyalty/price-condition.js', 'utf8');
if (!priceCondition.includes('resolvePersonPriceCondition') || !priceCondition.includes('resolvePriceConditionSources')) {
  errors.push('core/loyalty/price-condition.js must remain the single browser price-condition resolver');
}

const settlement = readFileSync('core/finance/settlement.js', 'utf8');
if (!settlement.includes('resolvePersonPriceCondition') || !settlement.includes('recordSettlementPriceCondition')) {
  errors.push('core/finance/settlement.js must resolve automatic percent through the shared price-condition resolver');
}

const recordServer = readFileSync('server/src/record/record.service.ts', 'utf8');
if (!recordServer.includes('resolvePersonPricePercent') || !recordServer.includes('this.pricePercent')) {
  errors.push('server/src/record/record.service.ts must resolve automatic percent through the canonical server resolver');
}

const serverPriceCondition = readFileSync('server/src/loyalty/price-condition.ts', 'utf8');
if (
  !serverPriceCondition.includes('resolvePersonPricePercent')
  || !serverPriceCondition.includes('resolvePersonPriceCondition')
  || !serverPriceCondition.includes('condition.conflict')
) {
  errors.push('server/src/loyalty/price-condition.ts must own server price-percent resolution and conflict detection');
}

const paymentUi = readFileSync('ui/payment/index.js', 'utf8');
if (!paymentUi.includes("field({ label: 'Цена'") || !paymentUi.includes("data: 'data-payment-price'")) {
  errors.push('payment UI must expose the factual price field for an existing Record item');
}
if (!paymentUi.includes("label: 'Скидка %'") || !paymentUi.includes("label: 'Скидка ₽'")) {
  errors.push('payment UI must expose manual discount correction explicitly');
}
if (!paymentUi.includes("label: 'Условие'") || !paymentUi.includes('disabled: true')) {
  errors.push('automatic price condition must remain read-only in payment UI');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('price condition architecture check: OK');
