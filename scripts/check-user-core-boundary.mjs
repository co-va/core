import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function walk(directory, output = []) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) return output;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) walk(relative(root, path), output);
    else if (entry.isFile()) output.push(normalizePath(relative(root, path)));
  }
  return output;
}

const contract = readFileSync(resolve(root, 'PROJECT_STATE.md'), 'utf8');
assert.match(
  contract,
  /Приложение конечного пользователя имеет единственного владельца:\s*`co-va\/user`/,
  'PROJECT_STATE must keep co-va/user as the sole End User App owner',
);
assert.match(
  contract,
  /User frontend\/runtime\/routes\/UI должны быть полностью удалены из Core/,
  'PROJECT_STATE must keep the User/Core frontend boundary explicit',
);

const frontendRoots = ['core', 'online-booking', 'settings', 'ui'];
const forbiddenOwnerDirectories = [
  'user',
  'end-user',
  'app/user',
  'apps/user',
  'src/user',
  'frontend/user',
  'public/user',
  'web/user',
  'client/user',
  'core/user',
  'online-booking/user',
  'settings/user',
  'ui/user',
];
const forbidden = [];

for (const directory of forbiddenOwnerDirectories) {
  if (existsSync(resolve(root, directory))) {
    forbidden.push(`${directory}/: dedicated User frontend owner is forbidden in Core`);
  }
}

for (const file of frontendRoots.flatMap((directory) => walk(directory))) {
  const normalized = normalizePath(file).toLowerCase();
  const parts = normalized.split('/');
  const name = basename(normalized);

  if (parts.slice(1, -1).includes('user') || parts.slice(1, -1).includes('end-user')) {
    forbidden.push(`${file}: dedicated User frontend directory is forbidden in Core`);
    continue;
  }

  if (/^(?:user|end-user)(?:[-_.](?:entry|app|runtime|shell|route|routes))?\.(?:js|mjs|cjs|ts|tsx|jsx|css|html)$/.test(name)) {
    forbidden.push(`${file}: dedicated User frontend entry/runtime is forbidden in Core`);
  }
}

for (const name of readdirSync(root, { withFileTypes: true })) {
  if (!name.isFile()) continue;
  const file = normalizePath(name.name);
  if (/^(?:user|end-user)(?:[-_.].*)?\.(?:html|js|mjs|cjs|ts|tsx|jsx|css)$/i.test(file)) {
    forbidden.push(`${file}: root User application entrypoint is forbidden in Core`);
  }
}

const retiredUserFrontend = [
  'core/account-transition-runtime.js',
  'online-booking/account-runtime.js',
  'online-booking/account-shell.js',
  'online-booking/booking.js',
  'online-booking/calendar-integrations.js',
  'online-booking/consent-settings.js',
  'online-booking/deposit-data.js',
  'online-booking/password-settings.js',
  'online-booking/personal-account-data.js',
  'online-booking/personal-data.js',
  'core/account/booking-targets.js',
  'core/account/email.js',
  'core/notifications/web-push.js',
  'core/notifications/account-push-api.js',
  'ui/booking/account-mobile.css',
  'pwa/user/app-icon.svg',
  'pwa/user/manifest.webmanifest',
  'tests/account-shell-runtime-browser.html',
];
for (const path of retiredUserFrontend) {
  if (existsSync(resolve(root, path))) {
    forbidden.push(`${path}: retired User application frontend must remain absent from Core`);
  }
}

assert.deepEqual(
  forbidden,
  [],
  `End User App belongs to co-va/user. Core may keep backend/API/server/Prisma/DB only.\n${forbidden.join('\n')}`,
);

console.log('user/core boundary check: OK (legacy User entry runtimes removed)');
