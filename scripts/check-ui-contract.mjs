#!/usr/bin/env node
// UI-CONTRACT-1: fast gate against cross-repository contract drift.
// This is not a visual approval or a screenshot regression test.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const packageName = JSON.parse(read('package.json')).name;
const roles = {
  'co-va-core-platform': 'core',
  '@co-va/user': 'user',
  '@co-va/professional': 'professional',
};
const role = roles[packageName];
if (!role) throw new Error('UI CONTRACT: unknown repository package ' + packageName);

const contractUrl = 'https://raw.githubusercontent.com/co-va/core/staging/UI_ALPHABET.md';
async function loadCanonicalContract() {
  if (role === 'core') return read('UI_ALPHABET.md');
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(contractUrl, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return await response.text();
    } catch (error) { lastError = error; }
  }
  throw new Error('UI CONTRACT: canonical Core staging contract unavailable; cannot verify: ' + lastError);
}

const source = await loadCanonicalContract();
const expectedIds = [
  'shared.modal', 'shared.mini-card', 'shared.calendar',
  'shared.list', 'shared.button', 'shared.input',
  'shared.selector', 'shared.card-appearance', 'shared.shell',
];
const registryStart = source.indexOf('| Контрактный ID |');
const registryTable = registryStart < 0 ? '' : source.slice(registryStart).split('\n\n')[0];
const rows = [...registryTable.matchAll(/^\|\s*\x60(shared\.[a-z][a-z-]*)\x60\s*\|([^\n]+)$/gm)];
const counts = new Map();
for (const row of rows) counts.set(row[1], (counts.get(row[1]) || 0) + 1);
const problems = [];
if (!source.includes('UI-CONTRACT-1')) problems.push('Unexpected UI contract version');
for (const id of expectedIds) if (counts.get(id) !== 1) problems.push('Missing or duplicate contract ID: ' + id);
for (const id of counts.keys()) if (!expectedIds.includes(id)) problems.push('New contract ID requires coordinated consumer update: ' + id);

const requiredFiles = {
  core: {
    'shared.modal': ['ui/v2/z-layout.js', 'ui/modals/index.js'],
    'shared.list': ['ui/lists/list-entry.css'],
    'shared.button': ['ui/buttons/index.js'],
    'shared.input': ['ui/inputs/index.js'],
    'shared.selector': ['ui/selectors/index.js'],
    'shared.shell': ['ui/v2/shell.js', 'admin/admin.js'],
  },
  user: {
    'shared.modal': ['ui/v2/z-layout.js', 'ui/modals/index.js'],
    'shared.mini-card': ['ui/cards/mini-card.js', 'ui/cards/mini-card.css'],
    'shared.calendar': ['ui/calendar/calendar.css'],
    'shared.list': ['ui/lists/list-entry.css'],
    'shared.button': ['ui/buttons/index.js', 'ui/buttons/buttons.css'],
    'shared.input': ['ui/inputs/index.js', 'ui/inputs/inputs.css'],
    'shared.selector': ['ui/selectors/index.js', 'ui/selectors/selectors.css'],
    'shared.card-appearance': ['ui/cards/entity-card-constructor.js'],
    'shared.shell': ['ui/v2/shell.js'],
  },
  professional: {
    'shared.modal': ['ui/v2/z-layout.js', 'ui/modals/index.js'],
    'shared.mini-card': ['ui/cards/mini-card.js', 'ui/cards/mini-card.css'],
    'shared.calendar': ['ui/calendar/calendar.css'],
    'shared.list': ['ui/lists/list-entry.css'],
    'shared.button': ['ui/buttons/index.js', 'ui/buttons/buttons.css'],
    'shared.input': ['ui/inputs/index.js', 'ui/inputs/inputs.css'],
    'shared.selector': ['ui/selectors/index.js', 'ui/selectors/selectors.css'],
    'shared.card-appearance': ['ui/cards/entity-card-constructor.js'],
    'shared.shell': ['ui/v2/shell.js'],
  },
};
for (const [id, paths] of Object.entries(requiredFiles[role])) {
  if (!counts.has(id)) problems.push('No canonical ID for implementation: ' + id);
  for (const path of paths) {
    if (!existsSync(resolve(root, path))) problems.push(id + ': missing owner file ' + path);
  }
}
for (const path of ['AGENTS.md', 'PROJECT_STATE.md']) {
  if (!existsSync(resolve(root, path))) {
    problems.push('Missing agent/project entry: ' + path);
  } else if (!read(path).includes('UI_ALPHABET.md')) {
    problems.push('Entry no longer points to the canonical UI contract: ' + path);
  }
}
if (role !== 'core' && existsSync(resolve(root, 'UI_ALPHABET.md')))
  problems.push('UI_ALPHABET.md must not be duplicated outside Core');

if (role === 'core') {
  const z = read('ui/v2/z-layout.js');
  const v2 = read('ui/v2/v2.css');
  const modal = read('ui/modals/modal.css');
  const input = read('ui/inputs/inputs.css');
  const css = read('css/style.css');
  const admin = read('admin/admin.css');
  if (!z.includes("const SURFACE_HEADER_SPACING = '12px'") ||
      !z.includes("'padding-top:var(--v2-surface-header-spacing)'") ||
      !z.includes("'padding-bottom:var(--v2-surface-header-spacing)'") ||
      !z.includes("'gap:var(--v2-surface-header-spacing)'"))
    problems.push('Core shared Z/Q Header must use one 12px token');
  if (!v2.includes('padding:0 18px calc(24px + env(safe-area-inset-bottom))') ||
      !v2.includes('bottom:0;padding-top:0;background:var(--v2-zq-surface)}'))
    problems.push('Core shared Z/Q must not duplicate Header top padding');
  if (!v2.includes('.v2-q-title,.v2-z-title{box-sizing:border-box;display:flex;align-items:center;width:100%;min-width:0;height:46px;min-height:46px;max-height:46px;'))
    problems.push('Core Z/Q text title must be exactly 46px');
  if (!v2.includes('--v2-zq-surface:#F5F5F3;') ||
      !v2.includes('background:var(--v2-zq-surface);color:var(--v2-ink);box-shadow:-6px 2px 18px rgba(0,0,0,.10)') ||
      !z.includes("'background:var(--v2-zq-surface,#F5F5F3)'") ||
      !modal.includes('.modal-sheet.modal--surface-app:not(.modal--technical){background:var(--v2-zq-surface,#F5F5F3)}') ||
      !admin.includes('.admin-mobile-app .v2-z{background:var(--v2-zq-surface,#F5F5F3)}'))
    problems.push('Core Z/Q shells and Headers must be warm #F5F5F3, preserving white input fields');
  if (!css.includes('--ui-field-height:46px;') ||
      !input.includes('height:var(--ui-field-height);min-height:var(--ui-field-height);max-height:var(--ui-field-height)') ||
      !admin.includes('.admin-mobile-app .admin-field select{'))
    problems.push('Core shared mobile editor fields must be 46px');
}

if (problems.length) {
  problems.forEach((problem) => console.error('UI CONTRACT FAILED: ' + problem));
  process.exitCode = 1;
} else {
  console.log('UI CONTRACT PASS: ' + role + ' uses Core UI-CONTRACT-1, 9 unique IDs and existing source owners.');
}
