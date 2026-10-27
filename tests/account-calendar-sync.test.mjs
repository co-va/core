import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('server/src/online-booking/account-calendar.service.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/account-calendar.controller.ts', 'utf8');
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
assert.match(shell, /accountIntegrationsCard/, 'personal profile must expose a direct Integrations card');
assert.doesNotMatch(shell, /GLOBAL_ACCOUNT_ROOTS[\s\S]{0,240}settings/, 'personal Integrations must not create a Settings root');
assert.match(journal, /const accountMode = contextName === 'account'/, 'Journal must retain explicit personal/professional boundary');
assert.match(journal, /withAccountOverlaps\(/, 'personal Journal must calculate overlap hints');
assert.match(journal, /syncAccountCalendars\(\)/, 'personal Journal must start background calendar sync');
assert.match(eventOwner, /online-booking\/account\/calendar\/sync/, 'personal Event mutations must trigger outgoing sync');

console.log('account calendar sync architecture: PASS');
