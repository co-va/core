import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('server/src/online-booking/account-calendar.service.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/account-calendar.controller.ts', 'utf8');
const toolService = fs.readFileSync('server/src/saas-access/account-tool.service.ts', 'utf8');
const adminTools = fs.readFileSync('admin/commercial-catalog.js', 'utf8');
const adminIndex = fs.readFileSync('admin/index.html', 'utf8');
const journal = fs.readFileSync('journal/день.js', 'utf8');
const eventOwner = fs.readFileSync('core/event/account-owner.js', 'utf8');

assert.match(
  controller,
  /Controller\(\['online-booking\/account\/calendar', 'account\/calendar'\]\)/,
  'Account Calendar must expose the canonical Account route while the live Core route remains available during the switch',
);
assert.match(service, /events\.listOwned\('account'/, 'calendar sync must read account-owned Events only');
assert.match(service, /events\.upsertOwned\('account'/, 'external calendar Events must become account-owned Events');
assert.doesNotMatch(service, /NoteService|accountNote|noteOwner|notes\./, 'calendar sync must not map calendar descriptions or tasks into Note yet');
assert.match(service, /if \(link\.localType === 'record'\)/, 'Record links need an explicit read-only reconciliation branch');
assert.match(service, /recordPayload/, 'canonical Record must be projected outward as a calendar event');
assert.match(service, /payloadHash: ''/, 'external Record edits must force the canonical mirror to be restored');

assert.match(journal, /const accountMode = contextName === 'account'/, 'Journal must retain explicit personal/professional boundary');
assert.match(journal, /withAccountOverlaps\(/, 'personal Journal must calculate overlap hints');
assert.match(journal, /syncAccountCalendars\(\)/, 'personal Journal must start background calendar sync');
assert.match(eventOwner, /online-booking\/account\/calendar\/sync/, 'live Core Account Event mutations must retain the old sync route until User switches');

assert.match(toolService, /account\.calendar\.google[\s\S]*enabled: false/, 'Google must be OFF by default for account users');
assert.match(toolService, /account\.calendar\.yandex[\s\S]*enabled: true/, 'Yandex must be ON by default for account users');
assert.match(toolService, /isActive: false/, 'account tools must never enter professional TenantAccess capability resolution');
assert.match(toolService, /status: 'tool-disabled'/, 'disabled calendar tools must pause existing provider connections');
assert.match(controller, /platformEnabled/, 'account calendar status must expose platform tool availability');
assert.match(controller, /assertProviderEnabled\('google'\)/, 'Google connect must be guarded by the admin tool switch');
assert.match(controller, /assertProviderEnabled\('yandex'\)/, 'Yandex connect must be guarded by the admin tool switch');

assert.doesNotMatch(adminIndex, /account-tools\.js/, 'admin shell must not load a second end-user tools overlay');
assert.match(adminTools, /records:\s*\[/, 'admin tools must expose the Records application as its own area');
assert.match(adminTools, /account\.calendar\.google/, 'Google Calendar availability must live inside Records tools');
assert.match(adminTools, /account\.calendar\.yandex/, 'Yandex Calendar availability must live inside Records tools');
assert.match(adminTools, /\/saas-admin\/account-tools/, 'unified tools view must keep the real account-tools API control');
assert.match(adminTools, /data-account-tool=/, 'Records integration controls must remain directly controllable in Admin');

console.log('account calendar sync architecture: PASS');
