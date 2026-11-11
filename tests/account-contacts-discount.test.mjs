import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { resolvePersonPriceCondition } from '../core/loyalty/price-condition.js';

// Exercise the actual production projection and AccountContactsService method,
// without a database or copies of the discount calculation in this test.
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const service = read('server/src/account-contacts/account-contacts.service.ts');
const deposits = read('server/src/loyalty/deposit-state.ts');
const controller = read('server/src/account-contacts/account-contacts.controller.ts');

function between(source, from, to) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, 'Expected source block: ' + from);
  return source.slice(start, end);
}

const accountHelpers = between(service, 'function text(value: unknown)', 'function profilePhones(');
const publicCardHelpers = between(service, 'function publicCardAppearance(', 'function publicDiscountText(');
const depositHelpers = between(deposits, 'function objectValue(value: unknown)', 'export function depositPersonKey(');
const depositProjection = between(deposits, 'export function depositPriceSourcesFromRows(', 'export async function activeDepositPriceSources(');
const contactProjection = between(service, 'function personBelongsToAccount(', 'function completedRecord(');
const contactsMethod = between(service, '  private async accountDiscounts(', '  private async projectedRecords(')
  .replace('  private async accountDiscounts(', 'async function accountDiscounts(');

const fixtureSource = [accountHelpers, publicCardHelpers, depositHelpers, depositProjection, contactProjection, contactsMethod]
  .join('\n').replaceAll('export function ', 'function ');
const runnable = stripTypeScriptTypes(fixtureSource, { mode: 'strip' });
const runtime = runInNewContext(
  runnable + '\n({ accountDiscounts, effectiveDiscountForPerson, personBelongsToAccount, depositPriceSourcesFromRows })',
  { resolvePersonPriceCondition },
);

const me = { key: 'person-me', accounts: ['account-me'], phones: ['79990000000'], discountPercent: 12 };
const other = { key: 'person-other', accounts: ['account-other'], phones: ['79991111111'], discountPercent: 47 };
const program = {
  tenantId: 'pro-a', personKey: me.key, status: 'active',
  depositId: 'deposit-1', programId: 'program-1', programName: 'Сезонная программа',
  terms: { termMode: 'dated', termStartDate: '2020-01-01', termEndDate: '2099-12-31', benefitType: 'discount', benefitValue: 20 },
};
const at = new Date('2026-11-09T12:00:00.000Z');
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.deepEqual(plain(runtime.effectiveDiscountForPerson(me, [], at)),
  { percent: 12, source: 'personal', programName: '' },
  'Manual discount is passed from Person without duplicating its calculation');

assert.deepEqual(plain(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [program], at)),
  { percent: 20, source: 'program', programName: 'Сезонная программа' },
  'Active assigned program discount is passed, without copying it to Person');

assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [
  { ...program, terms: { ...program.terms, termEndDate: '2000-01-01' } },
], at), null, 'Expired program discount disappears even before status housekeeping');

assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [
  { ...program, status: 'expired' },
], at), null, 'Ended instance does not leave a stale percent');
assert.equal(runtime.effectiveDiscountForPerson({ ...me, discountPercent: 0 }, [], at), null,
  'Empty manual discount field stays empty, not 0%');
assert.equal(runtime.effectiveDiscountForPerson(me, [program], at), null,
  'Two conflicting discount sources must not be silently added or selected');
assert.equal(runtime.personBelongsToAccount({ ...other, phones: me.phones }, 'account-me', me.phones[0]), false,
  'Another explicitly linked account cannot inherit a discount through matching phone');

let personRows = [
  { tenantId: 'pro-a', key: me.key, data: me },
  { tenantId: 'pro-a', key: other.key, data: other },
  { tenantId: 'pro-b', key: 'other-b', data: { ...other, key: 'other-b' } },
];
let depositRows = [];
let personReads = 0;
let depositReads = 0;
const prisma = {
  person: { async findMany({ where }) {
    personReads += 1;
    return personRows.filter((row) => where.tenantId.in.includes(row.tenantId));
  } },
  loyaltyDepositInstance: { async findMany({ where }) {
    depositReads += 1;
    return depositRows.filter((row) => where.tenantId.in.includes(row.tenantId) && row.status === 'active');
  } },
};
const listDiscounts = () => runtime.accountDiscounts.call({ prisma }, 'account-me', '79990000000', ['pro-a', 'pro-b']);

