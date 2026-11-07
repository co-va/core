import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { excessWorkplaceIds } from '../server/src/saas-access/workplace-capacity.ts';

const spaces = Array.from({ length: 10 }, (_, i) => ({ id: 'space-' + (i + 1) }));
const one = excessWorkplaceIds(spaces, 1);
assert.deepEqual(one, spaces.slice(1).map((w) => w.id), 'LIVE 1: keep first, hide nine');
assert.equal(one.includes('space-1'), false, 'first workplace remains editable');
assert.deepEqual(excessWorkplaceIds(spaces, 3), spaces.slice(3).map((w) => w.id), 'LIVE 3: keep first three');
assert.deepEqual(excessWorkplaceIds(spaces, 10), [], 'LIVE 10: keep all');
assert.deepEqual(excessWorkplaceIds(spaces, null), [], 'unlimited DEMO or LIVE: hide none');
assert.deepEqual(excessWorkplaceIds(spaces, 0), spaces.map((w) => w.id), 'LIVE zero: no active spaces');
assert.deepEqual(excessWorkplaceIds([], 1), [], 'empty tenant: no writes');
assert.deepEqual(excessWorkplaceIds(spaces, -1), spaces.map((w) => w.id), 'invalid negative capacity fails closed');
assert.deepEqual(excessWorkplaceIds(spaces, 2.8), spaces.slice(2).map((w) => w.id), 'non-integer capacity is clamped');
const access = readFileSync('server/src/saas-access/saas-access.service.ts', 'utf8');
assert.match(access, /private async cleanupDemoOperationalData\(tenantId: string\) \{\s*await this.enforceLiveWorkplaceCapacity\(tenantId\)/,
  'both user and admin LIVE transitions must hide surplus before operational cleanup');
assert.match(access, /data: \{ deletedAt: new Date\(\) \}/,
  'overflow is soft-hidden rather than physically deleted');
assert.match(access, /where: \{ tenantId, deletedAt: null, id: \{ in: surplus \} \}/,
  'never change previously hidden spaces');
const admin = readFileSync('server/src/saas-admin/saas-admin.service.ts', 'utf8');
assert.match(admin, /if \(capability.key === 'workplaces.max'\) \{\s*await this.access.enforceLiveWorkplaceCapacity\(tenantId\)/,
  'administrator LIVE reductions must hide surplus');
const guard = readFileSync('server/src/profile/workplace-limit.guard.ts', 'utf8');
assert.match(guard, /workplace\.count\(\{ where: \{ tenantId, deletedAt: null \} \}\)/,
  'new LIVE additions count only active spaces, not hidden DEMO extras');
const profile = readFileSync('server/src/profile/profile.service.ts', 'utf8');
assert.match(profile, /workplaces: \{ where: \{ deletedAt: null \}/,
  'read-side excludes hidden spaces while retaining source rows');
console.log('DEMO to LIVE workplace capacity, soft-hide, future additions: PASS');
