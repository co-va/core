import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('server/src/online-booking/account-calendar.service.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/account-calendar.controller.ts', 'utf8');
const toolService = fs.readFileSync('server/src/saas-access/account-tool.service.ts', 'utf8');
const adminTools = fs.readFileSync('admin/account-tools.js', 'utf8');
const adminIndex = fs.readFileSync('admin/index.html', 'utf8');
const integrations = fs.readFileSync('online-booking/calendar-integrations.js', 'utf8');
const shell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const journal = fs.readFileSync('journal/день.js', 'utf8');
const eventOwner = fs.readFileSync('core/event/account-owner.js', 'utf8');

assert.match(controller, /online-booking\/account\/calendar/, 'calendar integration must live under account routes');
assert.match(service, /events\.listOwned\('account'/, 'calendar sync must read account-owned Events only');
assert.match(service, /events\.upsertOwned\('account'/, 'external calendar Events must become account-owned Events');
assert.doesNotMatch(service, /NoteService|accountNote|noteOwner|notes\./, 'calendar sync must not map calendar descriptions or tasks into Note yet');
assert.match(service, /if \(link\.localType === 'record'\)/, 'Record links need an explicit read-only reconciliation branch');
assert.match(service, /recordPayload/, 'canonical Record must be projected outward as a calendar event');
assert.match(service, /payloadHash: ''/, 'external Record edits must force the canonical mirror to be restored');

assert.doesNotMatch(shell, /accountIntegrationsCard/, 'personal Integrations must not be an EntityCard inside Profile');
assert.match(shell, /\{ id: 'profile', label: 'Профиль', items: \[\] \}/, 'Profile must always remain a standalone F root without E children');
assert.doesNotMatch(shell, /ACCOUNT_PROFILE_E_ITEMS/, 'Profile must never own an E navigation collection');
assert.match(shell, /id: 'settings'[\s\S]*id: 'integrations', label: 'Интеграции'/, 'Integrations must belong to the Settings navigation root, never Profile');
assert.match(shell, /children\.length === 1[\s\S]*children\[0\]/, 'one child must collapse directly into F');
assert.match(shell, /items\.length <= 1\) return ''/, 'E must not exist for zero or one child');
assert.match(shell, /children\.length > 1[\s\S]*accountEOpen = true/, 'E opens only when a root has multiple child tools');
assert.match(shell, /renderAccountCalendarIntegrations/, 'personal Integrations F selection must render the calendar integration surface');
assert.match(integrations, /miniCard\(/, 'calendar providers must use Shared MiniCard');
assert.match(integrations, /miniCardRail\(/, 'calendar providers must use Shared MiniCard rail');
assert.doesNotMatch(integrations, /entityVisualCard|normalizeEntityCardAppearance/, 'calendar providers must not create EntityCards');
assert.match(journal, /const accountMode = contextName === 'account'/, 'Journal must retain explicit personal/professional boundary');
assert.match(journal, /withAccountOverlaps\(/, 'personal Journal must calculate overlap hints');
assert.match(journal, /syncAccountCalendars\(\)/, 'personal Journal must start background calendar sync');
assert.match(eventOwner, /online-booking\/account\/calendar\/sync/, 'personal Event mutations must trigger outgoing sync');

assert.match(toolService, /account\.calendar\.google[\s\S]*enabled: false/, 'Google must be OFF by default for account users');
assert.match(toolService, /account\.calendar\.yandex[\s\S]*enabled: true/, 'Yandex must be ON by default for account users');
assert.match(toolService, /isActive: false/, 'account tools must never enter professional TenantAccess capability resolution');
assert.match(toolService, /status: 'tool-disabled'/, 'disabled calendar tools must pause existing provider connections');
assert.match(controller, /platformEnabled/, 'account calendar status must expose platform tool availability');
assert.match(controller, /assertProviderEnabled\('google'\)/, 'Google connect must be guarded by the admin tool switch');
assert.match(controller, /assertProviderEnabled\('yandex'\)/, 'Yandex connect must be guarded by the admin tool switch');
assert.match(integrations, /status\?\.google\?\.platformEnabled/, 'Google MiniCard must be rendered only when enabled by admin');
assert.match(integrations, /status\?\.yandex\?\.platformEnabled/, 'Yandex MiniCard must be rendered only when enabled by admin');
assert.match(adminIndex, /account-tools\.js/, 'admin shell must load end-user tool controls');
assert.match(adminTools, /Конечные пользователи/, 'admin must expose a distinct end-user tools section');
assert.match(adminTools, /type="checkbox" data-account-tool/, 'end-user tools must be controlled by checkboxes');

console.log('account calendar sync architecture: PASS');