let result = await listDiscounts();
assert.deepEqual(plain(result.get('pro-a')), { percent: 12, source: 'personal', programName: '' });
assert.equal(result.get('pro-b'), null, 'Unrelated professional must not reveal another Person discount');
assert.equal(personReads, 1, 'Single batch read of Person');
assert.equal(depositReads, 1, 'Single batch read of assigned programs');

personRows = personRows.map((row) => row.key === me.key
  ? { ...row, data: { ...me, discountPercent: 0 } } : row);
depositRows = [program];
result = await listDiscounts();
assert.deepEqual(plain(result.get('pro-a')),
  { percent: 20, source: 'program', programName: 'Сезонная программа' });

depositRows = [{ ...program, terms: { ...program.terms, termEndDate: '2000-01-01' } }];
result = await listDiscounts();
assert.equal(result.get('pro-a'), null, 'Program ended: discount field is cleared on the next API read');

depositRows = [];
personRows = [
  { tenantId: 'pro-a', key: 'ambiguous-1', data: { key: 'ambiguous-1', phones: me.phones, discountPercent: 10 } },
  { tenantId: 'pro-a', key: 'ambiguous-2', data: { key: 'ambiguous-2', phones: me.phones, discountPercent: 30 } },
];
result = await listDiscounts();
assert.equal(result.get('pro-a'), null, 'Ambiguous identity must not disclose any discount');

// The already-assigned program must expose its actual active discount as
// a numeric field without changing the original nominal or balance.
const visibleMethod = between(service, '  private async visibleDepositSummaries(', '  private async programSummaries(')
  .replace('  private async visibleDepositSummaries(', 'async function visibleDepositSummaries(');
const summariesMethod = between(service, '  private async programSummaries(', '  // Both list and detail')
  .replace('  private async programSummaries(', 'async function programSummaries(');
const presentationHelpers = between(service, 'function publicProgramCard(', '// A discount may be shown');
const programRuntime = runInNewContext(
  stripTypeScriptTypes(accountHelpers + '\n' + publicCardHelpers + '\n' + presentationHelpers + '\n'
    + visibleMethod + '\n' + summariesMethod, { mode: 'strip' })
    + '\n({ visibleDepositSummaries, programSummaries })',
  {
    depositPriceSourcesFromRows: runtime.depositPriceSourcesFromRows,
    expireDepositInstances: async () => {},
  },
);
let assignedRows = [{
  ...program, initialAmount: 15000, balance: 12000,
}];
let programData = {
  name: 'Сезонная программа', amount: 30000, termRule: '12 месяцев',
  benefit: 'Скидка 20%', status: 'active', showToAll: true,
};
const depositAppearance = {
  gradient: { from: '#2C2A28', mid: '#817A73', to: '#D7D1CA', angle: 125 },
  lines: [
    { field: 'uei', zone: 'left', size: 's' },
    { field: 'title', zone: 'full', size: 'xl', bold: true },
    { field: 'metaLeft', zone: 'left', size: 'm' },
    { field: 'metaRight', zone: 'right', size: 'l' },
    { field: 'totalSpent', zone: 'right', size: 'm' },
  ],
};
const personalAppearance = {
  lines: [
    { field: 'title', zone: 'full', bold: true },
    { field: 'metaRight', zone: 'right', size: 'l' },
  ],
};
let templates = [
  { scope: 'loyalty-deposit', appearance: depositAppearance, photo: 'https://example.test/deposit.jpg', photoPosition: '25% 70%' },
  { scope: 'loyalty-personal-account', appearance: personalAppearance, photo: 'https://example.test/account.jpg', photoPosition: '30% 60%' },
];
let personalAccountView = null;
const context = {
  prisma: {
    loyaltyDepositInstance: { findMany: async () => assignedRows },
    loyaltyDepositProgram: {
      findMany: async () => [{ programId: program.programId, data: programData }],
    },
    businessAuxiliaryState: {
      findUnique: async () => ({ data: { cardAppearanceTemplates: templates } }),
    },
    ueiState: {
      findUnique: async () => ({ data: { relations: { ['loyalty-deposit-program:' + program.programId]: '0025' } } }),
    },
  },
  personalAccounts: { endUserSummary: async () => personalAccountView },
};
context.visibleDepositSummaries = programRuntime.visibleDepositSummaries.bind(context);
const assignedPrograms = () => programRuntime.programSummaries.call(
  context, 'pro-a', { key: me.key, name: 'Анна', surname: 'Тестовая', totalSpent: 1000000 },
);

