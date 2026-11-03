import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

function normalizePath(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
}

function gitBlobSha1(file) {
  const bytes = readFileSync(resolve(root, file));
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
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

// Stage 3 freezes the known legacy User frontend that still exists in Core.
// Stage 4 deletes these files and removes this temporary legacy list instead of expanding it.
const frozenLegacyUserFrontend = new Map([
  ['user.html', '07f31f7f4e46a351b22ff5edbe9be2a6bb2b20ec'],
  ['online-booking/user-entry.js', '00a50a7664d32f3abcacd0aea7884e27ea522742'],
  ['online-booking/account-runtime.js', '4265718da411fc8dfb28edc6f93482b6fbbffc9b'],
]);

for (const [file, expectedBlob] of frozenLegacyUserFrontend) {
  assert.equal(existsSync(resolve(root, file)), true, `${file} is a frozen legacy User frontend surface until Stage 4 removes it`);
  assert.equal(
    gitBlobSha1(file),
    expectedBlob,
    `${file} belongs to the legacy User frontend in Core and must not be expanded; remove it in Stage 4 instead`,
  );
}

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
const allowedLegacyFiles = new Set(frozenLegacyUserFrontend.keys());
const forbidden = [];

for (const directory of forbiddenOwnerDirectories) {
  if (existsSync(resolve(root, directory))) {
    forbidden.push(`${directory}/: dedicated User frontend owner is forbidden in Core`);
  }
}

for (const file of frontendRoots.flatMap((directory) => walk(directory))) {
  if (allowedLegacyFiles.has(file)) continue;
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
  if (allowedLegacyFiles.has(file)) continue;
  if (/^(?:user|end-user)(?:[-_.].*)?\.(?:html|js|mjs|cjs|ts|tsx|jsx|css)$/i.test(file)) {
    forbidden.push(`${file}: root User application entrypoint is forbidden in Core`);
  }
}

assert.deepEqual(
  forbidden,
  [],
  `End User App belongs to co-va/user. Core may keep backend/API/server/Prisma/DB only.\n${forbidden.join('\n')}`,
);

console.log('user/core boundary check: OK (legacy User frontend frozen pending Stage 4 removal)');
