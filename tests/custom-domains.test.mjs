import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const environment = readFileSync(new URL('../core/environment.js', import.meta.url), 'utf8');
const serverMain = readFileSync(new URL('../server/src/main.ts', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const landingHtml = readFileSync(new URL('../landing/index.html', import.meta.url), 'utf8');
const buildPages = readFileSync(new URL('../scripts/build-pages.mjs', import.meta.url), 'utf8');
const iconRenderer = readFileSync(new URL('../scripts/render-pwa-icons.mjs', import.meta.url), 'utf8');
const appIconSvg = readFileSync(new URL('../app-icon.svg', import.meta.url), 'utf8');
const appManifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));

assert.match(environment, /https:\/\/api\.va-tools\.ru/);
assert.match(environment, /https:\/\/admin\.va-tools\.ru/);
assert.match(environment, /https:\/\/app\.va-tools\.ru/);
assert.match(environment, /https:\/\/user\.va-tools\.ru/);
assert.doesNotMatch(environment, /https:\/\/book\.va-tools\.ru/);
assert.doesNotMatch(environment, /https:\/\/client\.va-tools\.ru/);
assert.doesNotMatch(environment, /amvera\.io/);

assert.match(serverMain, /api\.va-tools\.ru/);
assert.match(serverMain, /admin\.va-tools\.ru/);
assert.match(serverMain, /app\.va-tools\.ru/);
assert.match(serverMain, /user\.va-tools\.ru/);
assert.match(serverMain, /const LANDING_HOST = 'va-tools\.ru'/);
assert.match(serverMain, /const LANDING_WWW_HOST = 'www\.va-tools\.ru'/);
assert.doesNotMatch(serverMain, /book\.va-tools\.ru/);
assert.doesNotMatch(serverMain, /client\.va-tools\.ru/);
assert.match(serverMain, /host === ADMIN_HOST/);
assert.match(serverMain, /host === API_HOST/);
assert.match(serverMain, /host === APP_HOST/);
assert.ok(serverMain.includes('host === TEMP_APP_HOST || host === APP_HOST'), 'old Professional hosts must share one redirect');
assert.ok(serverMain.includes("const guestBookingQuery = request.path === '/'"), 'legacy guest Booking must retain its route');
assert.ok(serverMain.includes('return response.redirect(302, `https://${PROF_HOST}${redirectPath}`);'), 'old Professional hosts must redirect to canonical Professional');
assert.ok(!serverMain.includes("if (host === APP_HOST) {\n      return staticSite"), 'old Professional must not be served by Core');

assert.match(serverMain, /host === USER_HOST/);
assert.doesNotMatch(serverMain, /USER_PWA_ASSETS/, 'Core must not expose User-owned PWA assets');
assert.equal(existsSync(new URL('../pwa/user/app-icon.svg', import.meta.url)), false);
assert.equal(existsSync(new URL('../pwa/user/manifest.webmanifest', import.meta.url)), false);
assert.match(serverMain, /host === LANDING_HOST/);
assert.match(serverMain, /host === LANDING_WWW_HOST/);
assert.match(serverMain, /landing\/index\.html/);
assert.match(serverMain, /'Cache-Control': 'no-store, no-cache, must-revalidate'/);
assert.match(serverMain, /publicBookingPath/);
assert.doesNotMatch(serverMain, /sendFile\(resolve\(siteRoot, 'user\.html'\)\)/, 'Core must not serve the detached User application');
assert.equal(existsSync(new URL('../user.html', import.meta.url)), false, 'Core must not own the User HTML entry');
assert.equal(existsSync(new URL('../online-booking/user-entry.js', import.meta.url)), false, 'Core must not own the User application entry');

assert.doesNotMatch(landingHtml, /book\.va-tools\.ru/);
assert.match(landingHtml, /https:\/\/prof\.va-tools\.ru\/invite\//);
assert.match(landingHtml, /https:\/\/prof\.va-tools\.ru\//);
assert.doesNotMatch(landingHtml, /https:\/\/app\.va-tools\.ru/);

assert.match(indexHtml, /<base href="\/">/);
assert.match(indexHtml, /theme-color" content="#2F3338"/);
assert.match(indexHtml, /rel="manifest" href="\/manifest\.webmanifest"/);
assert.match(indexHtml, /rel="apple-touch-icon" sizes="192x192" href="\/icon-192\.png"/);

assert.equal(appManifest.name, 'Кабинет');
assert.equal(appManifest.short_name, 'Кабинет');
assert.equal(appManifest.theme_color, '#2F3338');
assert.ok(appManifest.icons.some((icon) => icon.src === '/icon-192.png' && icon.sizes === '192x192'));
assert.ok(appManifest.icons.some((icon) => icon.src === '/app-icon.svg' && icon.sizes === 'any'));

for (const path of [
  '../app-icon.svg',
  '../scripts/render-pwa-icons.mjs',
]) {
  assert.equal(existsSync(new URL(path, import.meta.url)), true, `${path} must exist`);
}

assert.match(buildPages, /renderPwaIcons\(out\)/);
assert.match(iconRenderer, /output: 'icon-192\.png'/);

// Device-refined C4 artwork: keep the approved booking mark, readable open cabinet apex, and outer air.
assert.match(appIconSvg, /rx="90\.5" ry="90\.5"/);
assert.match(appIconSvg, /M66\.2 150\.7 L108\.2 78\.7 L105\.8 77\.3 L63\.8 149\.3 Z/);
assert.match(appIconSvg, /M113\.8 62\.7 L161\.8 150\.7 L164\.2 149\.3 L116\.2 61\.3 Z/);
assert.match(appIconSvg, /M65 151\.4 L163 151\.4 L163 148\.6 L65 148\.6 Z/);
assert.match(appIconSvg, /M101\.2 109\.2 L162\.2 151\.2 L163\.8 148\.8 L102\.8 106\.8 Z/);
assert.match(iconRenderer, /const RING_RX = 90\.5;/);
assert.match(iconRenderer, /const RING_RY = 90\.5;/);
assert.match(iconRenderer, /\[\[66\.2, 150\.7\], \[108\.2, 78\.7\], \[105\.8, 77\.3\], \[63\.8, 149\.3\]\]/);

assert.match(dockerfile, /COPY --from=frontend-build \/app\/_site \/app\/site/);

console.log('custom domain runtime tests: OK');
