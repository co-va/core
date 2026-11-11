import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../server/src/saas-admin/saas-admin.service.ts', import.meta.url), 'utf8');

const navigation = source.slice(source.indexOf('const ADMIN_SECTIONS = ['), source.indexOf('function adminSectionLabel('));
assert.ok(navigation.includes("id: 'tenants'"));
const sectionIds = [...navigation.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
assert.deepEqual(sectionIds, ['overview', 'tenants', 'capabilities', 'document-registry'], 'Desktop and mobile navigation order');
const stateDeclaration = source.slice(source.indexOf('const state = {'), source.indexOf('let adminPollTimer'));
assert.match(stateDeclaration, /section: 'overview'/, 'Dashboard must open first on login');
assert.ok(!navigation.includes("id: 'owner'"), 'Owner is a user, not a separate Admin section');
assert.ok(!source.includes('function renderOwnerBook()'), 'Duplicate owner screen must be removed');
assert.ok(!source.includes("state.section === 'owner'"));

const rowStart = source.indexOf('function tenantRow(item) {');
const rowEnd = source.indexOf('function renderCapabilities()', rowStart);
assert.ok(rowStart > 0 && rowEnd > rowStart);
const escapeHtml = (value) => String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const tenantRow = runInNewContext(source.slice(rowStart, rowEnd) + '\ntenantRow', { escapeHtml });
const owner = {
  tenantId: 'owner-id', tenantName: 'Owner',
  isOwnerBook: true, isTester: true, status: 'ACTIVE',
  ownerProfile: { name: 'Мой профиль', email: 'owner@example.invalid' },
  access: { commercialMode: 'LIVE' },
};
const user = {
  tenantId: 'person-id', tenantName: 'Person',
  isOwnerBook: false, isTester: true, status: 'ACTIVE',
  ownerProfile: { name: 'Пользователь', email: 'person@example.invalid' },
  access: { commercialMode: 'DEMO' },
};
assert.match(tenantRow(owner), /Администратор/);
assert.doesNotMatch(tenantRow(owner), /data-delete-tenant|Тестировщик/, 'Owner row has no dangerous action or tester badge');
assert.match(tenantRow(user), /data-delete-tenant="person-id"/);
assert.match(tenantRow(user), /Тестировщик/);

const state = { tenants: [user, owner], capabilities: [] };
let markup = '';
const content = {
  set innerHTML(value) { markup = value; },
  get innerHTML() { return markup; },
  querySelector: () => null,
  querySelectorAll: () => [],
};
const tenantsStart = source.indexOf('function renderTenants() {');
const tenantsEnd = source.indexOf('function tenantRow(', tenantsStart);
assert.ok(tenantsStart > 0 && tenantsEnd > tenantsStart);
runInNewContext(source.slice(tenantsStart, tenantsEnd) + '\nrenderTenants();', {
  app: { querySelector: () => content }, state, setActiveSection: () => {},
  invitationToolSelector: () => '', tenantRow, escapeHtml,
});
assert.ok(markup.indexOf('Мой аккаунт') < markup.indexOf('data-tenant="owner-id"'));
assert.ok(markup.indexOf('data-tenant="owner-id"') < markup.indexOf('Остальные пользователи'));
assert.ok(markup.indexOf('Остальные пользователи') < markup.indexOf('data-tenant="person-id"'));
assert.equal((markup.match(/data-tenant="owner-id"/g) || []).length, 1, 'Existing owner tenant must be reused once');

const drawer = source.slice(source.indexOf('function openAccessDrawer('), source.indexOf('document.addEventListener(\'admin:tool-readiness-changed\''));
assert.match(drawer, /tenant\.isOwnerBook \? '' :/, 'Owner has no suspend control');
assert.match(drawer, /tenant\.isOwnerBook \? `<div class="admin-capability"/, 'Owner has a fixed administrator role');
assert.match(drawer, /const testerChanged = !tenant\.isOwnerBook &&/, 'Owner tester role must not be saved');
assert.match(source, /if \(!tenant \|\| tenant\.isOwnerBook\) return;/, 'Owner cannot be deleted in UI');
assert.match(service, /if \(access\.isOwnerBook\) throw new BadRequestException/, 'Owner deletion prohibited server-side');
assert.match(service, /if \(tenantAccess\.isOwnerBook && statusText === TenantAccessStatus\.SUSPENDED\)/, 'Owner suspension prohibited server-side');
console.log('Platform Admin unified Users, protected owner and account badges: PASS');
