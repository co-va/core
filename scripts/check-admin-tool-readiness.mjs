import fs from 'node:fs';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const ui = fs.readFileSync('admin/commercial-catalog.js', 'utf8');
const service = fs.readFileSync('server/src/saas-admin/tool-readiness.service.ts', 'utf8');

if (!ui.includes('/saas-admin/tool-readiness')) throw new Error('Admin tools must use dedicated readiness API');
const readinessHandler = ui.slice(ui.indexOf('function bindReadiness('), ui.indexOf('function bindAccountTools('));
if (readinessHandler.includes('productKey:')) throw new Error('Admin readiness must not use commercial product keys');
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
if (!ui.includes('data-tool-expand=') || !ui.includes('data-tariff-tier') ||
    !ui.includes('bindTariffAssignments(content)')) {
  throw new Error('Nested tool rows and inline tariff assignment controls are required');
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
// Both tool tables use seven tracks: Tools, Type, three tariffs, Readiness,
// with an independent expand column. Numeric rows replace switches in-place.
if (!ui.includes('<colgroup><col class="admin-tool-col-expand"><col class="admin-tool-col-name">') ||
    !ui.includes('<col class="admin-tool-col-kind"><col class="admin-tool-col-tier">') ||
    !ui.includes('<col class="admin-tool-col-tier"><col class="admin-tool-col-tier">') ||
    !ui.includes('<col class="admin-tool-col-status"></colgroup>') ||
    !ui.includes('class="admin-tool-registry-expand admin-tool-registry-expand-all"') ||
    !ui.includes('data-tool-expand-all aria-expanded="true"') ||
    !ui.includes('<th>Инструменты</th>') ||
    !ui.includes('<th scope="col" title="F — основная карточка, E — вложенная карточка, R — режим">Тип</th>') ||
    !ui.includes('data-tier-level="start-plus">Start+</th>') ||
    !ui.includes('data-tier-level="pro">Pro</th>') ||
    !ui.includes('<th>Готовность</th>')) {
  throw new Error('Professional/User tool registry header must have three tier columns before readiness');
}
const toolRows = ui.slice(ui.indexOf('function toolRegisterRows('), ui.indexOf('function renderToolRegister('));
const expandCell = toolRows.indexOf('admin-tool-registry-expand-cell');
const nameCell = toolRows.indexOf('admin-tool-registry-name" data-tool-depth=');
const kindCell = toolRows.indexOf('admin-tool-registry-kind');
if (expandCell < 0 || nameCell <= expandCell || kindCell <= nameCell) {
  throw new Error('Disclosure must be the first cell, tools second, type third');
}
for (const kind of [
  "depth === 0 ? 'F'",
  "item.kind === 'e' ? 'E' : 'R'",
  "marker === 'F' || marker === 'E' ? 'is-card' : 'is-plain'",
  "visibleToolChildren(area, item)",
]) {
  if (!toolRows.includes(kind)) throw new Error('F/E/R mapping and K-free filter missing: ' + kind);
}
if (toolRows.includes("marker === 'R' ? 'Режим' : 'Компонент'")) {
  throw new Error('K component type must not be emitted in the Tools registry');
}
for (const rule of [
  '.admin-tool-register-card{',
  '.admin-tool-register-table{width:100%;min-width:860px;max-width:none;table-layout:fixed',
  '.admin-tool-register-table col.admin-tool-col-expand{width:13%}',
  '.admin-tool-register-table col.admin-tool-col-name{width:32%}',
  '.admin-tool-register-table col.admin-tool-col-kind{width:5.8%}',
  '.admin-tool-register-table col.admin-tool-col-tier{width:12.5%}',
  '.admin-tool-register-table col.admin-tool-col-status{width:11.7%}',
  'padding-left:calc(var(--tool-depth,0) * 28px)',
  '.admin-tool-registry-name[data-tool-depth]:not([data-tool-depth="0"])::before',
]) {
  if (!css.includes(rule)) throw new Error('Full-width registry proportions/hierarchy missing: ' + rule);
}
const weights = [13, 32, 5.8, 12.5, 12.5, 12.5, 11.7];
assert.ok(Math.abs(weights.reduce((total, value) => total + value, 0) - 100) < 1e-6,
  'Scaled columns must exactly fill the available table width');
// Tariff membership is presented with neutral native square checkboxes,
// including Deposit; no unrelated tier colors or sliding switches in Tools.
if (!ui.includes('class="admin-tool-tier-checkbox"') ||
    !ui.includes('type="checkbox"') ||
    !ui.includes('data-tariff-tier') ||
    !css.includes('.admin-tool-tier-checkbox{') ||
    css.includes('.admin-tool-tier-switch') ||
    !ui.includes("'cabinet.loyalty.deposit': 'tool.loyalty.deposit'")) {
  throw new Error('Tariff controls must be neutral checkboxes for every tool, including Deposit');
}
if (!ui.includes("key === 'cabinet.profile.workspaces'") ||
    !ui.includes("key === 'cabinet.service.products'") ||
    !ui.includes('data-tool-limit-tier') ||
    !ui.includes('data-tool-limit-infinity') ||
    !ui.includes('data-tariff-tier')) {
  throw new Error('Three inherited tier switches and in-place numeric / infinity must be present');
}
if (!ui.includes("label: 'Рабочие пространства', kind: 'composition'") ||
    !ui.includes("child.readinessKey === 'cabinet.profile.workspaces'") ||
    !ui.includes("...child, kind: 'e'")) {
  throw new Error('Workplace quantity must be visible only in Tools, not duplicated in account permissions');
}
if (!ui.includes('R — режим">Тип</th>') ||
    ui.includes('K — компонент">Тип</th>') ||
    !css.includes('.admin-tool-registry-kind span.is-card{')) {
  throw new Error('Only F/E/R types may be shown; existing F/E card styles remain');
}
const visibleCode = ui.slice(ui.indexOf('export function visibleToolChildren('), ui.indexOf('function toolRegisterRows('))
  .replace('export function', 'function');
const visibleToolChildren = runInNewContext(visibleCode + '\nvisibleToolChildren');
const mapSource = ui.slice(ui.indexOf('export const TOOL_MAP = Object.freeze('), ui.indexOf('const TYPE_LABELS = Object.freeze('))
  .replaceAll('export const ', 'const ');
const toolMap = runInNewContext(mapSource + '\nTOOL_MAP');
for (const area of ['cabinet','records']) {
  const dayKey = area + '.journal.day';
  const day = toolMap[area].find((item) => item.id === 'journal')
    ?.items.find((item) => item.readinessKey === dayKey);
  assert.ok(day, 'Journal Day is required for ' + area);
  const checks = visibleToolChildren(area, day);
  assert.deepEqual(checks.map((item) => item.readinessKey), [
    dayKey + '.events', dayKey + '.notes',
  ], 'Day exposes Events and Notes as tariff-controlled rows, never Record: ' + area);
  assert.ok(day.items.some((item) => item.readinessKey === dayKey + '.record'),
    'Automatic Day Record remains in internal readiness registry: ' + area);
  const visit = (items) => items.forEach((item) => {
    const visible = visibleToolChildren(area, item);
    for (const child of visible) {
      if (child.kind === 'check' &&
          ![dayKey + '.events',dayKey + '.notes'].includes(child.readinessKey)) {
        throw new Error('Only Events/Notes K tools can be exposed in ' + area);
      }
    }
    visit(visible);
  });
  visit(toolMap[area]);
}
if (!ui.includes("marker === 'K' ? 'Инструмент внутри режима'")) {
  throw new Error('Events and Notes must retain their K component type marker');
}
for (const key of [
  'cabinet.journal.day.events', 'cabinet.journal.day.notes',
  'records.journal.day.events', 'records.journal.day.notes',
]) {
  if (!ui.includes("readinessKey: '" + key + "'") ||
      !service.includes("'" + key + "'")) {
    throw new Error('Selectable Events/Notes row must have a real readiness status: ' + key);
  }
}
if (!ui.includes("item.readinessKey, byKey, 'admin-tool-child-status'")) {
  throw new Error('Events/Notes readiness dropdown must remain editable');
}
if (!ui.includes("node.closest('.admin-tool-register-table')") ||
    !ui.includes("toolStatus(item, byKey, true)")) {
  throw new Error('Group readiness labels must fit inside the 65px status column');
}
if (!ui.includes("section.querySelectorAll('[data-tool-expand]').forEach((button) => {") ||
    !ui.includes("const expand = event.currentTarget.getAttribute('aria-expanded') !== 'true'") ||
    !ui.includes('syncToolHierarchy(section);') ||
    !ui.includes("expandButtons.every((button) => button.getAttribute('aria-expanded') === 'true')")) {
  throw new Error('Per-section expand/collapse must synchronize nested toggles and the sticky header');
}
for (const constraint of [
  'admin-tool-register-sticky',
  'admin-tool-register-head-scroll',
  'admin-tool-register-head-table',
  'admin-tool-register-body-table',
  'const columns =',
  'headScroll.scrollLeft = bodyScroll.scrollLeft',
]) {
  if (!ui.includes(constraint)) throw new Error('Sticky header missing or not horizontally synchronized: ' + constraint);
}
for (const rule of [
  '.admin-tool-register-sticky{',
  'position:sticky;top:0;z-index:3;',
  '.admin-tool-register-head-scroll{',
  'box-sizing:border-box;width:100%;overflow:hidden;',
]) {
  if (!css.includes(rule)) throw new Error('Per-section header cannot remain visible on vertical scroll: ' + rule);
}
if (css.includes('.admin-users-section .admin-table th:first-child') ||
    css.includes('.admin-mobile-app .admin-users-section .admin-table')) {
  throw new Error('Account-only table geometry must not leak into Tools');
}

// Exercise actual hierarchy visibility logic, including three nested descendants.
const hierarchyStart = ui.indexOf('function syncToolHierarchy(section) {');
const hierarchyEnd = ui.indexOf('\nexport async function loadTariffs(', hierarchyStart);
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
const allToggle = makeToggle('all');
const rows = ['', 'root', 'root child', 'root child nested', 'other'].map((ancestors) => ({
  dataset: { toolAncestors: ancestors }, hidden: false,
}));
const section = {
  querySelectorAll: (selector) =>
    selector === '[data-tool-expand]' ? [rootToggle, childToggle, nestedToggle] :
    selector === '[data-tool-ancestors]' ? rows : [],
  querySelector: (selector) => selector === '[data-tool-expand-all]' ? allToggle : null,
};
syncHierarchy(section);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, false, false]);
assert.equal(allToggle.getAttribute('aria-expanded'), 'true');
rootToggle.setAttribute('aria-expanded', 'false');
syncHierarchy(section);
assert.deepEqual(rows.map((row) => row.hidden), [false, true, true, true, false],
  'A collapsed parent must hide all levels of descendants, not adjacent root tools');
assert.equal(allToggle.getAttribute('aria-expanded'), 'false');
rootToggle.setAttribute('aria-expanded', 'true');
childToggle.setAttribute('aria-expanded', 'false');
syncHierarchy(section);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, true, true, false],
  'An inner collapse must preserve its own visible row and hide deeper descendants');
childToggle.setAttribute('aria-expanded', 'true');
syncHierarchy(section);
assert.deepEqual(rows.map((row) => row.hidden), [false, false, false, false, false]);
assert.equal(allToggle.getAttribute('aria-expanded'), 'true');

console.log(`Admin tool readiness map: OK (${a.length} nodes)`);

if (!ui.includes("readinessKey: 'cabinet.profile.workspaces'")) throw new Error('Workplace readiness dropdown must be present');
if (!service.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace readiness status must be saved in the registry');
if (ui.includes('DEMO — без лимита; LIVE — по разрешению')) throw new Error('Do not replace a readiness status with technical text');
if (policy.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace access/quota must remain separate from readiness status');
