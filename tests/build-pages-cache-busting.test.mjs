import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

const env = { ...process.env, GITHUB_SHA: 'document-registry-cache-test' };
execFileSync(process.execPath, ['scripts/build-pages.mjs'], { env, stdio: 'pipe' });

try {
  const rootIndex = readFileSync('_site/index.html', 'utf8');
  const userIndex = readFileSync('_site/user.html', 'utf8');
  const adminIndex = readFileSync('_site/admin/index.html', 'utf8');
  const builtAdmin = readFileSync('_site/admin/admin.js', 'utf8');

  assert.match(rootIndex, /core\.js\?build=document-registry-cache-test/);
  assert.match(rootIndex, /ui\/v2\/v\.css\?build=document-registry-cache-test/);
  assert.match(userIndex, /ui\/v2\/v\.css\?build=document-registry-cache-test/);
  assert.match(adminIndex, /admin\.js\?build=document-registry-cache-test/);
  assert.match(adminIndex, /admin\.css\?build=document-registry-cache-test/);
  assert.match(builtAdmin, /document-registry\/view\.js\?build=document-registry-cache-test/);
} finally {
  rmSync('_site', { recursive: true, force: true });
}

console.log('HTML asset cache-busting tests: OK');
