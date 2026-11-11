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
assert.match(admin, /loadWorkingTemplates: async \(\) => \{[\s\S]*?apiRequest\('\/tenant-document-archive\/platform-bases'\)/, 'Working source versions use the already-deployed core endpoint');
assert.match(read('server/src/tenant-document-archive/tenant-document-archive.controller.ts'), /@Get\('platform-bases'\)/);
assert.match(docService, /tenantLegalTemplateBases\(\)/, 'Working platform source versions come from PlatformDocumentVersion');
assert.match(docController, /@Get\('document-registry\/current'\)/);
assert.match(docService, /SELECT d\."key", d\."title", d\."type", d\."requiredForRegistration"/);
assert.match(docService, /v\."version", v\."contentSnapshot" AS "content"/);
assert.match(docService, /v\."publishedAt"/, 'Publication date is supplied by current persisted version');
assert.match(css, /admin-registry-table tbody tr\{height:44px\}/, 'Compact 44px rows for all three sections');
assert.match(css, /@media\(min-width:761px\)\{[\s\S]*?admin-registry-table thead th\{[\s\S]*?height:66px;[\s\S]*?background:#EDE8E1;[\s\S]*?color:#735E49;[\s\S]*?font-size:13px;[\s\S]*?text-transform:none;/,
  'Desktop/iPad registry header is 66px warm ivory with beige 13px labels');
assert.match(css, /admin-registry-table thead th\{height:34px\}/, 'Original mobile header stays at 34px');

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
  { key: 'user-document-pdn-policy', type: 'USER_DOCUMENT_BASE', title: 'Условия ПДН', version: 1, content: 'H' },
  { key: 'user-document-pdn-consent', type: 'USER_DOCUMENT_BASE', title: 'Согласие ПДН', version: 1, content: 'I' },
  { key: 'user-document-messages-consent', type: 'USER_DOCUMENT_BASE', title: 'Согласие на сообщения', version: 1, content: 'J' },
];
const accountTermsDocs = [{
  key: 'account-terms',
  type: 'ACCOUNT_TERMS',
  title: 'Условия использования учётной записи',
  requiredForRegistration: true,
  edition: '1',
  issuedAt: '21.09.2026',
  content: '',
}, {
  key: 'platform-privacy-policy',
  type: 'PRIVACY_POLICY',
  title: 'Политика обработки персональных данных',
  requiredForRegistration: false,
  edition: '1',
  issuedAt: '01.11.2026',
  content: '',
}];
const allDocs = [...professionalDocs, ...userDocs, ...guideDocs, ...accountTermsDocs];
const history = [
  { id: 'prof-event', subjectType: 'PLATFORM_ACCOUNT', documentKey: 'saas-agreement', documentTitle: 'Пользовательское соглашение / публичная оферта', documentVersion: 3, documentContent: 'Book — юридическая редакция 1.2 от 18.09.2026\nExact signed professional snapshot', accountEmail: 'professional@example.test', action: 'ACCEPTED', occurredAt: '2026-11-11T10:00:00.000Z' },
  { id: 'user-event', subjectType: 'ACCOUNT', documentTitle: 'Согласие ПДН', documentVersion: 1, documentContent: 'Exact signed user snapshot', accountEmail: 'user@example.test', action: 'REVOKED', occurredAt: '2026-11-11T11:00:00.000Z' },
];
const documents = new Map([...professionalDocs, ...guideDocs, ...userDocs].map((row) => [row.key, row]));
let hydrated = [];
let isMobile = false;
const opened = [];
const openedEditors = [];
const rootEvents = {};

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
  openDocumentEditor: (options) => { openedEditors.push(options); return { className: 'editor-sheet' }; },
  getRegistryBookUserDocuments: () => professionalDocs,
  getRegistryUserHelperTemplates: () => guideDocs,
  getRegistryUserLegalTemplates: () => userDocs,
  getRegistryPlatformUserDocuments: () => accountTermsDocs,
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
const buttons = allDocs.map((doc) => ({
  dataset: { registryDocument: doc.key },
  disabled: !doc.content,
  removeAttribute(name) { if (name === 'aria-disabled') this.disabled = false; },
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
  addEventListener(kind, callback) { rootEvents[kind] = callback; },
  querySelectorAll(selector) {
    if (selector === '[data-registry-document]') return buttons;
    if (selector === '[data-registry-version]') return versionNodes;
    if (selector === '[data-registry-date]') return dateNodes;
    return [];
  },
};
const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
let fulfillHistory;
let fulfillCurrent;
let fulfillAccountTerms;
const versionNodes = allDocs.map((doc) => ({
  dataset: { registryVersion: doc.key },
  textContent: doc.key === 'privacy-policy' ? '1.1'
    : doc.key === 'saas-agreement' ? '1.2'
      : doc.type === 'USER_DOCUMENT_BASE' ? String(doc.version)
        : ['account-terms', 'platform-privacy-policy'].includes(doc.key) ? '1' : '—',
}));
const dateNodes = allDocs.map((doc) => ({
  dataset: { registryDate: doc.key },
  textContent: doc.key === 'privacy-policy' ? '16.09.2026'
    : doc.key === 'saas-agreement' ? '18.09.2026'
      : doc.key === 'rkn-notification-guide-template' ? '03.10.2026'
        : doc.key === 'account-terms' ? '21.09.2026'
          : doc.key === 'platform-privacy-policy' ? '01.11.2026' : '18.09.2026',
}));
let title = '';
const rendered = registry.renderDocumentRegistry(root, {
  escapeHtml, setTitle: (value) => { title = value; },
  loadHistory: () => new Promise((resolve) => { fulfillHistory = resolve; }),
  loadCurrentDocuments: () => new Promise((resolve) => { fulfillCurrent = resolve; }),
  loadWorkingTemplates: () => Promise.resolve([]),
  loadAccountTerms: () => new Promise((resolve) => { fulfillAccountTerms = resolve; }),
});
const clickSourceRow = (key) => rootEvents.click({
  target: { closest(selector) {
    return selector === '[data-registry-row]' ? { dataset: { registryRow: key } } : null;
  } },
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
assert.equal((fullMarkup.match(/data-registry-document="/g) || []).length, 12, 'Ten Professional sources plus two platform User documents');
assert.equal((fullMarkup.match(/class="admin-registry-icon"/g) || []).length, 12, 'Each displayed record has its editor icon');
assert.equal((fullMarkup.match(/class="admin-registry-open-cell"/g) || []).length, 12, 'Each editor icon stays at the right edge');
assert.equal((fullMarkup.match(/data-registry-add="/g) || []).length, 2, 'Only Professional and User offer a create-document control');
assert.match(css, /border-radius:36px 0 0 0/, 'Right sheet has the shared rounded top-left corner');
const firstSection = fullMarkup.slice(fullMarkup.indexOf('Кабинет<span'), fullMarkup.indexOf('Записи<span'));
const secondSection = fullMarkup.slice(fullMarkup.indexOf('Записи<span'), fullMarkup.indexOf('История</h2>'));
assert.equal((firstSection.match(/data-registry-document="/g) || []).length, 10, 'Professional contains six contractual documents and four working templates');
assert.equal((secondSection.match(/data-registry-document="/g) || []).length, 2, 'User contains terms and platform privacy policy');
assert.equal((firstSection.match(/data-registry-document="user-document-/g) || []).length, 3, 'All three User-facing templates are grouped with Professional');
assert.doesNotMatch(secondSection, /data-registry-document="user-document-/, 'No Professional-provided template appears as a platform User contract');
assert.match(secondSection, /data-registry-document="account-terms"/, 'Canonical platform User account terms are shown');
assert.match(secondSection, /data-registry-document="platform-privacy-policy"/, 'Canonical platform User privacy policy is shown');
assert.match(secondSection, /data-registry-document="platform-privacy-policy"[^>]*disabled aria-disabled="true"/, 'Privacy reader waits for core DB source');
assert.match(secondSection, /data-label="Назначение"><span class="admin-registry-purpose is-reading is-platform"/, 'Platform User privacy only requires ознакомление');
assert.equal((secondSection.match(/<span class="admin-pill active">Правовой<\/span>/g) || []).length, 2, 'Both platform User documents are правовой');
assert.doesNotMatch(catalog, /DOCUMENT_CATALOG = \[[\s\S]*key: "account-terms"/, 'Admin sync must not overwrite actual account terms in DB');
assert.match(css, /admin-registry-version\{font-size:14px;font-weight:750;color:var\(--text\)/, 'Version digits are strong dark text');
assert.match(css, /admin-registry-documents-scroll,\.admin-registry-history-scroll\{[^}]*overflow-x:auto/, 'All three sections use the same scroll structure');
assert.match(source, /class="admin-registry-documents-scroll"/, 'Both source lists use the shared scrolling wrapper');
assert.match(css, /admin-registry-table\{width:100%;min-width:860px;table-layout:fixed\}/, 'Every registry uses a single table-width contract');
assert.match(css, /admin-registry-section \.admin-registry-table\{\s*display:table;width:100%;min-width:860px/, 'Mobile keeps the same column geometry, without independent grid rows');
const registryWidth = (section, index) => {
  const column = index === 1 ? 'first-child' : 'nth-child(' + index + ')';
  const selector = '.admin-registry-section .admin-registry-' + section + '-table th:' + column + ',\n' +
    '.admin-registry-section .admin-registry-' + section + '-table td:' + column + '{width:';
  const at = css.indexOf(selector);
  assert.ok(at !== -1, 'Missing shared geometry for ' + section + ' column ' + index);
  return Number(css.slice(at + selector.length).match(/^([0-9]+)%/)?.[1]);
};
for (const [index, expected] of [[1,23],[2,9],[3,30],[4,18]]) {
  assert.equal(registryWidth('documents', index), expected, 'Documents column ' + index + ' has shared width');
  assert.equal(registryWidth('history', index), expected, 'History column ' + index + ' starts at the exact same coordinate');
}
assert.equal(registryWidth('documents', 5), 14, 'Document status uses the same fifth track as History event');
assert.equal(registryWidth('documents', 6), 6, 'Document icon shares the sixth right-edge track');
assert.equal(registryWidth('history', 5), 14, 'History event keeps the fifth track');
assert.equal(registryWidth('history', 6), 6, 'History document icon stays at the right edge');

assert.doesNotMatch(fullMarkup, /document-tile|document-tiles--rail|Платформа ↔ пользователь|Шаблоны помощников/);
assert.match(fullMarkup, /<th>Документ<\/th><th>Версия<\/th><th>Назначение<\/th><th>Дата<\/th><th>Статус<\/th><th aria-label="Открыть"><\/th>/, 'Catalog status occupies the fifth column before rightmost icon');
assert.equal((fullMarkup.match(/is-required/g) || []).length, 6, 'Only the conditions and required consents are marked obligatory');
assert.equal((fullMarkup.match(/is-optional/g) || []).length, 3, 'Two Professional options and User marketing');
assert.equal((fullMarkup.match(/is-reading/g) || []).length, 2, 'Working PDN policy and platform privacy are for familiarization');
assert.equal((fullMarkup.match(/is-reference/g) || []).length, 1, 'RKN is reference material, not consent');
assert.equal((fullMarkup.match(/data-registry-version="/g) || []).length, 12, 'All 12 entries have edition fields');
assert.equal((fullMarkup.match(/data-registry-date="/g) || []).length, 12, 'All 12 source entries have publication dates');
assert.equal((fullMarkup.match(/<span class="admin-pill active">Правовой<\/span>/g) || []).length, 8, 'Legal documents reuse existing active pill');
assert.equal((fullMarkup.match(/<span class="admin-pill working">Рабочий<\/span>/g) || []).length, 4, 'Working documents reuse existing pill with teal state');
assert.doesNotMatch(css, /admin-registry-document-status/, 'No separate UI component is introduced');
assert.match(css, /admin-registry-documents-table \.admin-pill\.working\{background:#FFF4C7;color:#765600\}/, 'Working uses the warm brand yellow instead of teal');
assert.match(css, /admin-registry-purpose\.is-platform\{color:#16191B\}/, 'Legal document purposes are black');
assert.match(css, /admin-registry-purpose\.is-working\{color:#828A8F\}/, 'Professional-supplied template purposes are grey');
assert.equal((firstSection.match(/admin-registry-purpose is-[a-z]+ is-working/g) || []).length, 4, 'Working templates have muted purpose labels');
assert.equal((firstSection.match(/admin-registry-purpose is-[a-z]+ is-platform/g) || []).length, 6, 'Platform ↔ Professional purposes have dark labels');
assert.equal((secondSection.match(/admin-registry-purpose is-[a-z]+ is-platform/g) || []).length, 2, 'Both platform ↔ User purposes remain dark');
assert.match(fullMarkup, /data-registry-date="privacy-policy">16\.09\.2026<\/time>/, 'Legal document issue date comes from its actual published header');
assert.match(fullMarkup, /data-registry-date="saas-agreement">18\.09\.2026<\/time>/, 'Edition change date is shown in catalog');
assert.match(fullMarkup, /data-registry-date="user-document-pdn-policy">18\.09\.2026<\/time>/, 'User source file introduction date is grounded in Git');
assert.match(fullMarkup, /data-registry-date="rkn-notification-guide-template">03\.10\.2026<\/time>/, 'RKN source last edit date is grounded in Git');
assert.doesNotMatch(fullMarkup, /Подписать|подписать|Надо подписать/, 'Purpose is not an action and does not claim an existing signature');
assert.match(fullMarkup, /admin-registry-title">Политика ПДН<\/strong>/, 'Short label is visible in registry');
assert.match(fullMarkup, /admin-registry-title">Оферта<\/strong>/, 'Long legal heading never appears in the row');
assert.match(fullMarkup, /data-registry-version="privacy-policy">1\.1<\/span>/, 'Initial legal revision comes from source');
assert.match(fullMarkup, /data-registry-version="saas-agreement">1\.2<\/span>/, 'Second legal revision comes from source');
assert.equal(versionNodes[0].textContent, '1.1');
assert.equal(versionNodes[1].textContent, '1.2');
for (const key of ['user-document-pdn-policy', 'user-document-pdn-consent', 'user-document-messages-consent']) {
  assert.match(fullMarkup, new RegExp('data-registry-version="' + key + '">1<'), key + ' starts with its source version, not a dash');
}
assert.match(fullMarkup, /data-registry-version="rkn-notification-guide-template">—<\/span>/, 'Only the unversioned RKN guide retains a dash');
assert.match(secondSection, /data-registry-document="account-terms"[^>]*disabled aria-disabled="true"/, 'Canonical User agreement waits for its real text');

await Promise.resolve();
fulfillAccountTerms({
  key: 'account-terms',
  type: 'ACCOUNT_TERMS',
  title: 'Условия использования учётной записи',
  version: 1,
  content: 'Условия использования учётной записи\nРедакция 1 от 21.09.2026\nДействующий юридический текст',
  publishedAt: '2026-11-11T08:00:00.000Z',
});
fulfillCurrent([
  { key: 'privacy-policy', title: 'Политика', type: 'PRIVACY_POLICY', version: 17, content: 'Book — юридическая редакция 1.3 от 11.11.2026', publishedAt: '2026-11-12T00:00:00.000Z' },
  { key: 'user-document-pdn-policy', title: 'Условия ПДН', type: 'USER_DOCUMENT_BASE', version: 4, content: 'Current User edition from the database', publishedAt: '2026-11-04T13:30:00.000Z' },
  { key: 'user-document-pdn-consent', title: 'Согласие ПДН', type: 'USER_DOCUMENT_BASE', version: 2, content: 'Current consent base', publishedAt: '2026-11-05T08:00:00.000Z' },
  { key: 'user-document-messages-consent', title: 'Маркетинг', type: 'USER_DOCUMENT_BASE', version: 3, content: 'Current marketing base', publishedAt: '2026-11-06T08:00:00.000Z' },
  { key: 'platform-privacy-policy', title: 'Политика обработки персональных данных', type: 'PRIVACY_POLICY', version: 1, content: 'Политика обработки персональных данных\nРедакция 1 от 01.11.2026\nЕдиный текст из базы', publishedAt: '2026-11-01T00:00:00.000Z' },
]);
// Let the isolated VM Promise continuation complete after the mocked HTTP reply.
await new Promise((resolve) => setImmediate(resolve));
assert.equal(versionNodes[0].textContent, '1.3', 'Latest actual legal revision, not technical index 17');
assert.equal(versionNodes[9].textContent, '—', 'Missing current DB edition does not become a fake version');
assert.equal(versionNodes[6].textContent, '4', 'First working template shows its published platform version');
assert.equal(versionNodes[7].textContent, '2', 'Second working template shows its own published platform version');
assert.equal(versionNodes[8].textContent, '3', 'Third working template shows its own published platform version');
assert.equal(dateNodes[0].textContent, '11.11.2026', 'Document header revision date takes priority over technical save timestamp');
assert.equal(dateNodes[6].textContent, '04.11.2026', 'User template date is taken from the persisted publishedAt');
assert.equal(dateNodes[9].textContent, '03.10.2026', 'RKN source date remains available without preview read endpoint');
assert.equal(versionNodes[10].textContent, '1', 'Global User terms edition comes from canonical source');
assert.equal(versionNodes[11].textContent, '1', 'Global User privacy edition comes from canonical metadata');
assert.equal(dateNodes[10].textContent, '21.09.2026', 'Legal edition date precedes technical publish timestamp');
assert.equal(dateNodes[11].textContent, '01.11.2026', 'Privacy issue date comes from the source policy');
assert.equal(buttons[10].disabled, false, 'Global User document becomes available with real source text');
assert.equal(buttons[11].disabled, false, 'Privacy document opens only after core returns real body');
buttons[0].click();
assert.equal(openedEditors.length, 1, 'Document icon opens the editor, not the viewer');
assert.equal(openedEditors[0].application, 'professional');
clickSourceRow('privacy-policy');
assert.equal(opened.length, 1, 'Desktop clicking a row opens one right-side viewer');
assert.equal(opened[0].className, 'admin-drawer-backdrop admin-document-drawer-backdrop');
assert.match(opened[0].innerHTML, /admin-document-reading/);
assert.match(opened[0].innerHTML, /admin-document-head-version/, 'Version and title stay in the fixed reader header');
assert.doesNotMatch(opened[0].innerHTML, /<h3>Документ<\/h3>/, 'No duplicated technical title in desktop header');
assert.match(opened[0].innerHTML, /Политика \/ 1\.3 \/ Book — юридическая редакция 1\.3/, 'Viewer opens current persisted legal revision and content');
assert.ok(subscribed > 0);

fulfillHistory(history);
await rendered;
assert.equal((historyHost.innerHTML.match(/data-registry-history="/g) || []).length, 2, 'All legal events are preserved');
assert.match(historyHost.innerHTML, /<th>Документ<\/th><th>Версия<\/th><th>Аккаунт<\/th><th>Дата<\/th><th>Событие<\/th><th aria-label="Открыть"><\/th>/, 'History follows requested six-column order');
assert.match(historyHost.innerHTML, /admin-registry-title">Оферта<\/strong>/, 'History uses short titles without modifying signed data');
assert.match(historyHost.innerHTML, /data-label="Версия"><span class="admin-registry-version" title="Архивная копия 3">1\.2<\/span>/, 'Signed legal edition 1.2 is distinct from technical archive index 3');
assert.match(historyHost.innerHTML, /admin-registry-history-moment[^>]*>[\s\S]*?admin-registry-event-date">11\.11\.2026<\/span>[\s\S]*?admin-registry-event-time">\d{2}:\d{2}<\/small>/, 'Event date is above the time');
assert.match(historyHost.innerHTML, /admin-registry-account-email">professional@example\.test<\/span><small class="admin-registry-account-app">Professional<\/small>/, 'Account email is above muted app label');
assert.match(css, /admin-registry-history-account\{display:flex;flex-direction:column/, 'Account stays in two rows');
assert.match(css, /admin-registry-history-moment\{display:flex;flex-direction:column/, 'Date stays above muted time');
assert.match(css, /admin-registry-history-table th:nth-child\(6\)[\s\S]*?\{width:6%;min-width:0\}/, 'Only viewer icon belongs in the far-right column');
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
isMobile = false;
clickSourceRow('account-terms');
assert.equal(opened.length, 2, 'User terms open from the real legal source, not an empty placeholder');
assert.match(opened[1].innerHTML, /Условия использования учётной записи \/ 1 \/ Условия/, 'User terms snapshot opens in the document reader');
clickSourceRow('platform-privacy-policy');
assert.equal(opened.length, 3, 'The second User legal document opens from core storage');
assert.match(opened[2].innerHTML, /Политика обработки персональных данных \/ 1 \/ Политика/, 'Privacy viewer reads the database version');
clickSourceRow('user-document-pdn-policy');
assert.equal(opened.length, 4, 'Working template opens published platform source');
assert.match(opened[3].innerHTML, /Условия ПДН \/ 4 \/ Current User edition from the database/, 'Working document reader shows core template version, not Professional custom version');

// Regression: the real Amvera Admin staging preview runs against a backend
// that has platform-bases but may not have /saas-admin/document-registry/current.
for (const key of ['user-document-pdn-policy', 'user-document-pdn-consent', 'user-document-messages-consent']) {
  versionNodes.find((node) => node.dataset.registryVersion === key).textContent = '…';
}
const oldBackendRender = registry.renderDocumentRegistry(root, {
  escapeHtml,
  setTitle: (value) => { title = value; },
  loadHistory: () => Promise.resolve([]),
  loadCurrentDocuments: () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })),
  loadWorkingTemplates: () => Promise.resolve([
    { key: 'user-document-pdn-policy', title: 'Политика ПДН', version: 7, content: 'Server policy base' },
    { key: 'user-document-pdn-consent', title: 'Согласие ПДН', version: 5, content: 'Server consent base' },
    { key: 'user-document-messages-consent', title: 'Маркетинг', version: 6, content: 'Server marketing base' },
  ]),
  loadAccountTerms: () => Promise.resolve(null),
});
await oldBackendRender;
await new Promise((resolve) => setImmediate(resolve));
assert.equal(versionNodes[6].textContent, '7', 'Old backend: source policy version loads from existing endpoint');
assert.equal(versionNodes[7].textContent, '5', 'Old backend: source consent version loads from existing endpoint');
assert.equal(versionNodes[8].textContent, '6', 'Old backend: source marketing version loads from existing endpoint');
assert.equal(versionNodes[9].textContent, '—', 'RKN guide remains unversioned');
assert.equal(dateNodes[6].textContent, '04.11.2026', 'Fallback must not replace original source date with a tenant edit');
console.log('Admin Document Registry: Professional 10 (6 legal + 4 working), User 2 legal, canonical DB sources, shared geometry PASS');
