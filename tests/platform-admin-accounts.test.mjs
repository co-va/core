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
assert.match(tenantRow(owner), /data-label="Роль">Администратор/, 'Owner role remains a dedicated field');
assert.doesNotMatch(tenantRow(owner), /Тестировщик/, 'Owner never shows tester flag');
assert.match(tenantRow(owner), /data-label="Пользователь"><strong>Мой профиль<\/strong><small class="admin-account-email">owner@example.invalid<\/small><\/td>/, 'Name and email are a single identity cell');
assert.match(tenantRow(user), /data-label="Роль">Пользователь<small class="admin-account-role-note">Тестировщик<\/small>/, 'Tester is a concise non-role flag visible only when enabled');
assert.match(tenantRow(user), /data-label="Режим"/);
assert.match(tenantRow(user), /data-label="Тариф"/);
assert.match(tenantRow(user), /data-label="Доступ"><span class="admin-pill active">Разрешён<\/span><small class="admin-account-presence is-unknown">Сеть: нет данных<\/small>/, 'Access allowed does not pretend to be online presence');
assert.match(tenantRow({ ...user, presence: { online: true } }), /admin-account-presence is-online">В сети<\/small>/, 'Known online presence shares Access column');
assert.match(tenantRow({ ...user, presence: { online: false } }), /admin-account-presence is-offline">Не в сети<\/small>/, 'Known offline presence shares Access column');
assert.doesNotMatch(tenantRow(owner) + tenantRow(user), /data-label="Email"|data-label="Тестировщик"|Активен|В сети/, 'No redundant columns or misleading online status');
assert.doesNotMatch(tenantRow(owner) + tenantRow(user), /data-delete-tenant|Удалить/, 'No destructive actions in table rows');
assert.equal((tenantRow(user).match(/<td /g) || []).length, 5, 'Account table has five aligned fields');
const notTester = { ...user, isTester: false };
assert.doesNotMatch(tenantRow(notTester), /Тестирование включено|Тестировщик|>Нет</, 'No repetitive negative tester status');
const suspended = { ...user, status: 'SUSPENDED' };
assert.match(tenantRow(suspended), /data-label="Доступ"><span class="admin-pill suspended">Отключён<\/span>/, 'Suspended means blocked access');
const invitation = { ...user, ownerProfile: null, invitation: { status: 'PENDING', email: 'registration+token@registration.invalid' } };
assert.match(tenantRow(invitation), /Ждёт регистрации/, 'Invitation is not a registered active user');
assert.doesNotMatch(tenantRow(invitation), /registration\+token/, 'Internal registration sentinel is never shown as email');
assert.match(tenantRow(user), /tabindex="0"/, 'Account editor remains accessible from keyboard');

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
  updateRegistrationToolSummary: () => {}, openRegistrationToolDrawer: () => {}, tenantRow, escapeHtml,
});
const sectionTitles = [...markup.matchAll(/class="admin-users-section-title"[^>]*>([^<]+)/g)].map((match) => match[1]);
assert.deepEqual(sectionTitles, ['Мой аккаунт', 'Регистрационная ссылка', 'Все пользователи'], 'Three independent cards in requested order');
assert.equal((markup.match(/class="admin-users-section"/g) || []).length, 3, 'Exactly three working sections');
assert.equal((markup.match(/class="admin-card"/g) || []).length, 2, 'Owner and users have separate cards');
assert.equal((markup.match(/class="admin-invite-panel"/g) || []).length, 1, 'Registration card is independent');
assert.ok(markup.indexOf('data-tenant="owner-id"') < markup.indexOf('Регистрационная ссылка'), 'Owner always above invitation');
assert.ok(markup.indexOf('data-create-invite-link') < markup.indexOf('Все пользователи'), 'Invitation actions before user list');
assert.ok(markup.indexOf('Все пользователи') < markup.indexOf('data-tenant="person-id"'), 'Other accounts in the final growing block');
assert.equal((markup.match(/data-tenant="owner-id"/g) || []).length, 1, 'Existing owner tenant must be reused once');
assert.equal((markup.match(/data-tenant="person-id"/g) || []).length, 1, 'Existing user must not be duplicated');
assert.doesNotMatch(markup, /admin-table-group|Остальные пользователи|admin-heading/, 'No grey separators or duplicate page title');
assert.equal((markup.match(/<th>Пользователь<\/th><th>Роль<\/th><th>Режим<\/th><th>Тариф<\/th><th>Доступ<\/th>/g) || []).length, 2, 'Both tables use five identical headers');
assert.doesNotMatch(markup, /admin-invite-access|data-select-all-invite-tools|data-clear-invite-tools/, 'Retired registration checkbox implementation is absent');
assert.match(markup, /data-configure-invite-tools/, 'Registration config launches a modal');
assert.match(markup, /data-invite-selection/, 'User can see selected tool count');
assert.match(markup, /data-create-invite-link/);
assert.match(markup, /data-copy-invite-link/);
const inviteCode = source.slice(source.indexOf('function openRegistrationToolDrawer()'), source.indexOf('function renderTenants()'));
assert.match(inviteCode, /renderTenantRegistry\(resolved\)/, 'Registration uses the exact account capability registry');
assert.match(inviteCode, /modal\(backdrop.innerHTML, \{ title: 'Доступ', variant: 'q', className: 'admin-access-q' \}\)/, 'Registration and account editor share mobile modal');
assert.match(inviteCode, /querySelectorAll\('\[data-type="LIMIT"\]'\)/, 'Invitation excludes capacity overrides');
assert.match(inviteCode, /data-apply-invite/, 'Invitation selection is committed on apply');
assert.match(source, /const tools = \[\.\.\.selectedRegistrationToolKeys\]/, 'Link submits selected tools');
assert.doesNotMatch(source, /function invitationToolSelector\(/, 'Retired second tool catalog is gone');
const invitations = readFileSync(new URL('../server/src/tenant-invitation/tenant-invitation.service.ts', import.meta.url), 'utf8');
const link = invitations.slice(invitations.indexOf('async createRegistrationLink('), invitations.indexOf('async resendInvitation(', invitations.indexOf('async createRegistrationLink(')));
assert.match(link, /const tools = normalizeToolSelection\(input\?\.tools\)/);
assert.match(link, /createPendingInvitation\(adminId,[\s\S]*?tools,\s*\}\)/, 'Selected tools must reach the new Tenant access overrides');
assert.match(invitations, /enabled: selectedTools\.includes\(capability\.key\)/, 'Backend persists selected capability overrides');

const drawer = source.slice(source.indexOf('function openAccessDrawer('), source.indexOf('document.addEventListener(\'admin:tool-readiness-changed\''));
assert.match(drawer, /tenant\.isOwnerBook \? '' :/, 'Owner has no suspend control');
assert.match(drawer, /tenant\.isOwnerBook \? `<div class="admin-capability"/, 'Owner has a fixed administrator role');
assert.match(drawer, /const testerChanged = !tenant\.isOwnerBook &&/, 'Owner tester role must not be saved');
assert.match(source, /if \(!tenant \|\| tenant\.isOwnerBook\) return;/, 'Owner cannot be deleted in UI');
assert.match(drawer, /data-delete-account/, 'Non-owner deletion is only inside account editor');
assert.match(drawer, /openDeleteTenantModal\(tenantId, close\)/, 'Deleting an account closes its editor');
assert.match(service, /if \(access\.isOwnerBook\) throw new BadRequestException/, 'Owner deletion prohibited server-side');
assert.match(service, /if \(tenantAccess\.isOwnerBook && statusText === TenantAccessStatus\.SUSPENDED\)/, 'Owner suspension prohibited server-side');
console.log('Platform Admin unified Users, protected owner and account badges: PASS');
