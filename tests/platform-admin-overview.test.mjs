import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const start = source.indexOf('let overviewWindowWeeks = 8;');
const end = source.indexOf('function renderOwnerBook()', start);
assert.ok(start > 0 && end > start, 'Overview must remain independently testable');

const newDate = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();
const tenants = [
  { tenantId: 'owner', isOwnerBook: true, ownerProfile: { name: 'Администратор', registeredAt: newDate(1) }, access: { commercialMode: 'LIVE' } },
  { tenantId: 'live', isOwnerBook: false, ownerProfile: { name: 'Ирина', email: 'irina@example.invalid', registeredAt: newDate(1) }, access: { commercialMode: 'LIVE' }, status: 'ACTIVE' },
  { tenantId: 'demo', isOwnerBook: false, ownerProfile: { name: 'Пётр', email: 'petr@example.invalid', registeredAt: newDate(12) }, access: { commercialMode: 'DEMO' }, status: 'ACTIVE' },
  { tenantId: 'pending', isOwnerBook: false, tenantName: 'Заявка', invitation: { name: 'Ольга', status: 'PENDING' }, access: { commercialMode: 'DEMO' } },
  { tenantId: 'suspended', isOwnerBook: false, ownerProfile: { name: 'Антон', registeredAt: newDate(24) }, access: { commercialMode: 'DEMO' }, status: 'SUSPENDED' },
];
let markup = '';
let openedTenant = '';
let currentSectionRendered = '';
const listeners = new Map();
function controlFor(selector, dataset) {
  return {
    dataset,
    addEventListener(_name, callback) { listeners.set(selector, callback); },
  };
}
const content = {
  set innerHTML(value) { markup = value; },
  get innerHTML() { return markup; },
  querySelectorAll(selector) {
    if (selector === '[data-overview-group]') return [controlFor('group', { overviewGroup: 'live' })];
    if (selector === '[data-overview-weeks]') return [controlFor('weeks', { overviewWeeks: '4' })];
    if (selector === '[data-overview-tenant]') return [controlFor('tenant', { overviewTenant: 'live' })];
    if (selector === '[data-overview-section]') return [controlFor('section', { overviewSection: 'capabilities' })];
    return [];
  },
  querySelector(selector) {
    return selector === '[data-overview-close]' ? controlFor('close', {}) : null;
  },
};
const state = {
  tenants,
  toolReadiness: [
    { key: 'a', status: 'READY' },
    { key: 'b', status: 'TESTING' },
    { key: 'c', status: 'NOT_READY' },
  ],
  section: 'overview',
};
const context = {
  app: { querySelector: (selector) => selector === '[data-content]' ? content : null },
  state,
  setActiveSection: () => {},
  escapeHtml: (text) => String(text || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  openAccessDrawer: (tenantId) => { openedTenant = tenantId; },
  renderCurrentSection: () => { currentSectionRendered = state.section; },
};
runInNewContext(source.slice(start, end) + '\nrenderOverview();', context);
assert.match(markup, /Состояние платформы/);
assert.match(markup, /<span class="admin-overview-metric-label">Зарегистрированы<\/span>\s*<strong[^>]*>3<\/strong>/, 'Only real registered non-owner accounts count');
assert.match(markup, /<span class="admin-overview-metric-label">LIVE<\/span>\s*<strong[^>]*>1<\/strong>/);
assert.match(markup, /<span class="admin-overview-metric-label">DEMO<\/span>\s*<strong[^>]*>2<\/strong>/);
assert.match(markup, /<span class="admin-overview-metric-label">Ожидают<\/span>\s*<strong[^>]*>1<\/strong>/);
assert.match(markup, /Новые регистрации/);
assert.match(markup, /Это не показатель активности в приложении/);
assert.match(markup, /Готово <strong>1<\/strong>/);
assert.match(markup, /Проверка <strong>1<\/strong>/);
assert.match(markup, /Не готово <strong>1<\/strong>/);
assert.doesNotMatch(markup, /7 активных/, 'Dashboard cannot equate a record status with product activity');

listeners.get('group')();
assert.match(markup, /Ирина/, 'KPI drilldown must show matching person');
assert.doesNotMatch(markup, /Пётр/, 'LIVE drilldown must not include DEMO');
listeners.get('weeks')();
assert.match(markup, /за последние 4 недели/, 'Period button must update real chart');
listeners.get('tenant')();
assert.equal(openedTenant, 'live', 'Person action must open the existing access drawer');
assert.equal(currentSectionRendered, 'tenants', 'Person action must navigate to Users');

listeners.get('section')();
assert.equal(currentSectionRendered, 'capabilities', 'Tools action must navigate to Tools');
console.log('Platform Admin Overview data boundaries, labels and actions: PASS');