let assigned = await assignedPrograms();
assert.equal(assigned.length, 1);
assert.deepEqual(plain(assigned[0].card.appearance.gradient), depositAppearance.gradient);
assert.deepEqual(plain(assigned[0].card.appearance.lines.slice(0, 4)), depositAppearance.lines.slice(0, 4),
  'Saved Professional card rows and positions are preserved');
assert.equal(assigned[0].card.appearance.lines[4].field, '',
  'Internal Person field keys must not reach User');
assert.equal(assigned[0].card.photo, 'https://example.test/deposit.jpg');
assert.equal(assigned[0].card.photoPosition, '25% 70%');
assert.deepEqual(plain(assigned[0].card.fields), [
  { value: 'uei', label: 'UEI', text: '0025' },
  { value: 'title', label: 'Название', text: 'Сезонная программа' },
  { value: 'metaLeft', label: 'Данные слева', text: 'Скидка 20%' },
  { value: 'metaRight', label: 'Данные справа', text: '15 000 ₽' },
], 'Saved layout uses the amount assigned to this person, not the catalog nominal');
assert.doesNotMatch(JSON.stringify(assigned[0].card), /totalSpent|1000000|private/i,
  'Never serialize internal customer spend to User');

personalAccountView = { balance: 1800, debtTotal: 0 };
assigned = await assignedPrograms();
assert.equal(assigned.length, 2, 'Visible Personal Account also has a program card');
assert.equal(assigned[0].type, 'personal-account');
assert.deepEqual(plain(assigned[0].card.fields), [
  { value: 'title', label: 'Название', text: 'Анна Тестовая' },
  { value: 'metaRight', label: 'Данные справа', text: '1 800 ₽' },
]);
assert.equal(assigned[0].card.photoPosition, '30% 60%');
personalAccountView = null;
assigned = await assignedPrograms();
assert.equal(assigned.length, 1, 'Hidden Personal Account is not transferred to User');

programData = { ...programData, showToAll: false };
assigned = await assignedPrograms();
assert.equal(assigned.length, 0, 'Existing program visibility setting remains authoritative');
assignedRows = [{ ...assignedRows[0], terms: {
  ...program.terms, presentation: { visibleToPerson: true },
} }];
assigned = await assignedPrograms();
assert.equal(assigned.length, 1, 'Existing person-specific visibility override is respected');
programData = { ...programData, showToAll: true };
assignedRows = [{ ...assignedRows[0], terms: program.terms }];

templates = [];
assigned = await assignedPrograms();
assert.deepEqual(plain(assigned[0].card), {
  appearance: {}, fields: [], photo: '', photoPosition: '50% 50%',
}, 'Missing Professional template is not replaced by an invented Core template');
templates = [{ scope: 'loyalty-deposit', appearance: depositAppearance, photo: 'https://example.test/deposit.jpg', photoPosition: '25% 70%' }];
assert.equal(assigned[0].discountPercent, 20, 'Program card receives numeric active discount');
assert.equal(assigned[0].fundedAmount, 15000, 'Original program nominal is unchanged');
assert.equal(assigned[0].balance, 12000, 'Original program balance is unchanged');
assert.equal(assigned[0].terms.benefit, '', 'Existing program terms remain as before');

assignedRows = [{
  ...assignedRows[0],
  terms: { ...program.terms, termEndDate: '2000-01-01' },
}];
assigned = await assignedPrograms();
assert.equal(assigned[0].discountPercent, 0, 'Expired program cannot advertise an active percent');
assert.equal(assigned[0].fundedAmount, 15000, 'Expiry does not rewrite nominal');

