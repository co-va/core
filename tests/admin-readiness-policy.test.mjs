import assert from 'node:assert/strict';
import { applyReadinessGate } from '../server/src/saas-access/readiness-policy.ts';

const capability = (key = 'loyalty.bonus.access', enabled = true) => ({
  key, valueType: 'BOOLEAN', enabled, limit: null, source: 'TENANT_OVERRIDE',
});
const rows = (status, enforced = true) => [{ key: 'cabinet.loyalty.bonus', status, enforced }];
const actors = [
  { name: 'user', isTester: false, isOwnerBook: false },
  { name: 'tester', isTester: true, isOwnerBook: false },
  { name: 'admin-professional', isTester: false, isOwnerBook: true },
];
for (const actor of actors) {
  assert.equal(applyReadinessGate(capability(), rows('NOT_READY'), actor).enabled, false, actor.name + ' NOT_READY');
  assert.equal(applyReadinessGate(capability(), rows('TESTING'), actor).enabled,
    actor.isTester || actor.isOwnerBook, actor.name + ' TESTING');
  assert.equal(applyReadinessGate(capability(), rows('READY'), actor).enabled, true, actor.name + ' READY');
  assert.equal(applyReadinessGate(capability('loyalty.bonus.access', false), rows('READY'), actor).enabled,
    false, 'explicitly revoked permission is not restored');
  assert.equal(applyReadinessGate(capability(), rows('NOT_READY', false), actor).enabled,
    true, 'unapplied legacy status does not revoke existing access');
}
assert.equal(applyReadinessGate(capability('journal.day.access'), rows('NOT_READY'), actors[0]).enabled,
  true, 'unrelated status does not disable the journal');
console.log('Readiness user/tester/owner matrix PASS');

// In the Core-owned active Professional frontend, every unfinished subtool must obey the API resolver.
import { readFileSync } from 'node:fs';
const loyaltyNav = readFileSync('core/loyalty/index.js', 'utf8');
const inventoryNav = readFileSync('core/inventory/index.js', 'utf8');
const settingsNav = readFileSync('settings/settings.js', 'utf8');
const accessModule = readFileSync('core/access.js', 'utf8');
assert.match(loyaltyNav, /canUseBookCapability\(item\.capability\)/);
assert.match(inventoryNav, /canUseBookCapability\(item\.capability\)/);
assert.match(settingsNav, /data_transfer\.access/);
assert.match(settingsNav, /notifications\.access/);
assert.match(accessModule, /if \(!capability\) return false/);
