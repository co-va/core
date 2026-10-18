import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateSettlement } from '../core/finance/index.js';
import { resolvePersonPriceCondition } from '../core/loyalty/price-condition.js';

const corrected = calculateSettlement([
  {
    sourceType: 'procedure',
    sourceId: 'procedure-1',
    name: 'Стрижка',
    price: 5000,
    correctionMode: 'percent',
    correctionPercent: 10,
  },
], { pricePercent: 20 });
assert.equal(corrected.serviceTotal, 5000);
assert.equal(corrected.correctionTotal, 0);
assert.equal(corrected.pricePercentTotal, 1000);
assert.equal(corrected.planTotal, 4000);

const personalOnly = resolvePersonPriceCondition({ discountPercent: 20 }, []);
assert.equal(personalOnly.conflict, false);
assert.equal(personalOnly.percent, 20);
assert.equal(personalOnly.source?.type, 'personal');

const programOnly = resolvePersonPriceCondition({ discountPercent: 0 }, [
  { type: 'deposit', id: 'deposit-1', name: 'Депозит', percent: 20 },
]);
assert.equal(programOnly.conflict, false);
assert.equal(programOnly.percent, 20);

const conflict = resolvePersonPriceCondition({ discountPercent: 20 }, [
  { type: 'deposit', id: 'deposit-1', name: 'Депозит', percent: 20 },
]);
assert.equal(conflict.conflict, true);
assert.equal(conflict.percent, 0);
assert.equal(conflict.source, null);
assert.equal(conflict.sources.length, 2);

const depositServiceSource = readFileSync(new URL('../server/src/loyalty/deposit.service.ts', import.meta.url), 'utf8');
const depositStateSource = readFileSync(new URL('../server/src/loyalty/deposit-state.ts', import.meta.url), 'utf8');
const priceResolverSource = readFileSync(new URL('../server/src/loyalty/price-condition.ts', import.meta.url), 'utf8');
const financeServiceSource = readFileSync(new URL('../server/src/finance/finance.service.ts', import.meta.url), 'utf8');
const schemaSource = readFileSync(new URL('../server/prisma/schema.prisma', import.meta.url), 'utf8');
const ownershipMigrationSource = readFileSync(new URL('../server/prisma/migrations/20261009121500_make_deposit_state_server_owned/migration.sql', import.meta.url), 'utf8');

// Deposit program and instance are current Prisma/server entities.
assert.match(schemaSource, /model LoyaltyDepositProgram/);
assert.match(schemaSource, /model LoyaltyDepositInstance/);
assert.match(schemaSource, /principalBalance\s+Decimal/);
assert.match(schemaSource, /benefitBalance\s+Decimal/);

// Runtime no longer reconstructs Deposit state from FinanceOperation through DB trigger/replay.
assert.match(ownershipMigrationSource, /DROP TRIGGER IF EXISTS "LoyaltyDepositFinanceSync"/);
assert.match(ownershipMigrationSource, /DROP FUNCTION IF EXISTS loyalty_deposit_recalculate/);
assert.doesNotMatch(depositServiceSource, /\$queryRaw|\$executeRaw|loyalty_deposit_recalculate/);
assert.match(depositServiceSource, /loyaltyDepositInstance\.findUnique/);

// Refund is principal-only and closes the real-money obligation through Deposit state owner.
assert.match(depositServiceSource, /refundableAmount:\s*row\.status === 'active' \? principalBalance : 0/);
assert.match(depositServiceSource, /amount:\s*current\.refundableAmount/);
assert.doesNotMatch(depositServiceSource, /refundableAmount:\s*row\.status === 'active' \? balance/);
assert.match(depositStateSource, /closeDepositForRefund/);
assert.match(depositStateSource, /benefitBalance:\s*0/);

// Upfront benefit is created once; spending preserves exact principal/benefit components.
assert.match(depositStateSource, /mode === 'accrual'/);
assert.match(depositStateSource, /principalAmount = Math\.min\(principal, request\.amount\)/);
assert.match(depositStateSource, /benefitAmount = Math\.min\(benefit, depositMoney\(request\.amount - principalAmount\)\)/);
assert.match(depositStateSource, /principalAmount:\s*depositMoney\(principalAmount\)/);
assert.match(depositStateSource, /benefitAmount:\s*depositMoney\(benefitAmount\)/);

// Service discount remains a price right and is not forced closed when money reaches zero.
assert.match(depositStateSource, /nextBalance <= 0\.009 && mode !== 'discount' \? 'closed' : 'active'/);

// The server owns the final program percentage; personal discount is only a payment suggestion.
assert.match(priceResolverSource, /resolvePersonPriceCondition/);
assert.match(priceResolverSource, /resolvePersonPriceCondition\(null, \[\.\.\.programSources, \.\.\.extraSources\]\)/);
assert.match(financeServiceSource, /resolvePersonPricePercent\(tx, tenantId, input\.person, occurredAt\)/);
assert.match(financeServiceSource, /canonicalSettlementInput\(requestedSettlement, condition\.percent\)/);
assert.match(financeServiceSource, /calculateCanonicalSettlement\(items, \{ pricePercent \}\)/);
assert.match(financeServiceSource, /consumeDepositAllocations\(tx, tenantId/);
assert.match(financeServiceSource, /restoreDepositAllocations\(tx, tenantId/);

console.log('deposit business contract tests: OK');
