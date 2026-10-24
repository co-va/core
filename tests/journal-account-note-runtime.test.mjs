import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

function browserBinary() {
  for (const candidate of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = spawnSync('which', [candidate], { encoding: 'utf8' });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return '';
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

const binary = browserBinary();
if (!binary) {
  if (process.env.CI) assert.fail('Chromium-compatible browser is required for Account Journal Note regression');
  console.log('Account Journal Note browser regression skipped: Chromium-compatible browser not found.');
  process.exit(0);
}

const root = process.cwd();
const server = createServer((request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url || '/', 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`) && resolved !== path.resolve(root, 'index.html')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    const body = fs.readFileSync(resolved);
    response.writeHead(200, { 'Content-Type': contentType(resolved), 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});

try {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  assert.ok(port, 'Account Journal Note browser regression server did not start');
  const child = spawn(binary, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--window-size=390,844',
    '--force-device-scale-factor=1',
    '--touch-events=enabled',
    '--virtual-time-budget=12000',
    '--dump-dom',
    `http://127.0.0.1:${port}/tests/journal-account-action-x-runtime-browser.html`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let output = '';
  let errors = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const exitCode = await new Promise((resolve) => child.once('close', resolve));
  assert.equal(exitCode, 0, `Account Journal Note browser process failed:\n${errors.slice(-4000)}`);
  assert.match(
    output,
    /data-journal-account-action-x-runtime="pass"/,
    `Account Journal Note browser regression failed:\n${output.slice(-6000)}`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log('Account Journal Note runtime regression passed.');
