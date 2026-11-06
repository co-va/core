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
  true, 'unrelated readiness cannot hide an independent approved tool');
for (const [readinessKey, capabilityKey] of [
  ['cabinet.profile.data', 'profile.access'],
  ['cabinet.finance.cash', 'finance.investment.self.access'],
  ['cabinet.finance.cash', 'finance.investment.raise.access'],
  ['cabinet.finance.cash', 'finance.investment.external.access'],
  ['cabinet.chat', 'chat.access'],
]) {
  assert.ok(CABINET_READINESS_CAPABILITIES[readinessKey]?.includes(capabilityKey),
    readinessKey + ' must cover ' + capabilityKey);
  assert.equal(applyReadinessGate(cap(capabilityKey), row('NOT_READY', false, readinessKey), actors[0]).enabled,
    false, readinessKey + ' must hide the entry even before legacy enforcement');
}
const service = readFileSync('server/src/saas-access/saas-access.service.ts', 'utf8');
assert.equal((service.match(/const readiness = await this.prisma.adminToolReadiness.findMany\(\);/g) || []).length,
  2, 'single-capability and entire tenant access must both inspect every readiness row');
const admin = readFileSync('admin/commercial-catalog.js', 'utf8');
assert.ok(!admin.includes('data-activate-readiness='), 'admin must save selection directly, no duplicate apply step');
console.log('Readiness: DEMO, LIVE user, LIVE tester, owner and NOT_READY matrix PASS');
