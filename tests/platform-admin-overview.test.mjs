import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { tariffBenefits, tariffHeadline, tariffNewBenefits } from '../landing/tariff-benefits.js';

const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../admin/admin.css', import.meta.url), 'utf8');
const commercialService = readFileSync(new URL('../server/src/saas-admin/commercial-catalog.service.ts', import.meta.url), 'utf8');
const landingTariffs = readFileSync(new URL('../landing/tariffs.js', import.meta.url), 'utf8');
const landingHtml = readFileSync(new URL('../landing/index.html', import.meta.url), 'utf8');
const adminService = readFileSync(new URL('../server/src/saas-admin/saas-admin.service.ts', import.meta.url), 'utf8');
const adminController = readFileSync(new URL('../server/src/saas-admin/saas-admin.controller.ts', import.meta.url), 'utf8');
const userSummaryStart = adminService.indexOf('async userAccountOverview()');
const userSummaryEnd = adminService.indexOf('async tenants()', userSummaryStart);
assert.ok(userSummaryStart !== -1 && userSummaryEnd > userSummaryStart);
const userSummaryCode = adminService.slice(userSummaryStart, userSummaryEnd);
assert.match(userSummaryCode, /FROM "Account"/, 'User registration metric reads account identities');
assert.match(userSummaryCode, /COUNT\(DISTINCT e\."subjectAccountId"\)/, 'User login metric counts distinct identities');
assert.match(userSummaryCode, /"profileData"->>'deletedAt'/, 'Deleted account tombstones excluded');
assert.doesNotMatch(userSummaryCode, /FROM "Person"|FROM "BookingRequest"|FROM "AccountContact"/, 'Guest contacts and bookings must not count as registered users');
assert.match(adminController, /@Controller\('saas-admin'\)[\s\S]*@UseGuards\(JwtAuthGuard, PlatformAdminGuard\)/);
assert.match(adminController, /@Get\('overview\/user-accounts'\)/);


const start = source.indexOf('let overviewWindowWeeks = 8;');
const end = source.indexOf('function openDeleteTenantModal(', start);
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
    { key: 'cabinet.people', status: 'READY' },
    { key: 'cabinet.chat', status: 'TESTING' },
    { key: 'cabinet.inventory.stock', status: 'NOT_READY' },
    { key: 'records.profile.personal-data', status: 'READY' },
    { key: 'records.journal.list', status: 'NOT_READY' },
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
  tariffBenefits, tariffHeadline, tariffNewBenefits,
  summarizeTariffReadiness: () => ({
    total: 1, ready: 0, testing: 1, notReady: 0, unknown: 0, percent: 0,
    rows: [{ key: 'cabinet.people', name: 'Контакты', included: true, status: 'TESTING' }],
  }),
  adminRequest: async () => { throw new Error('Preview backend does not have the new endpoint'); },
};
runInNewContext(source.slice(start, end) + '\nrenderOverview();', context);
assert.match(markup, /Состояние платформы/);
assert.match(markup, /<h3>Кабинет <span class="admin-overview-head-suffix">\/ Professional<\/span><\/h3>/);
assert.match(markup, /<h3>Записи <span class="admin-overview-head-suffix">\/ User<\/span><\/h3>/);
assert.match(markup, /Готовность функций <span class="admin-overview-head-suffix">\/ Инструменты<\/span>/);
assert.match(markup, /data-overview-tool-app="cabinet"/);
assert.match(markup, /data-overview-tool-app="records"/);
assert.doesNotMatch(markup, /data-overview-tariff="tariff.start"/,
  'Editable tariff configuration belongs to Tariffs, not Overview');
for (const serviceCopy of [
  'Аккаунты пользователей приложения, не контакты специалистов',
  'Статистика будет доступна после обновления API Core',
  'Главные показатели и вопросы, требующие внимания',
  'Профессиональные аккаунты и их рабочие режимы',
  'Каждый аккаунт отдельно, независимо от UEI',
  'Новые регистрации в приложении',
  'Подтверждённые входы; не вся активность',
  'Повторить',
  'Создан аккаунт и профиль',
  'Демонстрационный режим',
]) assert.ok(!markup.includes(serviceCopy), `Overview must not show service copy: ${serviceCopy}`);

