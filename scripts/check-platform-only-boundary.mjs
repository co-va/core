import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const frontEntries = [
  'index.html', 'core.js', 'booking.html', 'reset-password.html',
  'verify-email.html', 'manifest.webmanifest', 'service-worker.js',
  'app-icon.svg', 'chat', 'journal', 'settings', 'timetable',
  'invite', 'online-booking', 'server/src/staging-preview.ts',
];
const allowedCore = new Set([
  'auth.js', 'environment.js', 'password-reset-page.js',
  'finance/rules.js', 'finance/rules.d.ts',
  'loyalty/price-condition.js', 'loyalty/price-condition.d.ts',
  'phone/index.js', 'phone/index.d.ts',
  'time/zone.js', 'time/zone.d.ts',
  'uei-format.js', 'uei-format.d.ts',
]);
const allowedUI = new Set([
  'auth/auth.css', 'buttons/buttons.css', 'buttons/index.js',
  'commercial-catalog.css', 'documents/document.css', 'documents/index.js',
  'inputs/inputs.css', 'inputs/index.js', 'lists/list-entry.css',
  'modals/modal.css', 'modals/index.js', 'receipt/receipt.css',
  'selectors/index.js', 'utils/escape-html.js',
  'v2/geometry.js', 'v2/html.js', 'v2/lifecycle.js',
  'v2/modal-portal.js', 'v2/sticker.js', 'v2/swipe.js',
  'v2/v2.css', 'v2/z-affordance.js', 'v2/z-layout.js',
]);
function listFiles(directory, into = []) {
  if (!existsSync(directory)) return into;
  for (const item of readdirSync(directory)) {
    const file = join(directory, item);
    if (statSync(file).isDirectory()) listFiles(file, into);
    else into.push(relative(root, file).replaceAll('\\', '/'));
  }
  return into;
}
const failures = [];
for (const name of frontEntries) {
  if (existsSync(join(root, name))) failures.push('Retired app entry remains: ' + name);
}
for (const file of listFiles(join(root, 'core'))) {
  if (!allowedCore.has(file.slice('core/'.length))) failures.push('Browser application module in Core: ' + file);
}
for (const file of listFiles(join(root, 'ui'))) {
  if (!allowedUI.has(file.slice('ui/'.length))) failures.push('Non-platform UI module in Core: ' + file);
}
const main = readFileSync(join(root, 'server/src/main.ts'), 'utf8');
assert.match(main, /host === API_HOST/);
assert.match(main, /host === ADMIN_HOST/);
assert.match(main, /host === LANDING_HOST/);
assert.match(main, /host === USER_HOST/);
assert.match(main, /host === TEMP_APP_HOST \|\| host === APP_HOST/);
assert.doesNotMatch(main, /stagingPreviewMiddleware|landingPreviewPath|booking\.html|publicBookingPath/);
const builder = readFileSync(join(root, 'scripts/build-pages.mjs'), 'utf8');
assert.match(builder, /platformFiles/);
assert.doesNotMatch(builder, /copyTree\(root, out\)|renderPwaIcons/);
const compose = readFileSync(join(root, 'docker-compose.staging.yml'), 'utf8');
assert.doesNotMatch(compose, /^\s{2}frontend:/m);

assert.deepEqual(failures, [], failures.join('\n'));
console.log('Core platform-only ownership: PASS');
