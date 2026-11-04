import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const migration = read('../server/prisma/migrations/20261009151000_personal_account_state/migration.sql');
const stateSource = read('../server/src/loyalty/personal-account-state.ts');
const financeSource = read('../server/src/finance/personal-account-finance.service.ts');
const settlementSource = read('../server/src/finance/payment-settlement.service.ts');
const serviceSource = read('../server/src/loyalty/personal-account.service.ts');
const accountControllerSource = read('../server/src/online-booking/account-personal-account.controller.ts');
const cardSource = read('../core/loyalty/personal-account/index.js');
const paymentSource = read('../journal/record-payment.js');

// Money held for a person and unpaid debt are separate persisted values.
assert.match(migration, /CREATE TABLE IF NOT EXISTS "LoyaltyPersonalAccount"/);
assert.match(migration, /CHECK \("balance" >= 0\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS "LoyaltyPersonalAccountDebt"/);
assert.match(migration, /CHECK \("originalAmount" >= 0 AND "outstandingAmount" >= 0\)/);
assert.match(migration, /"spendLimitPercent" DECIMAL\(5,2\) NOT NULL DEFAULT 100/);
assert.match(migration, /"visibleToEndUser" BOOLEAN NOT NULL DEFAULT true/);

// The working list contains only accounts with a movement or debt; a person snapshot exists independently.
assert.match(stateSource, /export async function listPersonalAccountsWithActivity/);
assert.match(stateSource, /EXISTS \([\s\S]*LoyaltyPersonalAccountMovement/);
assert.match(stateSource, /EXISTS \([\s\S]*LoyaltyPersonalAccountDebt/);
assert.match(stateSource, /export async function personalAccountSnapshot/);

// Spend is capped both by held money and by the per-person percentage, without allowing a negative balance.
assert.match(stateSource, /На Личном счёте недостаточно средств/);
assert.match(stateSource, /spendLimitPercent/);
assert.match(stateSource, /personalAccountSpendAvailability/);
assert.match(settlementSource, /const allowed = Math\.min\(availability\.balance, remainingLimit, due\)/);
assert.match(settlementSource, /personalAccountAmount > allowed/);

// An unpaid remainder becomes a separate debt only when the payment is finalized.
assert.match(settlementSource, /remainingDue = Math\.max\(0, money\(due - serviceAmount\)\)/);
assert.match(settlementSource, /input\.finalizeDebt === true/);
assert.match(settlementSource, /syncPersonalAccountDebt/);
assert.doesNotMatch(financeSource, /fund[\s\S]{0,1200}reducePersonalAccountDebt/);

// Top-up, withdrawal and settlement of one concrete debt are distinct financial facts.
assert.match(financeSource, /async fund\(/);
assert.match(financeSource, /PERSONAL_ACCOUNT_LIABILITY_IN/);
assert.match(financeSource, /async withdraw\(/);
assert.match(financeSource, /PERSONAL_ACCOUNT_LIABILITY_OUT/);
assert.match(financeSource, /async settleDebt\(/);
assert.match(financeSource, /personalAccountDebtById/);
assert.match(financeSource, /reducePersonalAccountDebt/);
assert.match(financeSource, /DEBT_RECEIPT/);

// Mixed payment is owned by one canonical settlement path and the Journal passes the unpaid remainder as debt.
assert.match(settlementSource, /requestedDepositAllocations/);
assert.match(settlementSource, /personalAccountAmount/);
assert.match(settlementSource, /cashServiceAmount/);
assert.match(paymentSource, /personalAccountAmount:\s*allocationState\.personalAccountAmount/);
assert.match(paymentSource, /finalizeDebt:\s*allocationState\.remaining > 0\.009/);

// Existing Personal Account card is server-backed; professional controls limit and end-user visibility there.
assert.match(cardSource, /loadPersonalAccount/);
assert.match(cardSource, /savePersonalAccountSettings/);
assert.match(cardSource, /spendLimitPercent/);
assert.match(cardSource, /visibleToEndUser/);
assert.doesNotMatch(cardSource, /mockBalances|mockHistory/);

// End-user projection is explicitly restricted to public account fields.
assert.match(serviceSource, /async endUserView/);
assert.match(serviceSource, /if \(!snapshot\.visibleToEndUser\) return null/);
assert.match(serviceSource, /balance: snapshot\.balance/);
assert.match(serviceSource, /debtTotal: snapshot\.debtTotal/);
assert.match(serviceSource, /spendLimitPercent: snapshot\.spendLimitPercent/);
const endUserView = serviceSource.slice(serviceSource.indexOf('async endUserView'));
assert.doesNotMatch(endUserView, /memberKeys|walletId|walletName|providerPaymentId/);
assert.match(accountControllerSource, /personalAccounts\.endUserView/);


console.log('Personal Account backend and Finance tests passed');