assert.match(markup, /<span class="admin-overview-metric-label">Входили<\/span>/);
assert.match(markup, /С входом за 30 дней/);
assert.match(markup, /<span class="admin-overview-metric-hint">Всего аккаунтов<\/span>/);
assert.match(markup, /Пробный режим/);
assert.match(markup, /Рабочий режим/);
assert.match(markup, /Завершения регистрации/);
assert.match(markup, /За последние 30 дней/);
assert.match(commercialService, /isSaleable: byKey\.get\(key\)\?\.isSaleable === true/,
  'Tariff API reports the existing persisted publication switch');
assert.match(commercialService, /purchasable: index === 0 \|\| \(tier\.isSaleable === true && tier\.priceMinor > 0\)/,
  'Price alone cannot publish a paid tariff');
assert.match(landingTariffs, /offer\?\.published === true && offer\?\.purchasable === true/,
  'Landing respects the authoritative publication policy');
assert.match(landingHtml, /\.tariff-card\[hidden\]\{display:none\}/,
  'An unpublished paid tariff must not be visible on the landing page');
assert.match(source, /<header class="admin-toolbar">/, 'Shared desktop H must remain in shell');
assert.match(styles, /@media\(min-width:761px\)\{[\s\S]*?\.admin-shell\{height:100dvh;min-height:0;overflow:hidden\}/, 'Desktop shell must hold height to viewport');
assert.match(styles, /\.admin-main\{min-height:0;overflow-y:auto;/, 'Only dashboard content scrolls inside desktop shell');
assert.match(styles, /\.admin-toolbar\{position:relative;z-index:2;min-height:68px;/, 'H remains above content instead of scrolling away');

// Admin visual contract: pearl is the single approved warm accent, yellow marks READY only.
assert.match(styles, /\.admin-overview-bar\{[^}]*background:var\(--admin-pearl\)/, 'Overview bars use the same pearl as the document header');
assert.match(styles, /\.admin-overview-bar\.is-current\{background:var\(--admin-pearl\)\}/, 'Last overview bar does not revert to graphite');
assert.match(styles, /\.admin-overview-tool-counts \.is-ready,\.admin-overview-tool-track \.is-ready\{background:var\(--surface-dark\)\}/, 'Ready is canonical graphite');
assert.match(styles, /\.admin-overview-tool-counts \.is-testing,\.admin-overview-tool-track \.is-testing\{background:#FFFF00\}/, 'Testing is canonical yellow');
assert.match(styles, /\.admin-overview-tool-counts \.is-not-ready,\.admin-overview-tool-track \.is-not-ready\{background:var\(--admin-pearl\)\}/, 'Not ready uses approved pearl');

assert.match(styles, /\.admin-overview-tool-counts i\{width:12px;height:12px;border-radius:0;display:inline-block;flex:0 0 12px\}/, 'Readiness legend uses visible square markers, not circles');
assert.match(styles, /\.admin-shell \.admin-nav button\{\s*color:var\(--white\);/, 'All four sidebar navigation labels share the white text');
assert.doesNotMatch(styles, /\.admin-shell \.admin-nav button\[data-section="document-registry"\]/, 'Document Registry does not require a one-off nav color');
assert.match(styles, /\.admin-users-section \.admin-accounts-table thead th\{[^}]*height:44px;[^}]*background:var\(--admin-pearl\);[^}]*color:#41484F;[^}]*font-size:15px;[^}]*text-transform:uppercase;/, 'Users table headers match the document registry');
assert.match(styles, /\.admin-users-section \.admin-accounts-table tbody td\{border-bottom-color:var\(--admin-pearl\)\}/, 'Users row dividers match the shared pearl header');
assert.match(markup, /\u2014/, 'Unavailable User metrics must not claim zero');
assert.match(markup, /data-overview-tool-app="cabinet"/);
assert.match(markup, /data-overview-tool-app="records"/);
assert.match(markup, /<span class="admin-overview-metric-label">Зарегистрированы<\/span>\s*<strong[^>]*>3<\/strong>/, 'Only real registered non-owner accounts count');
assert.match(markup, /<span class="admin-overview-metric-label">LIVE<\/span>\s*<strong[^>]*>1<\/strong>/);
assert.match(markup, /<span class="admin-overview-metric-label">DEMO<\/span>\s*<strong[^>]*>2<\/strong>/);
assert.match(markup, /<span class="admin-overview-metric-label">Ожидают<\/span>\s*<strong[^>]*>1<\/strong>/);
assert.match(markup, /Новые регистрации/);
assert.doesNotMatch(markup, /Это не показатель активности в приложении/);
assert.match(markup, /Готово <strong>1<\/strong>/);
assert.match(markup, /Проверка <strong>1<\/strong>/);
assert.match(markup, /Не готово <strong>1<\/strong>/);
assert.match(markup, /Не готово <strong>1<\/strong>/, 'Readiness cards must show actual groups');
assert.doesNotMatch(markup, /Готово <strong>2<\/strong>/, 'Readiness counts must not combine apps');
assert.doesNotMatch(markup, /7 активных/, 'Dashboard cannot equate a record status with product activity');

// The tariff editor must explain the 30-day base, provide both editable bonus
// periods, and keep the instrument assignment in the existing Tools registry.
const tariffSource = `
overviewTariffData = {
  tiers: [
    {key:'tariff.start',name:'Start',priceMinor:0,connected:4,tools:[]},
    {key:'tariff.start-plus',name:'Start+',priceMinor:100000,isSaleable:false,connected:0,
      tools:[{key:'tool.loyalty.deposit',name:'Депозит'}],
      periods:[
        {months:1,paidDays:30,bonusPercent:0,bonusDays:0,accessDays:30},
        {months:6,paidDays:180,bonusPercent:20,bonusDays:36,accessDays:216},
        {months:12,paidDays:360,bonusPercent:50,bonusDays:180,accessDays:540},
      ]},
    {key:'tariff.pro',name:'Pro',priceMinor:0,isSaleable:false,connected:0,tools:[]},
  ]
};
overviewTariffStatus = 'ready';
overviewSelectedTariff = 'tariff.start-plus';
renderOverview();
`;
runInNewContext(tariffSource.replace(/renderOverview\(\);\s*$/, 'renderTariffs();'), context);
assert.match(markup, /Цена за 30 дней, ₽/, 'The tariff editor defines the monthly unit');
assert.match(markup, /data-overview-tariff-bonus="6"/);
assert.match(markup, /data-overview-tariff-bonus="12"/);
assert.match(markup, /180 оплаченных дней/, '6-month duration is explicitly paid days');
assert.match(markup, /\+36 дней в подарок/, '6-month bonus is explained without mental arithmetic');
assert.match(markup, /216 дней/, '6-month total access is 216 days');
assert.match(markup, /\+180 дней в подарок \(6 месяцев\)/, '12-month bonus equals another six months');
assert.match(markup, /540 дней/, '12-month total access is 540 days');
assert.match(markup, /Бонус увеличивает время доступа, а не уменьшает цену/, 'Bonuses are not price discounts');
assert.match(markup, /data-overview-tariff-save="tariff.start-plus"/, 'Price and bonuses have one save action for the selected tier');
assert.match(markup, /data-overview-tariff-price="tariff.start-plus"/, 'Start+ has a visible price input');
assert.match(markup, /data-overview-tariff-price="tariff.pro"/, 'Pro has a visible price input');
assert.doesNotMatch(markup, /Подключено: 4/, 'Offer cards do not confuse accounts with included benefits');
assert.match(markup, /data-overview-section="capabilities"/, 'Tools composition has one canonical editor');
assert.match(markup, /Состав и готовность/, 'Tariff detail shows tool statuses, not benefits alone');
assert.match(markup, /data-overview-tariff-publication/, 'Publication is an explicit action');
assert.match(markup, /admin-tariff-progress/, 'Progress track uses the existing Admin readiness palette');
assert.match(markup, /Контакты/, 'Tariff detail lists canonical tool names');
assert.match(markup, /Проверка/, 'Testing tools remain visibly incomplete');
assert.match(markup, /Не предлагается/, 'An unpublished paid tariff is not claimed saleable');

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
// A paid tariff can have its bonus periods configured before its price is approved.
// The server accepts priceMinor=0; it remains non-purchasable until priced and published.
let tariffDraftSave = null;
let savedDraft = null;
const draftPriceInput = { value: '', addEventListener() {} };
const draftBonus6 = { value: '20', addEventListener() {} };
const draftBonus12 = { value: '50', addEventListener() {} };
const draftMessage = { textContent: '', classList: { add() {}, remove() {} } };
const draftSaveButton = {
  dataset: { overviewTariffSave: 'tariff.start-plus' },
  disabled: false,
  addEventListener(eventName, handler) {
    if (eventName === 'click') tariffDraftSave = handler;
  },
};
const originalQueryOne = content.querySelector.bind(content);
const originalQueryAll = content.querySelectorAll.bind(content);
content.querySelector = (selector) => {
  if (selector === '[data-overview-tariff-price="tariff.start-plus"]') return draftPriceInput;
  if (selector === '[data-overview-tariff-bonus="6"]') return draftBonus6;
  if (selector === '[data-overview-tariff-bonus="12"]') return draftBonus12;
  if (selector === '[data-overview-tariff-message="tariff.start-plus"]') return draftMessage;
  return originalQueryOne(selector);
};
content.querySelectorAll = (selector) => {
  if (selector === '[data-overview-tariff-save]') return [draftSaveButton];
  if (selector === '[data-overview-tariff-bonus]') return [draftBonus6, draftBonus12];
  return originalQueryAll(selector);
};
context.updateTariffSettings = async (...args) => {
  savedDraft = args;
  return {
    tiers: [
      { key: 'tariff.start', name: 'Start', priceMinor: 0, tools: [] },
      { key: 'tariff.start-plus', name: 'Start+', priceMinor: 0, isSaleable: false, tools: [],
        periods: [{ months: 6, bonusPercent: 20 }, { months: 12, bonusPercent: 50 }] },
      { key: 'tariff.pro', name: 'Pro', priceMinor: 0, isSaleable: false, tools: [] },
    ],
  };
};
runInNewContext("overviewTariffData.tiers.find((tier) => tier.key === 'tariff.start-plus').priceMinor = 0; renderTariffs();", context);
assert.equal(typeof tariffDraftSave, 'function', 'Tariff save action is reachable');
await tariffDraftSave({ currentTarget: draftSaveButton });
assert.deepEqual(savedDraft, ['tariff.start-plus', 0, 20, 50],
  'Saving bonuses without an approved tariff price sends zero (not NaN) to Core');
assert.match(markup, /Цена не установлена/, 'Draft tariff remains visibly unpriced');
assert.match(markup, /Не предлагается/, 'Unpriced tariff is not advertised as saleable');

// Readiness is unknown until Core replies; it must not appear as an editable NOT_READY.
const adminCatalogCode = readFileSync(new URL('../admin/commercial-catalog.js', import.meta.url), 'utf8');
const readinessSelectCode = adminCatalogCode.slice(
  adminCatalogCode.indexOf('function readinessSelect('),
  adminCatalogCode.indexOf('function aggregateKeys(')
);
const isolatedReadinessSelect = runInNewContext(readinessSelectCode + '\nreadinessSelect', {
  readinessValue: (item) => item?.status || 'NOT_READY',
  readinessOptions: (value) => '<option value="READY"' + (value === 'READY' ? ' selected' : '') + '>Готово</option>',
  escapeHtml: (value) => String(value),
});
const unknownReadiness = isolatedReadinessSelect('cabinet.people', new Map(), 'status');
assert.match(unknownReadiness, /Нет данных/, 'Unloaded status must be explicitly unknown');
assert.match(unknownReadiness, / disabled>/, 'Unknown readiness may not be changed');
const knownReadiness = isolatedReadinessSelect('cabinet.people',
  new Map([['cabinet.people', { status: 'READY' }]]), 'status');
assert.doesNotMatch(knownReadiness, / disabled>/, 'Confirmed readiness becomes editable');
const hydrateReadinessCode = adminCatalogCode.slice(
  adminCatalogCode.indexOf('function hydrateReadiness('),
  adminCatalogCode.indexOf('function hydrateAllReadiness(')
);
const isolatedHydrateReadiness = runInNewContext(hydrateReadinessCode + '\nhydrateReadiness', {
  readinessByKey: (items) => new Map(items.map((item) => [item.key, item])),
  readinessValue: (item) => item?.status || 'NOT_READY',
});
const statusSelect = { dataset: { readinessKey: 'cabinet.people' }, value: '', disabled: true, title: '' };
const statusRoot = { querySelectorAll: (selector) => selector === '[data-readiness-key]' ? [statusSelect] : [] };
isolatedHydrateReadiness(statusRoot, []);
assert.equal(statusSelect.disabled, true, 'Empty API response cannot silently enable readiness editing');
assert.equal(statusSelect.value, '', 'Empty API response cannot fabricate NOT_READY');
isolatedHydrateReadiness(statusRoot, [{ key: 'cabinet.people', status: 'READY' }]);
assert.equal(statusSelect.disabled, false, 'Confirmed API data enables editing');
assert.equal(statusSelect.value, 'READY', 'Confirmed API state is rendered without inventing a default');

console.log('Platform Admin Overview data boundaries, labels and actions: PASS');
