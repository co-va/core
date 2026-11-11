import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('admin/document-registry/view.js');
const css = read('admin/admin.css');
const catalog = read('admin/document-registry/catalog.js');
const historySource = read('admin/document-registry/history.js');
assert.doesNotMatch(source, /documentTile|documentTiles|openDocumentViewer/, 'Admin no longer creates app-sized document tiles or technical overlay');
assert.doesNotMatch(source, /admin-documents-tabs|data-registry-view|activeView/, 'All three sections stay visible without tabs');
assert.match(source, /admin-drawer-backdrop admin-document-drawer-backdrop/, 'Desktop reader reuses Admin side drawer');
assert.match(source, /variant: 'q', className: 'admin-document-q'/, 'Mobile reader uses the same shared Q as Tools');
assert.match(source, /documentPage\(\{ title, version, content \}\)/, 'Both catalog and signing snapshots use safe document body rendering');
assert.match(css, /width:min\(820px,calc\(100vw - 40px\)\)/, 'Reader is wider than the standard Admin drawer');
assert.match(css, /admin-document-reading\{[^}]*overflow:auto/, 'Reader scrolls independently within the white drawer');
assert.match(css, /admin-registry-section \.admin-registry-table tbody tr/, 'Compact mobile rows override general mobile card rules');
assert.ok(catalog.includes("'rkn-notification-guide-template'"), 'Roskomnadzor helper stays in the source catalog');
const admin = read('admin/admin.js');
const docService = read('server/src/document-registry/document-registry.service.ts');
const docController = read('server/src/saas-admin/saas-admin.controller.ts');
assert.match(admin, /loadCurrentDocuments: \(\) => adminRequest\('\/document-registry\/current'\)/);
assert.match(docController, /@Get\('document-registry\/current'\)/);
assert.match(docService, /SELECT d\."key", d\."title", d\."type", d\."requiredForRegistration"/);
assert.match(docService, /v\."version", v\."contentSnapshot" AS "content"/);
assert.match(css, /admin-registry-table tbody tr\{height:44px\}/, 'Compact 44px rows for all three sections');
assert.match(css, /admin-registry-table \.admin-registry-title\{[^}]*white-space:nowrap/, 'Short document labels never wrap');
assert.match(css, /admin-registry-documents-table th:first-child/, 'Document names get remaining width instead of user identity 31%');

const professionalDocs = [
  { key: 'privacy-policy', title: 'Политика', version: 3, content: 'Book — юридическая редакция 1.1 от 16.09.2026', requiredForRegistration: true },
  { key: 'saas-agreement', title: 'Соглашение', version: 2, content: 'Book — юридическая редакция 1.2 от 18.09.2026', requiredForRegistration: true },
  { key: 'platform-processor-consent', title: 'Согласие оператора', version: 1, content: 'C', requiredForRegistration: true },
  { key: 'marketing-consent', title: 'Маркетинг', version: 1, content: 'D', requiredForRegistration: false },
  { key: 'public-profile-consent', title: 'Публичный профиль', version: 1, content: 'E', requiredForRegistration: false },
  { key: 'dpa', title: 'Поручение', version: 1, content: 'F', requiredForRegistration: true },
];
const guideDocs = [{ key: 'rkn-notification-guide-template', type: 'RKN_GUIDE_TEMPLATE', title: 'Инструкция РКН', version: 1, content: 'G' }];
const userDocs = [
  { key: 'user-document-pdn-policy', title: 'Условия ПДН', version: 1, content: 'H' },
  { key: 'user-document-pdn-consent', title: 'Согласие ПДН', version: 1, content: 'I' },
  { key: 'user-document-messages-consent', title: 'Согласие на сообщения', version: 1, content: 'J' },
];
const history = [
  { id: 'prof-event', subjectType: 'PLATFORM_ACCOUNT', documentTitle: 'Соглашение', documentVersion: 2, documentContent: 'Exact signed professional snapshot', accountEmail: 'professional@example.test', action: 'ACCEPTED', occurredAt: '2026-11-11T10:00:00.000Z' },
  { id: 'user-event', subjectType: 'ACCOUNT', documentTitle: 'Согласие ПДН', documentVersion: 1, documentContent: 'Exact signed user snapshot', accountEmail: 'user@example.test', action: 'REVOKED', occurredAt: '2026-11-11T11:00:00.000Z' },
];
const documents = new Map([...professionalDocs, ...guideDocs, ...userDocs].map((row) => [row.key, row]));
let hydrated = [];
let isMobile = false;
const opened = [];
let modalOptions = null;
let subscribed = 0;
const closeButton = { addEventListener() {} };
const document = {
  body: { append(node) { opened.push(node); } },
  createElement() {
    return { innerHTML: '', className: '', remove() {}, querySelectorAll: () => [closeButton], addEventListener() {}, v2Close() {} };
  },
  querySelector(selector) {
    if (selector === '.admin-mobile-app') return isMobile ? {} : null;
    if (selector === '[data-v2-app]') return { mobileRoot: true };
    return null;
  },
  addEventListener() { subscribed++; },
  removeEventListener() { subscribed--; },
};
let mounted = null;
const context = {
  document,
  getRegistryBookUserDocuments: () => professionalDocs,
  getRegistryUserHelperTemplates: () => guideDocs,
  getRegistryUserLegalTemplates: () => userDocs,
  getRegistryDocument: (key) => documents.get(key),
  getDocumentRegistryHistory: () => hydrated,
  hydrateDocumentRegistryHistory: (events) => { hydrated = events; },
  documentPage: ({ title, version, content }) => '<article class="document-page">' + title + ' / ' + version + ' / ' + content + '</article>',
  modal: (html, options) => { modalOptions = options; return html; },
  mountModal: (root, html) => {
    mounted = { root, html, querySelectorAll: () => [closeButton], addEventListener() {}, v2Close() {} };
    return mounted;
  },
};
const program = source.slice(source.indexOf('// The registry'))
  .replace('export async function renderDocumentRegistry(', 'async function renderDocumentRegistry(');
