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
assert.match(tenantRow(user), /data-label="Роль">Пользователь<span class="admin-inline-role-editor"><select/, 'Tester selector is inline under the role');
assert.match(tenantRow(user), /data-inline-tester/, 'Role is editable without opening the account modal');
assert.match(tenantRow(user), /<option value="true" selected>Тестировщик<\/option>/, 'Tester is selected for assigned users');
assert.match(tenantRow(user), /data-label="Режим"/);
assert.match(tenantRow(user), /data-label="Тариф"/);
assert.match(tenantRow(user), /data-label="Доступ"><span class="admin-pill active">Разрешён<\/span><\/td>/, 'Permission is distinct from network presence');
assert.match(tenantRow(user), /data-label="В сети" data-online-cell>—<\/td>/, 'Old Core responses do not invent presence');
assert.doesNotMatch(tenantRow(user), /Сеть: нет данных|admin-account-presence/, 'No placeholder text when telemetry absent');
const presentOnline = tenantRow({ ...user, presence: { online: true, totalOnlineMs: 7_500_000, lastSeenAt: '2026-11-11T11:32:00Z' } });
assert.match(presentOnline, /admin-account-presence is-online">В сети<\/span>[\s\S]*admin-network-detail" title="Последняя активность">11\.11\.26[^<]*<\/small>/, 'Desktop shows verified last activity after network status');
assert.doesNotMatch(presentOnline, /2 ч 5 мин| — /, 'Desktop does not confuse cumulative credited hours with time of last visit');
const presentOffline = tenantRow({ ...user, presence: { online: false, totalOnlineMs: 60_000, lastSeenAt: '2026-11-11T11:32:00Z' } });
assert.match(presentOffline, /admin-account-presence is-offline">Не в сети<\/span>[\s\S]*11\.11\.26/, 'Desktop retains last observed activity when offline');
assert.doesNotMatch(presentOffline, /1 мин| — /, 'Desktop hides accumulated time when offline');
assert.match(tenantRow({ ...user, presence: { online: false, totalOnlineMs: 0, lastSeenAt: '2026-11-11T11:32:00Z' } }), /11\.11\.26/, 'First confirmed visit shows a date even at zero credited minutes');
assert.doesNotMatch(tenantRow({ ...user, presence: { online: false, totalOnlineMs: 0, lastSeenAt: null } }), /admin-network-detail|Учтено|Последний|менее 1 мин/, 'No invented visit and no zero-minute noise');
const mobileTenantRow = runInNewContext(source.slice(rowStart, rowEnd) + '\ntenantRow', {
  escapeHtml,
  window: { matchMedia: () => ({ matches: true }) },
});
assert.match(mobileTenantRow({ ...user, presence: { online: true, totalOnlineMs: 7_500_000, lastSeenAt: '2026-11-11T11:32:00Z' } }), /11\.11\.26[^<]* — 2 ч 5 мин/, 'Mobile remains unchanged until its separate redesign');
assert.doesNotMatch(tenantRow(owner) + tenantRow(user), /data-label="Email"|data-label="Тестировщик"|Активен/, 'No redundant columns or permission-as-online');
assert.doesNotMatch(tenantRow(owner) + tenantRow(user), /data-delete-tenant|Удалить/, 'No destructive actions in table rows');
assert.equal((tenantRow(user).match(/<td /g) || []).length, 6, 'Presence is its own sixth column');
const notTester = { ...user, isTester: false };
assert.match(tenantRow(notTester), /<option value="false" selected>—<\/option>/, 'Non-testers show a compact edit option, not a redundant label');
const suspended = { ...user, status: 'SUSPENDED' };
assert.match(tenantRow(suspended), /data-label="Доступ"><span class="admin-pill suspended">Отключён<\/span>/, 'Suspended means blocked access');
const invitation = { ...user, ownerProfile: null, invitation: { status: 'PENDING', email: 'registration+token@registration.invalid' } };
assert.match(tenantRow(invitation), /Ждёт регистрации/, 'Invitation is not a registered active user');
assert.doesNotMatch(tenantRow({ ...invitation, presence: { online: true } }), /admin-account-presence/, 'Invitations have no online state before registration');
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
  syncRegistrationLinkAction: () => {}, selectedRegistrationToolKeys: new Set(), openRegistrationToolDrawer: () => {}, tenantRow, escapeHtml,
});
const sectionTitles = [...markup.matchAll(/class="admin-users-section-title"[^>]*>([^<]+)/g)].map((match) => match[1]);
assert.deepEqual(sectionTitles, ['Регистрационная ссылка', 'Мой аккаунт', 'Все пользователи'], 'Registration is first, before owner and users');
assert.equal((markup.match(/class="admin-users-section"/g) || []).length, 3, 'Exactly three working sections');
assert.equal((markup.match(/class="admin-card"/g) || []).length, 2, 'Owner and users have separate cards');
assert.equal((markup.match(/class="admin-invite-panel"/g) || []).length, 1, 'Registration card is independent');
assert.ok(markup.indexOf('Регистрационная ссылка') < markup.indexOf('data-tenant="owner-id"'), 'Registration is the first section');
assert.ok(markup.indexOf('data-create-invite-link') < markup.indexOf('Все пользователи'), 'Invitation actions before user list');
assert.ok(markup.indexOf('Все пользователи') < markup.indexOf('data-tenant="person-id"'), 'Other accounts in the final growing block');
assert.equal((markup.match(/data-tenant="owner-id"/g) || []).length, 1, 'Existing owner tenant must be reused once');
assert.equal((markup.match(/data-tenant="person-id"/g) || []).length, 1, 'Existing user must not be duplicated');
assert.doesNotMatch(markup, /admin-table-group|Остальные пользователи|admin-heading/, 'No grey separators or duplicate page title');
assert.equal((markup.match(/<th>Пользователь<\/th><th>Роль<\/th><th>Режим<\/th><th>Тариф<\/th><th>Доступ<\/th><th>В сети<\/th>/g) || []).length, 2, 'Both tables have six aligned headers');

