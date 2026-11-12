import fs from 'node:fs';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const ui = fs.readFileSync('admin/commercial-catalog.js', 'utf8');
const service = fs.readFileSync('server/src/saas-admin/tool-readiness.service.ts', 'utf8');

if (!ui.includes('/saas-admin/tool-readiness')) throw new Error('Admin tools must use dedicated readiness API');
if (ui.includes('productKey:')) throw new Error('Admin architecture map must not use commercial product keys for readiness');
if (!ui.includes('account.calendar.google') || !ui.includes('account.calendar.yandex')) throw new Error('Records calendar availability controls must remain in unified tools view');
if (!ui.includes('/saas-admin/account-tools') || !ui.includes('data-account-tool=')) throw new Error('Readiness must stay separate from real platform enablement controls');
if (ui.includes('admin-tool-child-status">—')) throw new Error('Admin architecture map must not render missing child readiness');

const childLines = ui.split('\n').filter((line) => line.includes("kind: '") && line.includes('label:'));
for (const line of childLines) {
  // Cash is an E-card containing independent composition entries. The E
  // has no extra readiness selector; every leaf inside it does.
  if (!line.includes('readinessKey:') && !line.includes("nesting: 'composition'")) {
    throw new Error(`Child without readinessKey: ${line.trim()}`);
  }
}
if (!ui.includes("label: 'Касса', kind: 'e', nesting: 'composition'")) {
  throw new Error('Cash E must expose composition, not a parent readiness switch');
}
if (!ui.includes('admin-tool-grandchildren')) {
  throw new Error('Nested Cash composition controls must be rendered');
}
for (const key of ['cabinet.finance.cash.wallets', 'cabinet.finance.cash.loans', 'cabinet.finance.cash.investments']) {
  if (!ui.includes(`readinessKey: '${key}'`) || !service.includes(`'${key}'`)) {
    throw new Error(`Missing Cash composition status: ${key}`);
  }
}