const registry = runInNewContext(program + '\n({ renderDocumentRegistry, openDocument, documentTable, historyTable })', context);
const buttons = [...professionalDocs, ...guideDocs, ...userDocs].map((doc) => ({
  dataset: { registryDocument: doc.key },
  addEventListener(type, callback) { this[type] = callback; },
}));
const historicButtons = history.map((event) => ({
  dataset: { registryHistory: event.id },
  addEventListener(type, callback) { this[type] = callback; },
}));
const historyHost = {
  isConnected: true,
  innerHTML: '',
  querySelectorAll(selector) { return selector === '[data-registry-history]' ? historicButtons : []; },
};
let fullMarkup = '';
const root = {
  get innerHTML() { return fullMarkup; },
  set innerHTML(value) { fullMarkup = value; },
  querySelector(selector) { return selector === '[data-registry-history-content]' ? historyHost : null; },
  querySelectorAll(selector) {
    if (selector === '[data-registry-document]') return buttons;
    if (selector === '[data-registry-version]') return versionNodes;
    return [];
  },
};
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let fulfillHistory;
let fulfillCurrent;
const versionNodes = [...professionalDocs, ...guideDocs, ...userDocs].map((doc) => ({
  dataset: { registryVersion: doc.key }, textContent: doc.key === 'privacy-policy' ? '1.1' : doc.key === 'saas-agreement' ? '1.2' : '—',
}));
let title = '';
const rendered = registry.renderDocumentRegistry(root, {
  escapeHtml, setTitle: (value) => { title = value; },
  loadHistory: () => new Promise((resolve) => { fulfillHistory = resolve; }),
  loadCurrentDocuments: () => new Promise((resolve) => { fulfillCurrent = resolve; }),
});
assert.equal(title, 'Реестр документов');
assert.match(fullMarkup, /Кабинет<span class="admin-registry-app"> \/ Professional<\/span>/);
assert.match(fullMarkup, /Записи<span class="admin-registry-app"> \/ User<\/span>/);
assert.match(fullMarkup, /admin-users-section-title">История<\/h2>/);
assert.equal((fullMarkup.match(/class="admin-users-section admin-registry-section"/g) || []).length, 3, 'Exactly three matching sections');
assert.equal((fullMarkup.match(/class="admin-card(?:\s|\")/g) || []).length, 3, 'Two list cards and one history loading card');
assert.ok(fullMarkup.indexOf('Кабинет<span') < fullMarkup.indexOf('Записи<span'), 'Professional first');
assert.ok(fullMarkup.indexOf('Записи<span') < fullMarkup.indexOf('История</h2>'), 'User second, History third');
const guideAt = fullMarkup.indexOf('Инструкция РКН');
const userAt = fullMarkup.indexOf('Записи<span');
assert.ok(guideAt > 0 && guideAt < userAt, 'RKN help is Professional, not User consent');
assert.equal((fullMarkup.match(/data-registry-document="/g) || []).length, 10, 'All ten canonical registry documents remain');
assert.equal((fullMarkup.match(/class="admin-registry-icon"/g) || []).length, 10, 'Each document has one small line icon');
assert.equal((fullMarkup.match(/class="admin-registry-open-cell"/g) || []).length, 10, 'Icons use their own last column');
const firstSection = fullMarkup.slice(fullMarkup.indexOf('Кабинет<span'), fullMarkup.indexOf('Записи<span'));
const secondSection = fullMarkup.slice(fullMarkup.indexOf('Записи<span'), fullMarkup.indexOf('История</h2>'));
assert.equal((firstSection.match(/data-registry-document="/g) || []).length, 7, 'Professional retains six documents and RKN');
assert.equal((secondSection.match(/data-registry-document="/g) || []).length, 3, 'User retains exactly three documents');
assert.match(css, /admin-registry-version\{font-size:14px;font-weight:750;color:var\(--text\)/, 'Version digits are strong dark text');
assert.match(css, /admin-registry-history-scroll\{[^}]*overflow-x:auto/, 'Mobile history can scroll sideways without stacking rows');
assert.doesNotMatch(fullMarkup, /document-tile|document-tiles--rail|Платформа ↔ пользователь|Шаблоны помощников/);
assert.match(fullMarkup, /<th>Документ<\/th><th>Версия<\/th><th>Назначение<\/th><th aria-label="Открыть"><\/th>/, 'Catalog follows requested column order');
assert.equal((fullMarkup.match(/is-required/g) || []).length, 5, 'Four mandatory Professional and one User PDN consent');
assert.equal((fullMarkup.match(/is-optional/g) || []).length, 3, 'Two Professional options and User marketing');
assert.equal((fullMarkup.match(/is-reading/g) || []).length, 1, 'User privacy notice is for familiarization');
assert.equal((fullMarkup.match(/is-reference/g) || []).length, 1, 'RKN is reference material, not consent');
assert.equal((fullMarkup.match(/data-registry-version="/g) || []).length, 10, 'Every document has a real-version placeholder');
assert.doesNotMatch(fullMarkup, /Подписать|подписать|Надо подписать/, 'Purpose is not an action and does not claim an existing signature');
assert.match(fullMarkup, /admin-registry-title">Политика ПДН<\/strong>/, 'Short label is visible in registry');
assert.match(fullMarkup, /admin-registry-title">Оферта<\/strong>/, 'Long legal heading never appears in the row');
assert.match(fullMarkup, /data-registry-version="privacy-policy">1\.1<\/span>/, 'Initial legal revision comes from source');
assert.match(fullMarkup, /data-registry-version="saas-agreement">1\.2<\/span>/, 'Second legal revision comes from source');
assert.equal(versionNodes[0].textContent, '1.1');
assert.equal(versionNodes[1].textContent, '1.2');

await Promise.resolve();
fulfillCurrent([
  { key: 'privacy-policy', title: 'Политика', type: 'PRIVACY_POLICY', version: 17, content: 'Book — юридическая редакция 1.3 от 11.11.2026' },
  { key: 'user-document-pdn-policy', title: 'Условия ПДН', type: 'USER_DOCUMENT_BASE', version: 4, content: 'Current User edition from the database' },
]);
// Let the isolated VM Promise continuation complete after the mocked HTTP reply.
await new Promise((resolve) => setImmediate(resolve));
assert.equal(versionNodes[0].textContent, '1.3', 'Latest actual legal revision, not technical index 17');
assert.equal(versionNodes[6].textContent, '—', 'Missing current DB edition does not become a fake version');
assert.equal(versionNodes[7].textContent, '—', 'No legal edition in User template means dash, even if technical index is 4');
buttons[0].click();
assert.equal(opened.length, 1, 'Desktop clicking a row opens one right-side drawer');
assert.equal(opened[0].className, 'admin-drawer-backdrop admin-document-drawer-backdrop');
assert.match(opened[0].innerHTML, /admin-document-reading/);
assert.match(opened[0].innerHTML, /Политика \/ 1\.3 \/ Book — юридическая редакция 1\.3/, 'Viewer opens current persisted legal revision and content');
assert.ok(subscribed > 0);

fulfillHistory(history);
await rendered;
assert.equal((historyHost.innerHTML.match(/data-registry-history="/g) || []).length, 2, 'All legal events are preserved');
assert.match(historyHost.innerHTML, /<th>Документ<\/th><th>Версия<\/th><th>Аккаунт<\/th><th>Дата<\/th><th>Событие<\/th><th aria-label="Открыть"><\/th>/, 'History follows requested six-column order');
assert.match(historyHost.innerHTML, /admin-registry-title">Оферта<\/strong>/, 'History uses short titles without modifying signed data');
assert.match(historyHost.innerHTML, /data-label="Версия"><span class="admin-registry-version">2<\/span>/, 'History version is its own cell');
assert.equal((historyHost.innerHTML.match(/class="admin-registry-open-cell"/g) || []).length, 2, 'History viewer icons are right aligned');
assert.match(historyHost.innerHTML, /professional@example\.test[\s\S]*Professional/);
assert.match(historyHost.innerHTML, /user@example\.test[\s\S]*User/);
assert.match(historyHost.innerHTML, /Принято/);
assert.match(historyHost.innerHTML, /Отозвано/);
assert.match(historyHost.innerHTML, /2026/);
isMobile = true;
historicButtons[1].click();
assert.deepEqual({ ...modalOptions }, { title: 'Документ', variant: 'q', className: 'admin-document-q' }, 'Mobile opens the shared Q sheet, not technical viewer');
assert.match(mounted.html, /Exact signed user snapshot/, 'History opens immutable saved document snapshot');
assert.equal(opened.length, 1, 'Mobile document does not create another desktop drawer');
assert.match(historySource, /documentContent: String\(item\.documentContent/, 'History retains immutable version content');
console.log('Admin Document Registry: 7+3 sections, ordered columns, high-contrast versions, compact history and viewer PASS');
