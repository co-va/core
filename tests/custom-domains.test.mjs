import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const main = read('server/src/main.ts');
const landing = read('landing/index.html');
const build = read('scripts/build-pages.mjs');
const docker = read('Dockerfile');
const admin = read('admin/index.html');

for (const host of ['api.va-tools.ru', 'admin.va-tools.ru', 'prof.va-tools.ru', 'user.va-tools.ru', 'va-tools.ru']) {
  assert.ok(main.includes(host), 'Core must know correct API/domain boundary: ' + host);
}
assert.match(main, /host === API_HOST/);
assert.match(main, /host === ADMIN_HOST/);
assert.match(main, /host === LANDING_HOST/);
assert.match(main, /host === USER_HOST\) return response\.status\(404\)/);
assert.match(main, /host === TEMP_APP_HOST \|\| host === APP_HOST/);
assert.ok(main.includes('return response.redirect(302, `https://${PROF_HOST}${redirectPath}`);'));
assert.doesNotMatch(main, /stagingPreviewMiddleware|landingPreviewPath|publicBookingPath|booking\.html/);
assert.match(landing, /https:\/\/prof\.va-tools\.ru\/invite\//);
assert.match(landing, /https:\/\/prof\.va-tools\.ru\//);
assert.doesNotMatch(landing, /https:\/\/app\.va-tools\.ru/);
assert.match(admin, /<title>Администрирование<\/title>/);
assert.match(build, /platformFiles/);
assert.doesNotMatch(build, /renderPwaIcons|copyTree\(root, out\)/);
assert.match(docker, /COPY --from=frontend-build \/app\/_site \/app\/site/);
for (const path of ['index.html', 'core.js', 'booking.html', 'manifest.webmanifest', 'service-worker.js', 'online-booking', 'journal', 'invite', 'settings']) {
  assert.equal(existsSync(new URL('../' + path, import.meta.url)), false, 'Core must not contain an app frontend entry: ' + path);
}
console.log('Platform-only domains and packaging: PASS');