assert.equal((markup.match(/class="admin-table admin-accounts-table"/g) || []).length, 2, 'Both account tables use one explicit fixed-track layout');
const adminCss = readFileSync(new URL('../admin/admin.css', import.meta.url), 'utf8');
const accountLayout = adminCss.slice(adminCss.indexOf('/* Desktop and iPad account lists use identical six-column tracks.'));
assert.match(accountLayout, /@media\(min-width:761px\)\{[\s\S]*?\.admin-users-section \.admin-accounts-table\{[\s\S]*?table-layout:fixed;/, 'The fixed account tracks apply only to desktop and iPad');
const trackWidths = [...accountLayout.matchAll(/\.admin-accounts-table thead th:nth-child\((\d)\)\{width:(\d+)%\}/g)]
  .map((match) => [Number(match[1]), Number(match[2])]);
assert.deepEqual(trackWidths, [[1,30],[2,16],[3,10],[4,10],[5,13],[6,21]], 'All six columns share a stable 100% track system');

assert.match(source, /addEventListener\('change', async \(event\) => \{[\s\S]*?body: JSON.stringify\(\{ isTester: next \}\)/, 'Inline tester writes only the tester flag');
assert.match(source, /select\.value = String\(previous\)/, 'Failed role edit reverts in place');
assert.match(source, /if \(state\.section === 'tenants'\) await refreshTenantNetwork\(\)/, 'Polling changes only online labels, not entire user cards');
assert.match(source, /startAccountPresence\(\{[\s\S]*?onForegroundReport:/, 'Admin reports its own online presence via the canonical heartbeat');
assert.match(source, /stopAccountPresence\(\)/, 'Admin logout or login screen stops heartbeats');
assert.doesNotMatch(markup, /admin-invite-access|data-select-all-invite-tools|data-clear-invite-tools/, 'Retired registration checkbox implementation is absent');
assert.match(markup, /data-invite-strip/, 'One compact surface for tool settings and link creation');
assert.match(markup, /data-configure-invite-tools/, 'Surface is keyboard-accessible and opens the existing modal');
assert.match(markup, /data-create-invite-link disabled/, 'Create is disabled until tools are applied');
assert.doesNotMatch(markup, /Инструменты не выбраны|Выбрано инструментов|Настрой доступ для нового аккаунта|Настроить инструменты<\/button>/, 'No redundant explanation or secondary configuration button');
assert.match(markup, /data-create-invite-link/);
assert.match(markup, /data-copy-invite-link/);
assert.match(markup, /aria-label="Ссылка для регистрации"/, 'Copy field remains accessible without repeating the section title');
assert.doesNotMatch(markup, /<span>Регистрационная ссылка<\/span>/, 'No redundant title in generated-link row');
const inviteCode = source.slice(source.indexOf('function openRegistrationToolDrawer()'), source.indexOf('function renderTenants()'));
assert.match(inviteCode, /renderTenantRegistry\(resolved, \{ isTester: true \}\)/, 'Registration uses the same canonical tool hierarchy');
assert.match(inviteCode, /modal\(backdrop.innerHTML, \{ title: 'Инструменты', variant: 'q', className: 'admin-access-q admin-document-q' \}\)/, 'Registration and account use the document Q modal');
assert.match(inviteCode, /querySelectorAll\('\[data-type="LIMIT"\]'\)/, 'Invitation excludes capacity overrides');
assert.match(inviteCode, /data-apply-invite/, 'Invitation selection is committed on apply');
assert.match(source, /const tools = \[\.\.\.selectedRegistrationToolKeys\]/, 'Link submits selected tools');
assert.match(source, /function syncRegistrationLinkAction\(root\)/, 'One enable/disable rule used on render and apply');
assert.match(source, /button\.disabled = selectedRegistrationToolKeys\.size === 0/, 'Create cannot be clicked before tools exist');
assert.match(source, /syncRegistrationLinkAction\(content\)/, 'Applying settings updates create availability immediately');
assert.match(source, /if \(createLinkButton\.disabled \|\| !tools\.length\) return;/, 'Disabled click is inert');
assert.doesNotMatch(source, /Сначала настрой инструменты нового аккаунта|Ссылка готова\. Она действует/, 'No artificial error or success note');
assert.match(source, /await adminRequest\('\/invitations\/link'/, 'Create directly invokes the existing invitation endpoint');
assert.match(source, /message\.hidden = false/, 'Only actual server errors are presented');
assert.doesNotMatch(source, /function updateRegistrationToolSummary\(/, 'Old redundant selection summary removed');
assert.doesNotMatch(source, /function invitationToolSelector\(/, 'Retired second tool catalog is gone');
const invitations = readFileSync(new URL('../server/src/tenant-invitation/tenant-invitation.service.ts', import.meta.url), 'utf8');
const link = invitations.slice(invitations.indexOf('async createRegistrationLink('), invitations.indexOf('async resendInvitation(', invitations.indexOf('async createRegistrationLink(')));
assert.match(link, /const tools = normalizeToolSelection\(input\?\.tools\)/);
assert.match(link, /createPendingInvitation\(adminId,[\s\S]*?tools,\s*\}\)/, 'Selected tools must reach the new Tenant access overrides');
assert.match(invitations, /enabled: selectedTools\.includes\(capability\.key\)/, 'Backend persists selected capability overrides');

const drawer = source.slice(source.indexOf('function openAccessDrawer('), source.indexOf('document.addEventListener(\'admin:tool-readiness-changed\''));
assert.match(drawer, /tenant\.isOwnerBook \? '' :/, 'Owner has no suspend control');
assert.match(drawer, /tenant\.isOwnerBook \? 'Администратор' : tenant\.isTester/, 'Owner has a fixed administrator role in the graphite summary card');
assert.match(drawer, /const testerChanged = !tenant\.isOwnerBook &&/, 'Owner tester role must not be saved');
assert.match(drawer, /class="admin-drawer admin-document-drawer admin-access-drawer"/, 'Account editor uses the document drawer surface');
assert.match(drawer, /class="admin-document-reading"/, 'Only account drawer content scrolls');
assert.match(drawer, /admin-access-summary-card/g, 'Mode and role reuse graphite overview cards');
assert.match(drawer, /data-commercial-tenant-tools/, 'Commercial conditions belong inside Tools');
assert.doesNotMatch(drawer, /<details class="admin-access-tool-conditions"|<details class="admin-section admin-access-account-actions"/, 'Terms and account actions are not hidden in disclosure panels');
assert.match(drawer, /<section class="admin-access-tool-conditions">/, 'Terms and pricing are visible under Tools');
assert.match(drawer, /<section class="admin-section admin-access-account-actions">/, 'Account controls are visible in their own area');
assert.match(drawer, /class="admin-button" type="submit">Отправить письмо/, 'Email uses the existing canonical Admin button');
assert.match(adminCss, /\.admin-access-email \.admin-form>\.admin-button\{width:auto;justify-self:start\}/, 'Email action does not expand across the form');
assert.match(adminCss, /grid-template-columns:minmax\(0,1fr\) 140px 66px/, 'Each tool row has commercial details before the rightmost access switch');
assert.match(drawer, /renderTenantRegistry\(resolved, tenant\)/, 'Drawer uses the Professional-only registry');
assert.match(drawer, /enhanceCommercialTenantTools\(backdrop\.querySelector/, 'Commercial editor mounts directly, not by DOM observer');
assert.doesNotMatch(drawer, /Техническое письмо|admin-mode-card/, 'Legacy account drawer titles and old mode card are gone');
const commercialModule = readFileSync(new URL('../admin/commercial-tenant.js', import.meta.url), 'utf8');
assert.doesNotMatch(commercialModule, /MutationObserver|pendingTenantId/, 'No second automatic modal injection');
assert.match(commercialModule, /export async function enhanceCommercialTenantTools\(/, 'Commercial tools use the canonical account drawer host');
const registry = source.slice(source.indexOf('function toolReadable('), source.indexOf('function openAccessDrawer('));
assert.match(registry, /TOOL_MAP\.cabinet\.map/, 'Professional hierarchy stays canonical');
assert.doesNotMatch(registry, /TOOL_MAP\.records\.map/, 'Professional permission drawer never shows the separate User application');
assert.doesNotMatch(registry, / · ' \+ escapeHtml\(key\)/, 'Technical readiness keys are not exposed in account rows');
assert.match(registry, /aria-checked/, 'A normal tool has a proper switch');
assert.match(registry, /data-tool-kind/, 'The same F/E/R/K structural levels are preserved');
assert.match(registry, /TOOL_COMMERCIAL_BINDINGS\[key\]/, 'Commercial conditions align with their actual tool rows');
assert.match(registry, /admin-access-inline-limit/, 'Workplace capacity occupies the same line');
assert.doesNotMatch(registry, /<label class="admin-access-tool-option"/, 'Composite tools never create a second list of switch labels');
assert.match(registry, /data-toggle-group/, 'Composite instruments have one visible toggle');
const commercialCode = readFileSync(new URL('../admin/commercial-tenant.js', import.meta.url), 'utf8');
assert.match(commercialCode, /data-commercial-slot/, 'Commercial controls mount into existing tool rows');
assert.doesNotMatch(commercialCode, /<div class="commercial-tenant-products"/, 'No duplicate full product list under conditions');
const registryHelpers = source.slice(source.indexOf('function toolReadable('), source.indexOf('function toolControl('));
const toolState = { toolReadiness: [
  { key: 'cabinet.journal.day', status: 'TESTING' },
  { key: 'cabinet.service.procedures', status: 'NOT_READY' },
  { key: 'cabinet.service.products', status: 'READY' },
] };
const helpers = runInNewContext(registryHelpers + '\n({ toolReadable, toolChildren })', { state: toolState });
const day = { readinessKey: 'cabinet.journal.day' };
assert.equal(helpers.toolReadable(day, false, { access: { commercialMode: 'DEMO' } }), true, 'DEMO can use testing tools');
assert.equal(helpers.toolReadable(day, false, { access: { commercialMode: 'LIVE' }, isTester: false }), false, 'Normal LIVE accounts cannot use testing tools');
assert.equal(helpers.toolReadable(day, false, { access: { commercialMode: 'LIVE' }, isTester: true }), true, 'LIVE tester can use testing tools');
assert.equal(helpers.toolReadable({ readinessKey: 'cabinet.profile.workspaces' }, false, {}), true, 'Workplace access is governed by grants, not readiness');
assert.equal(helpers.toolReadable({ id: 'service' }, false, { access: { commercialMode: 'LIVE' } }), true, 'Service parent is available if one existing mode is ready');
assert.equal(helpers.toolReadable({ id: 'service' }, true, {}), false, 'Separate User tools are read-only here');
const groupedJournal = helpers.toolChildren('cabinet', { id: 'journal', items: [
  { label: 'День', readinessKey: 'cabinet.journal.day' },
  { label: 'Месяц', readinessKey: 'cabinet.journal.month' },
  { label: 'График', readinessKey: 'cabinet.timetable' },
] });
assert.equal(groupedJournal.length, 2, 'Canonical Journal month groups its timetable mode');
assert.equal(groupedJournal[1].items[0].readinessKey, 'cabinet.timetable', 'Graph mode nests under Month rather than duplicating');
// Render the real catalog through the account drawer. Every Capability must be
// offered at most once, even when several tool rows share the Core permission.
const catalogSource = readFileSync(new URL('../admin/commercial-catalog.js', import.meta.url), 'utf8');
const catalogExcerpt = catalogSource.slice(
  catalogSource.indexOf('export const TOOL_MAP = Object.freeze('),
  catalogSource.indexOf('const TYPE_LABELS = Object.freeze(')
).replaceAll('export const ', 'const ');
const catalog = runInNewContext(catalogExcerpt +
  '\n({ TOOL_MAP, TOOL_CAPABILITY_BINDINGS, TOOL_COMMERCIAL_BINDINGS })');
const accessKeys = [...new Set(Object.values(catalog.TOOL_CAPABILITY_BINDINGS).flat().concat('services.access'))];
const accountState = {
  capabilities: accessKeys.map((key) => ({
    key, name: key, valueType: key === 'workplaces.max' ? 'LIMIT' : 'BOOLEAN',
  })),
  toolReadiness: Object.keys(catalog.TOOL_CAPABILITY_BINDINGS).map((key) => ({
    key, status: 'TESTING',
  })).concat([
    { key: 'cabinet.service.procedures', status: 'TESTING' },
    { key: 'cabinet.service.products', status: 'TESTING' },
  ]),
};
const renderer = runInNewContext(registry +
  '\n({ renderTenantRegistry })', {
  state: accountState, ...catalog, escapeHtml,
});
const registryHtml = renderer.renderTenantRegistry(new Map(
  accountState.capabilities.map((cap) => [cap.key, {
    enabled: true, limit: cap.valueType === 'LIMIT' ? 1 : null,
  }])
), { isTester: true, access: { commercialMode: 'DEMO' } });
assert.doesNotMatch(registryHtml, /Записи \/ User|data-account-tools="user"/, 'No User application tools in Professional access');
for (const kind of ['F', 'E', 'R', 'K']) {
  assert.match(registryHtml, new RegExp('data-tool-kind="' + kind + '"'), 'F/E/R/K type ' + kind + ' is retained');
}
for (const key of ['finance.cash.access', 'finance.special.access', 'workplaces.max']) {
  assert.equal((registryHtml.match(new RegExp('data-capability="' + key.replaceAll('.', '\\.') + '"', 'g')) || []).length, 1,
    'Shared capability appears once: ' + key);
}
for (const key of Object.values(catalog.TOOL_COMMERCIAL_BINDINGS)) {
  assert.equal((registryHtml.match(new RegExp('data-commercial-slot="' + key.replaceAll('.', '\\.') + '"', 'g')) || []).length, 1,
    'Commercial conditions have one actual tool row: ' + key);
}
assert.equal((registryHtml.match(/>Журнал<\/span>/g) || []).length, 1,
  'Hierarchy has exactly one Journal parent label');
assert.match(registryHtml, /admin-access-inline-limit/, 'Capacity limit stays in its tool row');
assert.match(registryHtml, /data-tool-depth="1"/, 'Nested E/R names have their own indent level');
assert.match(registryHtml, /data-tool-depth="2"/, 'Component names have deeper indent');
assert.match(adminCss, /\.admin-access-tool-group-body\{padding-left:0\}/, 'Whole rows retain common edges');
assert.match(adminCss, /\.admin-access-tool-grant\{justify-content:flex-end\}/, 'The access switch remains against the right edge');
assert.match(registryHtml, /class="admin-access-tool-commercial"/, 'Commercial conditions are in the center');
const commercialUi = readFileSync(new URL('../admin/commercial-tenant.js', import.meta.url), 'utf8');
assert.match(commercialUi, /<input type="checkbox" data-commercial-tenant-product/, 'Commercial selection is distinguishable from main access switches');
assert.match(commercialUi, /data-commercial-tenant-product\]:checked/, 'Commercial calculation reads checkbox state');
assert.match(adminCss, /\.admin-access-commercial-price\{font-size:13px/, 'Money remains legible in the row');
assert.match(registryHtml, /data-toggle-group/, 'Composite Finance tools have one switch for several grants');
assert.match(registryHtml,
  /data-tool-key="cabinet\.journal\.day\.events"[\s\S]*?disabled role="switch"/,
  'A K component without a separate entitlement shows an inherited disabled switch');
assert.match(registry, /title="Доступ наследуется от родительского инструмента"/,
  'Inherited state is disclosed instead of pretending to be independently editable');
assert.match(adminCss, /\.admin-access-tool-grant \.admin-toggle:disabled\{opacity:\.45/,
  'Inherited switches are visibly muted');
assert.match(source, /if \(!tenant \|\| tenant\.isOwnerBook\) return;/, 'Owner cannot be deleted in UI');
assert.match(drawer, /data-delete-account/, 'Non-owner deletion is only inside account editor');
assert.match(drawer, /openDeleteTenantModal\(tenantId, close\)/, 'Deleting an account closes its editor');
assert.match(service, /if \(access\.isOwnerBook\) throw new BadRequestException/, 'Owner deletion prohibited server-side');
assert.match(service, /if \(tenantAccess\.isOwnerBook && statusText === TenantAccessStatus\.SUSPENDED\)/, 'Owner suspension prohibited server-side');
console.log('Platform Admin unified Users, protected owner and account badges: PASS');
