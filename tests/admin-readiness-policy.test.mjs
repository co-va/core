import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyReadinessGate, CABINET_READINESS_CAPABILITIES } from '../server/src/saas-access/readiness-policy.ts';

const cap = (key = 'loyalty.bonus.access', enabled = true) => ({
  key, valueType: 'BOOLEAN', enabled, limit: null, source: 'TENANT_OVERRIDE',
});
const row = (status, enforced = true, key = 'cabinet.loyalty.bonus') =>
  [{ key, status, enforced }];
const actors = [
  { name: 'DEMO professional', isTester: false, isOwnerBook: false, commercialMode: 'DEMO', testing: true },
  { name: 'DEMO tester', isTester: true, isOwnerBook: false, commercialMode: 'DEMO', testing: true },
  { name: 'LIVE regular', isTester: false, isOwnerBook: false, commercialMode: 'LIVE', testing: false },
  { name: 'LIVE tester', isTester: true, isOwnerBook: false, commercialMode: 'LIVE', testing: true },
  { name: 'LIVE platform owner', isTester: false, isOwnerBook: true, commercialMode: 'LIVE', testing: true },
];
for (const actor of actors) {
  for (const enforced of [false, true]) {
    for (const status of ['NOT_READY', 'TESTING', 'READY']) {
      const access = applyReadinessGate(cap(), row(status, enforced), actor);
      const expected = status === 'READY' || (status === 'TESTING' && actor.testing);
      assert.equal(access.enabled, expected, `${actor.name} / ${status} / enforced=${enforced}`);
      if (!expected) assert.equal(access.source, 'READINESS');
    }
  }
  const missing = applyReadinessGate(cap(), [], actor);
  assert.equal(missing.enabled, false, actor.name + ' must not see unregistered tool');
  assert.equal(applyReadinessGate(cap(), row('INVALID'), actor).enabled, false, actor.name + ' invalid status');
  assert.equal(applyReadinessGate(cap('loyalty.bonus.access', false), row('READY'), actor).enabled,
    false, 'readiness must not grant a previously revoked entitlement');
}
assert.equal(applyReadinessGate(cap('journal.day.access'), row('NOT_READY'), actors[0]).enabled,
  false, 'unregistered Journal readiness must be denied even if another tool has a status');
assert.equal(applyReadinessGate(cap('journal.day.access'), row('READY', true, 'cabinet.journal.day'), actors[0]).enabled,
  true, 'a separately approved Journal view must stay accessible');
for (const [readinessKey, capabilityKey] of [
  ['cabinet.profile.data', 'profile.access'],
  ['cabinet.finance.cash.wallets', 'finance.cash.access'],
  ['cabinet.finance.cash.loans', 'finance.special.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.self.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.raise.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.external.access'],
  ['cabinet.chat', 'chat.access'],
]) {
  assert.ok(CABINET_READINESS_CAPABILITIES[readinessKey]?.includes(capabilityKey),
    readinessKey + ' must cover ' + capabilityKey);
  assert.equal(applyReadinessGate(cap(capabilityKey), row('NOT_READY', false, readinessKey), actors[0]).enabled,
    false, readinessKey + ' must hide the entry even before legacy enforcement');
}
const service = readFileSync('server/src/saas-access/saas-access.service.ts', 'utf8');
assert.equal((service.match(/const readiness = await this.prisma.adminToolReadiness.findMany\\(\\);/g) || []).length,
  2, 'single capability and full account access must both read the same Tools readiness');
assert.doesNotMatch(service, /investmentProductReadiness|applyInvestmentProductReadinessGate/,
  'commercial-product status must not affect instrument readiness');
const readinessPolicy = readFileSync('server/src/saas-access/readiness-policy.ts', 'utf8');
assert.doesNotMatch(readinessPolicy, /InvestmentProductReadiness|CommercialProduct/,
  'only AdminToolReadiness may govern investment visibility');

const cashItems = [
  ['cabinet.finance.cash.wallets', 'finance.cash.access'],
  ['cabinet.finance.cash.loans', 'finance.special.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.self.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.raise.access'],
  ['cabinet.finance.cash.investments', 'finance.investment.external.access'],
];
for (const actor of actors) {
  for (const [readinessKey, capabilityKey] of cashItems) {
    for (const status of ['NOT_READY', 'TESTING', 'READY']) {
      const result = applyReadinessGate(cap(capabilityKey), row(status, true, readinessKey), actor);
      const expected = status === 'READY' || (status === 'TESTING' && actor.testing);
      assert.equal(result.enabled, expected, `${actor.name}: ${readinessKey}: ${status}`);
    }
  }
  const rows = [
    { key: 'cabinet.finance.cash.wallets', status: 'READY', enforced: true },
    { key: 'cabinet.finance.cash.loans', status: 'NOT_READY', enforced: true },
    { key: 'cabinet.finance.cash.investments', status: 'NOT_READY', enforced: true },
  ];
  assert.equal(applyReadinessGate(cap('finance.cash.access'), rows, actor).enabled, true,
    'wallets remain available independently from loans and investments');
  assert.equal(applyReadinessGate(cap('finance.special.access'), rows, actor).enabled, false,
    'loans stay hidden until explicitly ready');
  assert.equal(applyReadinessGate(cap('finance.investment.self.access'), rows, actor).enabled, false,
    'investments stay hidden until explicitly ready');
}
assert.equal(CABINET_READINESS_CAPABILITIES['cabinet.finance.cash'], undefined,
  'legacy parent Cash status is not a second gate');
