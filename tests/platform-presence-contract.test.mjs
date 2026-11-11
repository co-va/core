import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const policy = read('server/src/auth/presence-policy.ts');
const src = policy.slice(policy.indexOf('export function isAccountOnline('));
const expression = src.replace('export function isAccountOnline(lastSeenAt: Date | string | null | undefined, now = Date.now()): boolean {',
  'function isAccountOnline(lastSeenAt, now = Date.now()) {');
const isAccountOnline = runInNewContext(expression + '\nisAccountOnline;', { Date, Number, PRESENCE_ONLINE_MS: 120_000 });
const now = Date.parse('2026-11-11T14:00:00Z');
assert.equal(isAccountOnline(null, now), false);
assert.equal(isAccountOnline(new Date(now - 45_000), now), true);
assert.equal(isAccountOnline(new Date(now - 119_999), now), true);
assert.equal(isAccountOnline(new Date(now - 120_000), now), false);
assert.equal(isAccountOnline(new Date(now + 600_000), now), false);
assert.equal(isAccountOnline('invalid', now), false);
const splitSource = policy.slice(policy.indexOf('export function creditPresenceDays('));
const creditBody = splitSource.replace('export function creditPresenceDays(lastSeenAt: Date | string | null | undefined, seenAt: Date): Array<{ day: Date; milliseconds: number }> {',
  'function creditPresenceDays(lastSeenAt, seenAt) {')
  .replace('const slices: Array<{ day: Date; milliseconds: number }> = [];', 'const slices = [];')
  .replace('lastSeenAt!', 'lastSeenAt');
const creditPresenceDays = runInNewContext(creditBody + '\\ncreditPresenceDays;', { Date, Math, isAccountOnline });
assert.equal(creditPresenceDays(null, new Date(now)).length, 0, 'First beat cannot invent elapsed time');
assert.equal(creditPresenceDays(new Date(now - 121_000), new Date(now)).length, 0, 'Closed tab/outage never counts unobserved time');
const measured = creditPresenceDays(new Date(now - 45_000), new Date(now));
assert.equal(measured.reduce((sum, day) => sum + day.milliseconds, 0), 45_000);
const midnight = Date.parse('2026-11-12T00:00:15Z');
const split = creditPresenceDays(new Date(midnight - 45_000), new Date(midnight));
assert.equal(split.length, 2, 'Crossing midnight produces two daily aggregates');
assert.deepEqual(Array.from(split, x => x.milliseconds), [30_000, 15_000]);
assert.deepEqual(Array.from(split, x => x.day.toISOString().slice(0, 10)), ['2026-11-11', '2026-11-12']);
const schema = read('server/prisma/schema.prisma');
const migration = read('server/prisma/migrations/20261111150000_tenant_account_presence/migration.sql');
assert.match(schema, /model TenantAccountPresence \{/);
assert.match(schema, /membership Membership @relation\(fields: \[tenantId, platformAccountId\], references: \[tenantId, platformAccountId\], onDelete: Cascade\)/);
assert.match(migration, /PRIMARY KEY \("tenantId", "platformAccountId"\)/);
assert.match(migration, /ON DELETE CASCADE/);
const controller = read('server/src/auth/auth.controller.ts');
assert.match(controller, /@UseGuards\(JwtAuthGuard\)\s+@Post\('presence'\)/);
const auth = read('server/src/auth/auth.service.ts');
assert.match(auth, /membership\.findUnique\([\s\S]*?tenantId_platformAccountId/);
assert.match(auth, /if \(!member\) throw new UnauthorizedException/);
assert.match(auth, /tenantAccountPresence\.upsert\(/);
const adminService = read('server/src/saas-admin/saas-admin.service.ts');
assert.match(adminService, /presence: \{ select: \{ lastSeenAt: true \} \}/);
assert.match(adminService, /presence: membership \? \{ online: isAccountOnline\(membership\.presence\?\.lastSeenAt\) \} : null/);
const admin = read('admin/admin.js');
assert.match(admin, /typeof item\.presence\?\.online === 'boolean'/);
assert.match(admin, /'В сети' : 'Не в сети'/);
assert.doesNotMatch(admin, /Сеть: нет данных/);
console.log('Presence: membership-scoped, 2min TTL, Admin status PASS');
