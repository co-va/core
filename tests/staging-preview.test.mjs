import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStagingPreviewFile, STAGING_PREVIEW_HOST } from '../server/src/staging-preview.ts';

const gateway = readFileSync(new URL('../server/src/staging-preview.ts', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');

assert.equal(STAGING_PREVIEW_HOST, 'va-app-volokovykh.msk1.amvera.tech');
assert.equal(resolveStagingPreviewFile('/admin/'), 'admin/index.html');
assert.equal(resolveStagingPreviewFile('/admin/admin.js'), 'admin/admin.js');
assert.equal(resolveStagingPreviewFile('/ui/v2/v2.css'), 'ui/v2/v2.css');
assert.equal(resolveStagingPreviewFile('/core/auth.js'), 'core/auth.js');
assert.equal(resolveStagingPreviewFile('/landing/'), 'landing/index.html');
assert.equal(resolveStagingPreviewFile('/'), null, 'Root must redirect to Admin, not serve retired frontend');
assert.equal(resolveStagingPreviewFile('/index.html'), null);
assert.equal(resolveStagingPreviewFile('/server/src/main.ts'), null);
assert.equal(resolveStagingPreviewFile('/admin/../server/src/main.ts'), null);
assert.equal(resolveStagingPreviewFile('/admin/%2e%2e/secret.css'), null);
assert.equal(resolveStagingPreviewFile('/admin/%5Csecret.css'), null);
assert.equal(resolveStagingPreviewFile('/admin/secret.exe'), null);
assert.equal(resolveStagingPreviewFile('/user.html'), null);
assert.match(gateway, /request\.path === '\/' \|\| request\.path === '\/admin'/);
assert.match(gateway, /request\.path === '\/auth\/login'/);
assert.match(gateway, /request\.path === '\/saas-admin\/document-registry\/sync'/);
assert.match(gateway, /status\(405\)/, 'Preview writes must be refused');
assert.match(gateway, /Cache-Control', 'no-store, no-cache, must-revalidate'/);
assert.match(server, /app\.use\(stagingPreviewMiddleware\)/);
assert.doesNotMatch(gateway, /https:\/\/prof\.va-tools\.ru/);
console.log('Core staging Admin preview gateway boundaries: PASS');