assignedRows = [{ ...assignedRows[0], status: 'closed', terms: program.terms }];
assigned = await assignedPrograms();
assert.equal(assigned[0].discountPercent, 0, 'Closed program cannot advertise an active percent');

assert.match(service, /depositPriceSourcesFromRows\(rows, personKey, new Date\(\)\)/,
  'Program discount and Person discount use one existing canonical source');


const profileProjection = between(service, 'function publicContactCard(', 'function participantMatchesAccount(');
const workplaceProjection = between(service, 'function workplaceCard(', '// A card is a projection of a SAVED Professional appearance');
const cardRuntime = runInNewContext(
  stripTypeScriptTypes(accountHelpers + '\n' + publicCardHelpers + '\n' + profileProjection + '\n' + workplaceProjection, { mode: 'strip' })
    + '\n({ profileCard, workplaceCard, publicContactCard })',
);
const publicProfile = {
  tenantId: 'pro-a', name: 'Вера', surname: 'Петрова', phone: '79990000111',
  phones: ['79990000111'], emails: ['owner@example.test'], telegrams: ['@owner'],
  profession: 'Парикмахер', about: 'Работаю с цветом', professionAbout: 'Колористика',
  experience: 'Более 20 лет', photo: 'owner.jpg', photoCropX: 33, photoCropY: 61,
  internalRevenue: 900000,
  cardAppearance: {
    gradient: { from: '#111111', to: '#999999', angle: 30 },
    lines: [
      { field: 'discount', zone: 'right', size: 'xl', bold: true },
      { field: 'name', zone: 'full', size: 'l' },
      { field: 'email', zone: 'left', color: 'white' },
      { field: 'professionAbout', zone: 'full' },
      { field: 'internalRevenue', zone: 'full' },
    ],
  },
};
const publicWorkplace = {
  tenantId: 'pro-a', key: 'space-a', name: 'Кабинет', city: 'Москва',
  address: 'Тверская, 7', phone: '+79990000222', currency: 'RUB',
  from: '10:00', to: '19:00', about: 'Тихое пространство',
  photo: 'room.jpg', photoCropX: 40, photoCropY: 55,
  privateCost: 200000,
  cardAppearance: {
    lines: [
      { field: 'discount', zone: 'right', size: 'l' },
      { field: 'address', zone: 'full', size: 'm' },
      { field: 'profileEmail', zone: 'left' },
      { field: 'workTime', zone: 'full' },
      { field: 'privateCost', zone: 'left' },
    ],
  },
};
const ownDiscount = { percent: 17.5, source: 'personal', programName: '' };
const projectedProfile = plain(cardRuntime.profileCard(publicProfile, [publicWorkplace], ownDiscount));
const projectedWorkplace = plain(cardRuntime.workplaceCard(publicWorkplace, publicProfile, ownDiscount));
assert.equal(projectedProfile.profile.card.fields.find((f) => f.value === 'discount').text, '17.5%');
assert.equal(projectedWorkplace.card.fields.find((f) => f.value === 'discount').text, '17.5%');
assert.equal(projectedProfile.profile.card.photoPosition, '33% 61%');
assert.equal(projectedWorkplace.card.photoPosition, '40% 55%');
assert.deepEqual(projectedProfile.profile.card.appearance.lines.slice(0, 2), publicProfile.cardAppearance.lines.slice(0, 2),
  'Public profile preserves exact saved placement and style');
assert.deepEqual(projectedWorkplace.card.appearance.lines.slice(0, 2), publicWorkplace.cardAppearance.lines.slice(0, 2),
  'Workplace preserves exact saved placement and style');
