import fs from 'node:fs';

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

console.log(`Admin tool readiness map: OK (${a.length} nodes)`);

if (!ui.includes("readinessKey: 'cabinet.profile.workspaces'")) throw new Error('Workplace readiness dropdown must be present');
if (!service.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace readiness status must be saved in the registry');
if (ui.includes('DEMO — без лимита; LIVE — по разрешению')) throw new Error('Do not replace a readiness status with technical text');
if (policy.includes("'cabinet.profile.workspaces'")) throw new Error('Workplace access/quota must remain separate from readiness status');