const uiKeys = [...ui.matchAll(/readinessKey:\s*'([^']+)'/g)].map((match) => match[1]);
const serviceBlock = service.match(/export const READINESS_KEYS = \[([\s\S]*?)\] as const;/)?.[1] || '';
const serviceKeys = [...serviceBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
const unique = (values) => [...new Set(values)].sort();
const a = unique(uiKeys);
const b = unique(serviceKeys);
if (JSON.stringify(a) !== JSON.stringify(b)) {
  throw new Error(`Readiness map mismatch. UI=${a.length}, server=${b.length}`);
}
if (a.length < 30) throw new Error(`Readiness registry is unexpectedly small: ${a.length}`);

const policy = fs.readFileSync('server/src/saas-access/readiness-policy.ts', 'utf8');
if (policy.includes('|| actor.isOwnerBook ||')) throw new Error('Owner must not bypass NOT_READY');
if (!policy.includes("actor.commercialMode === 'DEMO' || actor.isTester || actor.isOwnerBook")) throw new Error('DEMO, testers and owner must see TESTING');
if (policy.includes('item.enforced === true')) throw new Error('NOT_READY must not bypass readiness when enforcement was never toggled');
if (ui.includes('data-activate-readiness=')) throw new Error('Readiness must apply as soon as the status is saved');

const css = fs.readFileSync('admin/admin.css','utf8');
const adminNav = fs.readFileSync('admin/admin.js','utf8');
const manifest = fs.readFileSync('server/src/saas-admin/commercial-catalog.service.ts','utf8');
if (!ui.includes("renderToolRegister('cabinet', 'Кабинет', 'Professional')") ||
    !ui.includes("renderToolRegister('records', 'Записи', 'User')")) {
  throw new Error('Tools must be the two document-style registries');
}
if (ui.includes('data-commerce-folder')) throw new Error('Separate Commerce accordion has returned');
if (!ui.includes('data-tool-expand=') || !ui.includes('data-commercial-price') ||
    !ui.includes('data-commercial-mode') || !ui.includes('bindInlineCommercial(content)')) {
  throw new Error('Nested tool rows and inline auto-saving commercial controls are required');
}
if (!ui.includes("child.readinessKey === 'cabinet.journal.month'") ||
    !ui.includes("nested.readinessKey === 'cabinet.timetable'")) {
  throw new Error('Graph must stay beneath Journal / Month, without becoming another F');
}
for(const row of ['tool.loyalty.deposit','tool.loyalty.personal-account']) {
  if(!manifest.includes("key: '" + row + "'")) throw new Error('Missing inline loyalty price '+row);
}
for(const name of ['admin-accounts-table','admin-registry-table','admin-tool-register-table']) {
  if(!css.includes(name)) throw new Error('Missing shared registry '+name);
}
if(!css.includes('/* Unified three-registry 44px geometry')) throw new Error('Shared row/header geometry missing');
if(!adminNav.includes("if (state.section !== 'tenants' || !Array.isArray(tenants)) return;")) {
  throw new Error('Late Users network refresh must not navigate away from Tools');
}


// Registry hierarchy: User has single F Profile/Contacts cards, and Chat must
// be the last F card even while its application remains under reconstruction.
const mapBlock = ui.slice(ui.indexOf('export const TOOL_MAP'), ui.indexOf('// Binding to the existing'));
const recordsMap = mapBlock.slice(mapBlock.indexOf('  records: ['));
for (const key of ["records.profile", "records.contacts", "records.chat"]) {
  if (!recordsMap.includes("readinessKey: '" + key + "'")) {
    throw new Error('Missing single User F readiness ' + key);
  }
}
for (const removedKey of ['records.profile.personal-data','records.profile.documents-notifications',
                          'records.contacts.list','records.contacts.card']) {
  if (recordsMap.includes("readinessKey: '" + removedKey + "'")) {
    throw new Error('Duplicate readiness returned within User F card: ' + removedKey);
  }
}
if (!/id: 'chat', label: 'Чат', readinessKey: 'records\.chat' \},\s*\],\s*\}\);/.test(recordsMap)) {
  throw new Error('User Chat must remain the last F row');
}
if (!/id: 'chat', label: 'Чат', readinessKey: 'cabinet\.chat' \},\s*\],\s*records: \[/.test(mapBlock)) {
  throw new Error('Professional Chat must remain the last F row');
}
for (const area of ['cabinet', 'records']) {
  for (const [suffix,name] of [['events','События'],['notes','Заметки'],['record','Запись']]) {
    if (!mapBlock.includes("label: '" + name + "', kind: 'check', readinessKey: '" + area + ".journal.day." + suffix + "'")) {
      throw new Error('Missing non-card Day check ' + area + '/' + suffix);
    }
  }
}
for (const service of ['google-calendar','yandex-calendar']) {
  if (!recordsMap.includes("kind: 'check', readinessKey: 'records.integrations." + service + "'")) {
    throw new Error('Calendar integration must be a check, never an E card');
  }
}
// Six aligned columns on both Professional and User: F/E 44px, disclosure 60px,
// Tools 55% of the remainder, and three compact 15% columns.
if (!ui.includes('<colgroup><col class="admin-tool-col-kind"><col class="admin-tool-col-expand">') ||
    !ui.includes('<th scope="col" aria-label="Тип карточки"></th>') ||
    !ui.includes('class="admin-tool-registry-expand admin-tool-registry-expand-all"') ||
    !ui.includes('data-tool-expand-all aria-expanded="true"') ||
    !ui.includes('<th>Инструменты</th><th>Готовность</th><th>Оплата</th><th>Цена, ₽</th>')) {
  throw new Error('Professional/User tool registries require a shared F/E–disclosure–tools–status–payment–price header');
}
const toolRows = ui.slice(ui.indexOf('function toolRegisterRows('), ui.indexOf('function renderToolRegister('));
const kindCell = toolRows.indexOf('admin-tool-registry-kind');
const expandCell = toolRows.indexOf('admin-tool-registry-expand-cell');
const nameCell = toolRows.indexOf('admin-tool-registry-name" data-tool-depth=');
if (kindCell < 0 || expandCell <= kindCell || nameCell <= expandCell) {
  throw new Error('F/E must be the first body cell, disclosure second, nested tool name third');
}
for (const rule of [
  '.admin-tool-register-table col.admin-tool-col-kind{width:44px}',
  '.admin-tool-register-table col.admin-tool-col-expand{width:60px}',
  '.admin-tool-register-table col.admin-tool-col-name{width:calc(55% - 57.2px)}',
  '.admin-tool-register-table col.admin-tool-col-price{width:calc(15% - 15.6px)}',
  'padding-left:calc(var(--tool-depth,0) * 28px)',
  '.admin-tool-registry-name[data-tool-depth]:not([data-tool-depth="0"])::before',
]) {
  if (!css.includes(rule)) throw new Error('Tool registry sizing / hierarchy missing: ' + rule);
}
if (!ui.includes("table.querySelectorAll('[data-tool-expand]').forEach((button) => {") ||
    !ui.includes("const expand = event.currentTarget.getAttribute('aria-expanded') !== 'true'") ||
    !ui.includes('syncToolHierarchy(table);') ||
    !ui.includes('expandButtons.every((button) => button.getAttribute(\'aria-expanded\') === \'true\')')) {
  throw new Error('Per-table master expand/collapse must synchronize all nested toggles');
}
if (css.includes('.admin-users-section .admin-table th:first-child') ||
    css.includes('.admin-mobile-app .admin-users-section .admin-table')) {
  throw new Error('Account-only table geometry must not leak into Tools');
}

