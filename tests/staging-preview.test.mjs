import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveStagingPreviewFile, stagingPreviewMiddleware, STAGING_PREVIEW_HOST } from '../server/src/staging-preview.ts';

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
assert.match(gateway, /request\.path === '\/auth\/presence'/, 'Preview must forward only canonical authenticated presence');
assert.match(gateway, /request\.path === '\/saas-admin\/document-registry\/sync'/);
assert.match(gateway, /status\(405\)/, 'Preview writes must be refused');
assert.match(gateway, /Cache-Control', 'no-store, no-cache, must-revalidate'/);
assert.match(server, /app\.use\(stagingPreviewMiddleware\)/);
assert.doesNotMatch(gateway, /https:\/\/prof\.va-tools\.ru/);

 
// The preview middleware serves public static assets from staging. Cached assets
// must not depend on GitHub responding on every browser request.
function responseProbe() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = Buffer.isBuffer(value) ? value.toString('utf8') : value; return this; },
    end() { this.body = ''; return this; },
    redirect(code, value) { this.statusCode = code; this.body = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

async function previewRequest(path, method = 'GET') {
  const response = responseProbe();
  await stagingPreviewMiddleware(
    { headers: { host: STAGING_PREVIEW_HOST }, path, method },
    response,
    () => { throw new Error('Known preview route must not fall through'); },
  );
  return response;
}

const originalFetch = globalThis.fetch;
const originalNow = Date.now;
let logicalNow = 1_000_000;
let upstreamCount = 0;
let upstreamBody = 'preview-v1';
try {
  Date.now = () => logicalNow;
  globalThis.fetch = async () => {
    upstreamCount += 1;
    return { status: 200, ok: true, arrayBuffer: async () => Buffer.from(upstreamBody) };
  };

  const first = await previewRequest('/admin/preview-cache-test.js');
  assert.equal(first.statusCode, 200);
  assert.equal(first.body, 'preview-v1');
  assert.equal(first.headers['x-co-va-preview-cache'], 'miss');
  assert.equal(upstreamCount, 1);

  const hit = await previewRequest('/admin/preview-cache-test.js');
  assert.equal(hit.body, 'preview-v1');
  assert.equal(hit.headers['x-co-va-preview-cache'], 'hit');
  assert.equal(upstreamCount, 1, 'Fresh cached asset must avoid repeated GitHub fetches');

  logicalNow += 15_001;
  upstreamBody = 'preview-v2';
  const stale = await previewRequest('/admin/preview-cache-test.js');
  assert.equal(stale.body, 'preview-v1', 'Expired preview should return known-good content immediately');
  assert.equal(stale.headers['x-co-va-preview-cache'], 'stale');
  await new Promise((resolve) => setImmediate(resolve));
  const updated = await previewRequest('/admin/preview-cache-test.js');
  assert.equal(updated.body, 'preview-v2', 'Background refresh should update cached content');
  assert.equal(updated.headers['x-co-va-preview-cache'], 'hit');
  assert.equal(upstreamCount, 2);

  logicalNow += 15_001;
  globalThis.fetch = async () => { upstreamCount += 1; throw new Error('GitHub unavailable'); };
  const offline = await previewRequest('/admin/preview-cache-test.js');
  assert.equal(offline.body, 'preview-v2', 'Upstream failure must not blank a cached Admin screen');
  assert.equal(offline.statusCode, 200);
  await new Promise((resolve) => setImmediate(resolve));

  const blockedWrite = await previewRequest('/admin/admin.js', 'POST');
  assert.equal(blockedWrite.statusCode, 405, 'Caching must not weaken preview write restrictions');
  const blockedMutation = await previewRequest('/saas-admin/tenants/test/access', 'PUT');
  assert.equal(blockedMutation.statusCode, 405, 'Admin access modification stays blocked in preview');
  const blockedPresenceGet = await previewRequest('/auth/presence', 'PUT');
  assert.equal(blockedPresenceGet.statusCode, 405, 'Only the POST presence method is allowed');
  let presenceForwarded = false;
  await stagingPreviewMiddleware(
    { headers: { host: STAGING_PREVIEW_HOST }, path: '/auth/presence', method: 'POST' },
    responseProbe(),
    () => { presenceForwarded = true; },
  );
  assert.equal(presenceForwarded, true, 'Presence request must reach JwtAuthGuard and canonical account handler');
} finally {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
}

console.log('Core staging Admin preview gateway boundaries and caching: PASS');
