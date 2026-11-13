import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const out = join(root, '_site');
const rawToken = String(process.env.GITHUB_SHA || Date.now());
const buildToken = rawToken.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'build';

// Core ships its platform Admin and public landing only. No app, Booking or PWA bundle.
const platformFiles = [
  'css/style.css',
  'core/auth.js',
  'core/environment.js',
  'core/password-reset-page.js',
  'core/phone/index.js',
  'ui/auth/auth.css',
  'ui/buttons/buttons.css',
  'ui/buttons/index.js',
  'ui/commercial-catalog.css',
  'ui/documents/document.css',
  'ui/documents/index.js',
  'ui/inputs/inputs.css',
  'ui/inputs/index.js',
  'ui/lists/list-entry.css',
  'ui/modals/modal.css',
  'ui/modals/index.js',
  'ui/receipt/receipt.css',
  'ui/selectors/index.js',
  'ui/utils/escape-html.js',
  'ui/v2/geometry.js',
  'ui/v2/shell.js',
  'ui/v2/header.js',
  'ui/v2/card-deck.js',
  'ui/v2/z-stack.js',
  'ui/v2/workspace-navigation.js',
  'ui/v2/html.js',
  'ui/v2/lifecycle.js',
  'ui/v2/modal-portal.js',
  'ui/v2/sticker.js',
  'ui/v2/swipe.js',
  'ui/v2/v2.css',
  'ui/v2/z-affordance.js',
  'ui/v2/z-layout.js',
];
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const path of ['admin', 'landing', ...platformFiles]) {
  const source = join(root, path);
  if (!existsSync(source)) throw new Error(`Platform asset missing: ${path}`);
  const target = join(out, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}


/*
 * Production Admin must load the canonical source HTML with current modules.
 * admin/index.html is a generated, inlined staging-preview artifact and can
 * be stale after selective releases. Do not ship that snapshot as live Admin.
 */
const adminSourceHtml = join(root, 'admin/index.source.html');
const liveAdminHtml = join(out, 'admin/index.html');
if (!existsSync(adminSourceHtml)) throw new Error('Admin source HTML missing');
writeFileSync(liveAdminHtml, readFileSync(adminSourceHtml, 'utf8'));

function versionModuleSpecifier(specifier) {
  if (!/^\.{1,2}\/.+\.(?:js|mjs)$/.test(specifier)) return specifier;
  return `${specifier}?build=${buildToken}`;
}

function versionJavaScript(source) {
  return source
    .replace(/(\bfrom\s*)(['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))\2/g, (_, lead, quote, specifier) => `${lead}${quote}${versionModuleSpecifier(specifier)}${quote}`)
    .replace(/(\bimport\s*)(['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))\2/g, (_, lead, quote, specifier) => `${lead}${quote}${versionModuleSpecifier(specifier)}${quote}`)
    .replace(/(\bimport\s*\(\s*)(['"])(\.{1,2}\/[^'"]+\.(?:js|mjs))\2(\s*\))/g, (_, lead, quote, specifier, tail) => `${lead}${quote}${versionModuleSpecifier(specifier)}${quote}${tail}`);
}

function rewriteJavaScript(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      rewriteJavaScript(file);
      continue;
    }
    if (!/\.(?:js|mjs)$/.test(name)) continue;
    const source = readFileSync(file, 'utf8');
    writeFileSync(file, versionJavaScript(source));
  }
}

rewriteJavaScript(out);

function versionHtml(source) {
  return source.replace(
    /\b(src|href)=(['"])(?!https?:|data:|\/\/)([^'"]+\.(?:js|css))\2/g,
    (_, attr, quote, specifier) => `${attr}=${quote}${specifier}?build=${buildToken}${quote}`,
  );
}

function rewriteHtml(dir) {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const stat = statSync(file);
    if (stat.isDirectory()) {
      rewriteHtml(file);
      continue;
    }
    if (!/\.html$/i.test(name)) continue;
    const source = readFileSync(file, 'utf8');
    writeFileSync(file, versionHtml(source));
  }
}

rewriteHtml(out);

console.log(`Pages artifact ready: ${relative(root, out)} (${buildToken})`);