// Exercise actual hierarchy visibility logic, including three nested descendants.
const hierarchyStart = ui.indexOf('function syncToolHierarchy(table) {');
const hierarchyEnd = ui.indexOf('\nfunction hydrateInlineCommercial(', hierarchyStart);
assert.ok(hierarchyStart >= 0 && hierarchyEnd > hierarchyStart, 'Tool hierarchy controller must exist');
const syncHierarchy = runInNewContext(ui.slice(hierarchyStart, hierarchyEnd) + '\nsyncToolHierarchy');
const makeToggle = (id) => {
  const attributes = new Map([['aria-expanded', 'true']]);
  return {
    dataset: { toolExpand: id },
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
  };
};
const rootToggle = makeToggle('root');
const childToggle = makeToggle('child');
const nestedToggle = makeToggle('nested');
const masterToggle = makeToggle('master');
const rows = ['', 'root', 'root child', 'root child nested', 'other'].map((ancestors) => ({
  dataset: { toolAncestors: ancestors }, hidden: false,
}));
const table = {
  querySelectorAll: (selector) =>
    selector === '[data-tool-expand]' ? [rootToggle, childToggle, nestedToggle] :
    selector === '[data-tool-ancestors]' ? rows : [],
  querySelector: (selector) => selector === '[data-tool-expand-all]' ? masterToggle : null,
};
syncHierarchy(table);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, false, false]);
assert.equal(masterToggle.getAttribute('aria-expanded'), 'true');
rootToggle.setAttribute('aria-expanded', 'false');
syncHierarchy(table);
assert.deepEqual(rows.map((row) => row.hidden), [false, true, true, true, false],
  'A collapsed parent must hide all levels of descendants, not adjacent root tools');
assert.equal(masterToggle.getAttribute('aria-expanded'), 'false');
rootToggle.setAttribute('aria-expanded', 'true');
childToggle.setAttribute('aria-expanded', 'false');
syncHierarchy(table);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, true, true, false],
  'An inner collapse must preserve its own visible row and hide deeper descendants');
childToggle.setAttribute('aria-expanded', 'true');
syncHierarchy(table);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, false, false]);
assert.equal(masterToggle.getAttribute('aria-expanded'), 'true');

console.log(`Admin tool readiness map: OK (${a.length} nodes)`);

if (!ui.includes("readinessKey: 'cabinet.profile.workspaces'")) throw new Error('Workplace readiness dropdown must be present');
if (!service.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace readiness status must be saved in the registry');
if (ui.includes('DEMO — без лимита; LIVE — по разрешению')) throw new Error('Do not replace a readiness status with technical text');
if (policy.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace access/quota must remain separate from readiness status');
