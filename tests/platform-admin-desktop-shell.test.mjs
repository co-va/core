import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { v2NavigationIcon } from '../ui/v2/card-deck.js';

// Exercise the actual Admin desktop shell renderer rather than checking only JS syntax.
// A misplaced statement terminator once rendered the header but dropped <main data-content>.
const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderShell() {');
const end = source.indexOf('function setActiveSection(', start);
assert.ok(start >= 0 && end > start, 'Desktop Admin renderer must remain accessible to this regression test');

let shellHtml = '';
let sectionRendered = false;
const state = { admin: { account: { email: 'test@example.invalid' } }, section: 'overview' };
const app = {
  get innerHTML() { return shellHtml; },
  set innerHTML(value) { shellHtml = value; },
  querySelectorAll() { return []; },
};
runInNewContext(source.slice(start, end) + '\nrenderShell();', {
  app,
  state,
  window: { matchMedia: () => ({ matches: false }) },
  cleanupMobileShell: null,
  ADMIN_SECTIONS: [
    { id: 'overview', label: 'Обзор', icon: 'home' },
    { id: 'tenants', label: 'Пользователи', icon: 'people' },
    { id: 'capabilities', label: 'Инструменты', icon: 'settings' },
    { id: 'document-registry', label: 'Реестр документов', icon: 'documents' },
  ],
  v2NavigationIcon,
  escapeHtml: (value) => String(value),
  adminSessionIcon: (kind) => '<button data-session-icon="' + kind + '"></button>',
  watchAdminBreakpoint: () => {},
  bindAdminSessionControls: () => {},
  renderCurrentSection: () => {
    assert.match(shellHtml, /<main class="admin-main">/, 'Main area must be part of assigned shell HTML');
    assert.match(shellHtml, /<div class="admin-content" data-content><\/div>/, 'Section mount point must exist before rendering');
    sectionRendered = true;
  },
});

assert.equal(sectionRendered, true, 'Initial section rendering must run');
assert.equal((shellHtml.match(/data-content/g) || []).length, 1, 'Exactly one section mount point');
assert.match(shellHtml, /data-session-icon="push"/, 'PUSH action must remain in shell');
assert.match(shellHtml, /data-session-icon="logout"/, 'Logout action must remain in shell');
const menu = shellHtml.match(/<nav class="admin-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1] || '';
const entries = [...menu.matchAll(/data-section="([^"]+)"/g)].map((match) => match[1]);
assert.deepEqual(entries, ['overview', 'tenants', 'capabilities', 'document-registry']);
assert.equal((menu.match(/class="v2-nav-icon"/g) || []).length, 4, 'All desktop menu entries must have the shared navigation icon');
const documentEntry = menu.match(/<button[^>]+data-section="document-registry"[^>]*>([\s\S]*?)<\/button>/)?.[1] || '';
assert.match(documentEntry, /<svg[^>]*>[\s\S]*M15 3v5h5/, 'Document registry icon must look like a folded sheet of paper');
console.log('Platform Admin desktop shell mount point: PASS');