assert.equal(projectedProfile.profile.card.fields.find((f) => f.value === 'email').text, 'owner@example.test');
assert.equal(projectedProfile.profile.card.fields.find((f) => f.value === 'professionAbout').text, 'Колористика');
assert.equal(projectedWorkplace.card.fields.find((f) => f.value === 'address').text, 'Тверская, 7');
assert.equal(projectedWorkplace.card.fields.find((f) => f.value === 'profileEmail').text, 'owner@example.test');
assert.equal(projectedWorkplace.card.fields.find((f) => f.value === 'workTime').text, '10:00 - 19:00');
assert.equal(projectedProfile.profile.card.appearance.lines[4].field, '', 'Unknown private field is blanked');
assert.equal(projectedWorkplace.card.appearance.lines[4].field, '', 'Unknown workplace field is blanked');
assert.doesNotMatch(JSON.stringify(projectedProfile.profile.card), /internalRevenue|900000|privateCost/i);
assert.doesNotMatch(JSON.stringify(projectedWorkplace.card), /privateCost|200000|internalRevenue/i);
assert.equal(plain(cardRuntime.profileCard(publicProfile, [publicWorkplace], null)).profile.card.fields
  .find((f) => f.value === 'discount').text, '', 'Missing discount remains empty on profile');
assert.equal(plain(cardRuntime.workplaceCard(publicWorkplace, publicProfile, null)).card.fields
  .find((f) => f.value === 'discount').text, '', 'Missing discount remains empty on workplace');

// The field registries match every public value the Professional layout editor can select.
const profileKeys = [
  'workTime', 'workplaceName', 'name', 'firstName', 'surname', 'profession',
  'discount', 'phone', 'email', 'telegram', 'experience', 'about',
  'professionAbout', 'workplaceCount',
];
const workplaceKeys = [
  'workTime', 'workplaceName', 'city', 'address', 'workplacePhone', 'currency',
  'workplaceAbout', 'discount', 'profileName', 'profileFirstName',
  'profileSurname', 'profession', 'profilePhone', 'profileEmail',
  'profileTelegram', 'profileExperience', 'profileAbout', 'profileProfessionAbout',
];
const fullAppearance = (keys) => ({ lines: keys.map((field) => ({ field })) });
const fullyVisibleProfile = plain(cardRuntime.profileCard(
  { ...publicProfile, cardAppearance: fullAppearance(profileKeys) }, [publicWorkplace], ownDiscount,
));
const fullyVisibleWorkplace = plain(cardRuntime.workplaceCard(
  { ...publicWorkplace, cardAppearance: fullAppearance(workplaceKeys) }, publicProfile, ownDiscount,
));
assert.deepEqual(fullyVisibleProfile.profile.card.fields.map((f) => f.value), profileKeys);
assert.deepEqual(fullyVisibleWorkplace.card.fields.map((f) => f.value), workplaceKeys);
assert.equal(fullyVisibleProfile.profile.card.fields.find((f) => f.value === 'workplaceCount').text, '1');
assert.match(service, /profileCard\(profile, byWorkplaceTenant\.get\(tenantId\) \|\| \[\], discount\)/,
  'Contact list must project own discount in saved Profile card');
assert.match(service, /profileCard\(context\.profile, allWorkplaces, discount\)/,
  'Contact detail must project own discount in saved Profile card');
assert.match(service, /workplaceCard\(workplace, context\.profile, discount\)/,
  'Contact detail must project own discount in saved Workplace cards');

// Both existing endpoints must return the same shape; program assignment
// and existing program nominal/amount fields are not modified.
assert.match(controller, /@Get\(\)\s*list\(/);
assert.match(controller, /@Get\(':tenantId'\)\s*detail\(/);
assert.match(service, /const discount = discounts\.get\(tenantId\) \|\| null/);
assert.match(service, /const discount = discounts\.get\(context\.tenantId\) \|\| null/);
assert.match(service, /programs,\s*\};/);
assert.match(service, /fundedAmount: Number\(deposit\.fundedAmount \|\| 0\)/);
assert.match(service, /card: publicProgramCard\(templates, 'loyalty-deposit'/);
assert.match(service, /card: publicProgramCard\(templates, 'loyalty-personal-account'/);
assert.match(service, /businessAuxiliaryState\.findUnique\(/);
assert.match(service, /ueiState\.findUnique\(/);
assert.doesNotMatch(contactProjection, /workplace|scope:/i, 'Discount does not depend on a workplace');

console.log('Account contacts discount: personal, active program, expiry, no discount, identity and API contract PASS');
