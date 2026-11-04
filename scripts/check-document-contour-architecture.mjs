import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const files = {
  shared: readFileSync('ui/documents/index.js','utf8'),
  sharedCss: readFileSync('ui/documents/document.css','utf8'),
  v2: readFileSync('ui/v2/index.js','utf8'),
  v2Css: readFileSync('ui/v2/v2.css','utf8'),
  ui: readFileSync('ui/ui.js','utf8'),
  profile: readFileSync('ui/profile/index.js','utf8'),
  accountControls: readFileSync('core/profile/account-controls.js','utf8'),
  people: readFileSync('core/people/people.js','utf8'),
  settingsDocuments: readFileSync('settings/documents/documents.js','utf8'),
  invite: readFileSync('invite/invite.js','utf8'),
  inviteCss: readFileSync('invite/invite.css','utf8'),
  admin: readFileSync('admin/document-registry/view.js','utf8'),
  adminCss: readFileSync('admin/admin.css','utf8'),
  archive: readFileSync('core/runtime/tenant-document-archive.js','utf8'),
  registryService: readFileSync('server/src/document-registry/document-registry.service.ts','utf8'),
  tenantController: readFileSync('server/src/tenant-document-archive/tenant-document-archive.controller.ts','utf8'),
};

assert.match(files.shared,/export function documentTile/);
assert.match(files.shared,/toggleData = ''/);
assert.match(files.shared,/document-tile--controlled/);
assert.match(files.shared,/document-tile__toggle/);
assert.match(files.sharedCss,/width:238px/);
assert.match(files.sharedCss,/\.document-tile__toggle/);
assert.match(files.sharedCss,/\.document-viewer-backdrop\{background:#111/);

for (const [name, source] of Object.entries({
  v2: files.v2,
  v2Css: files.v2Css,
  ui: files.ui,
  profile: files.profile,
  accountControls: files.accountControls,
  accountControls: files.accountControls,
  people: files.people,
  settingsDocuments: files.settingsDocuments,
  accountControls: files.accountControls,
  invite: files.invite,
  inviteCss: files.inviteCss,
  admin: files.admin,
  adminCss: files.adminCss,
})) {
  assert.doesNotMatch(source, /v2LegalCards|v2Document|openSharedConsentDocument|v2-legal-card|invite-document__|admin-document-row|admin-history-row|admin-document-drawer/, `Legacy document UI remains in ${name}`);
}

for (const [name, source] of Object.entries({
  settingsDocuments: files.settingsDocuments,
  accountControls: files.accountControls,
  invite: files.invite,
  admin: files.admin,
})) {
  assert.match(source,/documentTile\(/,`${name} does not use shared documentTile`);
  assert.match(source,/documentTiles\(/,`${name} does not use shared documentTiles`);
  assert.match(source,/openDocumentViewer\(/,`${name} does not use shared document viewer`);
}

assert.doesNotMatch(files.archive,/admin\/document-registry\/catalog\.js|getPlatformDocumentBases/);
assert.match(files.archive,/tenant-document-archive\/platform-bases/);
assert.match(files.registryService,/async tenantLegalTemplateBases\(/);
assert.match(files.tenantController,/@Get\('platform-bases'\)/);

console.log('document contour architecture: OK');

const peopleDocumentTile = files.people.slice(
  files.people.indexOf('function personDocumentTile'),
  files.people.indexOf('function openPersonDocumentInfo'),
);
const peopleDocumentsSheet = files.people.slice(
  files.people.indexOf('function openPersonDocuments'),
  files.people.indexOf('function personHistoryMarkup'),
);
const peopleDocumentInfo = files.people.slice(
  files.people.indexOf('function openPersonDocumentInfo'),
  files.people.indexOf('function openPersonDocuments'),
);
assert.match(peopleDocumentTile,/documentTile\(/,'People documents must use shared documentTile');
assert.match(peopleDocumentsSheet,/documentTiles\(/,'People documents must use shared documentTiles');
assert.match(peopleDocumentsSheet,/variant: 'x'/,'People Documents / consents must open from A in canonical X');
assert.match(peopleDocumentInfo,/variant: 's'/,'People document details must use canonical S');
assert.doesNotMatch(files.people,/miniCard\(\{[\s\S]*?data-person-(?:consent|document)/,'People document surfaces must not use Mini Card');

for (const [name, source] of Object.entries({
  settingsDocuments: files.settingsDocuments,
  accountControls: files.accountControls,
  invite: files.invite,
  admin: files.admin,
})) {
  assert.doesNotMatch(source,/\bminiCard(?:Rail)?\s*\(/,`Document surfaces must not use Mini Card UI: ${name}`);
}