assert.ok(!CABINET_READINESS_CAPABILITIES['cabinet.finance.dds']?.includes('finance.special.access'),
  'loans may not inherit DDS readiness');
const migration = readFileSync('server/prisma/migrations/20261108210000_cash_composition_readiness/migration.sql', 'utf8');
assert.match(migration, /'cabinet.finance.cash.wallets'[\s\S]*?FROM "AdminToolReadiness"/,
  'old Cash readiness must carry over to wallets');
assert.match(migration, /'cabinet.finance.cash.loans', 'NOT_READY'/);
assert.match(migration, /'cabinet.finance.cash.investments', 'NOT_READY'/);
console.log('Cash composition: wallets / loans / investments have independent readiness PASS');

const admin = readFileSync('admin/commercial-catalog.js', 'utf8');
assert.ok(!admin.includes('data-activate-readiness='), 'admin must save selection directly, no duplicate apply step');
console.log('Readiness: DEMO, LIVE user, LIVE tester, owner and NOT_READY matrix PASS');

// Workplace creation is core DEMO setup; readiness does not apply to it.
assert.equal(CABINET_READINESS_CAPABILITIES['cabinet.profile.workspaces'], undefined);
const workspace = cap('workplaces.access');
for (const actor of actors) {
  assert.equal(applyReadinessGate(workspace, row('NOT_READY', true, 'cabinet.profile.workspaces'), actor).enabled,
    true, actor.name + ': workplace access is governed by account grant, not readiness');
}
const demoService = readFileSync('server/src/saas-access/saas-access.service.ts', 'utf8');
assert.equal((demoService.match(/if \(capability.key === 'workplaces.access'\) \{/g) || []).length, 2,
  'both single-capability and bulk DEMO access must ignore false invitation overrides');
const workplaceGuard = readFileSync('server/src/profile/workplace-limit.guard.ts', 'utf8');
assert.match(workplaceGuard, /resolveCapability\(tenantId, 'workplaces.access'\)/,
  'server must reject creation when LIVE access was revoked');
assert.match(workplaceGuard, /resolveCapability\(tenantId, 'workplaces.max'\)/,
  'LIVE creation must still respect assigned limit');
console.log('DEMO unlimited workplaces and LIVE grant/limit PASS');

// The admin tool map must keep the ordinary readiness selector even when DEMO
// and LIVE workplace capacity are governed by a separate entitlement model.
const workplaceUi = readFileSync('admin/commercial-catalog.js', 'utf8');
const workplaceRegistry = readFileSync('server/src/saas-admin/tool-readiness.service.ts', 'utf8');
assert.match(workplaceUi, /readinessKey: 'cabinet\.profile\.workspaces'/);
assert.match(workplaceUi, /\$\{readinessSelect\(child\.readinessKey, byKey, 'admin-tool-child-status'\)\}/);
assert.doesNotMatch(workplaceUi, /DEMO — без лимита; LIVE — по разрешению/);
assert.match(workplaceRegistry, /'cabinet\.profile\.workspaces'/);
console.log('Admin workplace readiness selector restored independently from DEMO/LIVE quotas: PASS');

const registry = readFileSync('server/src/saas-admin/tool-readiness.service.ts', 'utf8');
const adminMap = readFileSync('admin/commercial-catalog.js', 'utf8');
const financeMap = adminMap.slice(adminMap.indexOf("id: 'finance'"), adminMap.indexOf("id: 'inventory'"));
assert.match(financeMap, /label: 'Касса', kind: 'e', nesting: 'composition'/);
for (const [key, title] of [
  ['cabinet.finance.cash.wallets', 'Кошельки'],
  ['cabinet.finance.cash.loans', 'Займы'],
  ['cabinet.finance.cash.investments', 'Инвестиции'],
]) {
  assert.ok(registry.includes(`'${key}'`), key + ' must be stored in Tools registry');
  assert.ok(financeMap.includes(`label: '${title}', kind: 'composition', readinessKey: '${key}'`),
    title + ' must have its own readiness selector inside Cash');
}
assert.ok(adminMap.includes('admin-tool-grandchildren'), 'Cash nested composition must be rendered');
console.log('Admin tool map: nested Cash E composition PASS');

