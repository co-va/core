import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const people = readFileSync(new URL('../core/people/people.js', import.meta.url), 'utf8');
const personRecord = readFileSync(new URL('../core/people/record-creation.js', import.meta.url), 'utf8');
const records = readFileSync(new URL('../core/records/records.js', import.meta.url), 'utf8');
const procedureSelection = readFileSync(new URL('../core/service/procedures/selection.js', import.meta.url), 'utf8');
const programs = readFileSync(new URL('../core/people/programs.js', import.meta.url), 'utf8');
const viewState = readFileSync(new URL('../core/people/view-state.js', import.meta.url), 'utf8');
const v2 = ['z-stack.js','modal-portal.js','swipe.js','workspace-navigation.js'].map((file) => readFileSync(new URL(`../ui/v2/${file}`, import.meta.url), 'utf8')).join('\n');
const v2Css = readFileSync(new URL('../ui/v2/v2.css', import.meta.url), 'utf8');
const selectors = readFileSync(new URL('../ui/selectors/index.js', import.meta.url), 'utf8');
const selectorCss = readFileSync(new URL('../ui/selectors/selectors.css', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../ui/calendar/calendar.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const miniCard = readFileSync(new URL('../ui/cards/mini-card.js', import.meta.url), 'utf8');
const miniCardCss = readFileSync(new URL('../ui/cards/mini-card.css', import.meta.url), 'utf8');

// Clients Z1: one shared A/B/C/D contract, search by name/UEI and canonical list.
assert.match(people, /title:\s*'Клиенты'/);
assert.match(people, /kind:\s*'settings'/);
assert.match(people, /data-people-list-settings/);
assert.match(people, /Поиск по имени или UEI/);
assert.match(people, /return v2ListEntries\(items\.map/);
assert.match(people, /v2ListEntry\(\{/);
assert.match(people, /overline:\s*display\.uei/);
assert.match(people, /title:\s*display\.name/);
assert.match(people, /subtitle:\s*display\.phone/);
assert.match(people, /className:\s*'list-entry--record-person'/);

// A1: Sort / Filter / View / Excel. UEI sorting is a first-class option.
assert.match(people, /button\('Сортировка'/);
assert.match(people, /button\('Фильтр'/);
assert.match(people, /button\('Вид'/);
assert.match(people, /button\('Excel'/);
assert.match(people, /\['ueiAsc', 'UEI ↑'\]/);
assert.match(people, /\['ueiDesc', 'UEI ↓'\]/);
assert.match(viewState, /'ueiAsc'/);
assert.match(viewState, /'ueiDesc'/);
assert.match(viewState, /gender:/);
assert.match(viewState, /birthday:/);
assert.match(viewState, /tag:/);
assert.match(viewState, /tagColor:/);
assert.match(viewState, /noEmail:/);
assert.match(viewState, /noVisits:/);
assert.match(people, /label: 'Пол'/);
assert.match(people, /label: 'День рождения'/);
assert.match(people, /label: 'Ярлык'/);
assert.match(people, /label: 'Окраска ярлыка'/);
assert.match(people, /label: 'Почта'/);
assert.match(people, /label: 'Посещения'/);
assert.match(people, /Выгрузить/);
assert.doesNotMatch(people, /data-import|function importCsv/);
assert.match(readFileSync('settings/settings.js', 'utf8'), /Перенос данных/);

// C1: add from device contacts or quick manual X; never a create Z2.
assert.match(people, /Из контакта/);
assert.match(people, /Внести вручную/);
assert.match(people, /navigator\.contacts\.select\(\['name', 'tel'\]/);
assert.match(people, /button\('Из контакта', \{ variant: 'secondary'/);
assert.match(people, /button\('Внести вручную', \{ variant: 'secondary'/);
assert.match(people, /function openCreateX/);
assert.match(people, /personCreateForm\(preset\)/);
assert.doesNotMatch(people, /function openCreateZ2/);

// Client overview stays Z2. A opens one action X; Documents remain their existing X -> S flow.
assert.match(people, /mountV2ZLayer\([\s\S]*stack:\s*true/);
assert.match(people, /people-overview-layer/);
assert.match(people, /kind:\s*'avatar'/);
assert.match(people, /settingsTag:\s*true/);
assert.match(people, /data-person-settings/);
assert.doesNotMatch(people, /data-person-consents/);
assert.match(people, /function openPersonSettings/);
assert.match(people, /title: 'Настройки',[\s\S]*variant: 'x',[\s\S]*xRole: 'action'/);
assert.match(people, /button\('Документы'/);
assert.match(people, /button\('История'/);
assert.match(people, /button\('Записать', \{ data: 'data-person-settings-record' \}\)/);
assert.doesNotMatch(people, /button\('Запись', \{ variant: 'secondary', data: 'data-person-settings-record' \}\)/);
assert.match(people, /title: 'Документы \/ согласия', variant: 'x'/);
assert.match(people, /variant: 's'/);
assert.doesNotMatch(people, /openSharedProfileSettingsMenu\(/);
assert.doesNotMatch(people, /id: 'code', label: 'Код'/);

const personSettingsStart = people.indexOf('function openPersonSettings');
const personSettingsEnd = people.indexOf('function birthMonth', personSettingsStart);
const personSettings = people.slice(personSettingsStart, personSettingsEnd);
assert.doesNotMatch(personSettings, /Удалить|Коррект/);

// History is no longer embedded in the client body. It opens as Q: Q Header search + Q Body list.
const overviewStart = people.indexOf('async function renderPersonOverview');
const overviewEnd = people.indexOf('function openPersonRelationshipQ', overviewStart);
const overview = people.slice(overviewStart, overviewEnd);
assert.doesNotMatch(overview, /История|data-person-history/);
assert.match(people, /function openPersonHistoryQ/);
assert.match(people, /title: 'История'/);
assert.match(people, /variant: 'q'/);
assert.match(people, /data-v2-q-header-content/);
assert.match(people, /data-person-history-search/);
assert.match(people, /data-person-history-host/);
assert.match(people, /personHistoryMarkup\(sourceItems, query\)/);
assert.doesNotMatch(people, /data-person-history-filter/);
assert.match(people, /people-history-q/);

// Record action calls the one canonical Records Q with the known person; People owns no parallel steps.
assert.match(people, /openPersonRecordCreation\(\{ person \}\)/);
assert.match(personRecord, /openRecords\(\{/);
assert.match(personRecord, /context: 'person'/);
assert.match(personRecord, /person,/);
assert.doesNotMatch(personRecord, /openRecordCreationOwner|step: 'workplace'|step: 'procedures'|step: 'date'|step: 'time'|step: 'person'|step: 'confirmation'/);
assert.match(records, /openRecordCreationOwner\(\{/);
assert.match(records, /workplaces\.length === 1/);
assert.match(records, /step: 'workplace'/);
assert.match(records, /step: 'procedures'/);
assert.match(records, /step: 'date'/);
assert.match(records, /step: 'time'/);
assert.match(records, /step: 'person'/);
assert.match(records, /step: 'confirmation'/);
assert.match(records, /getWorkplaceWorkingDates/);
assert.match(records, /initCalendar\(calendar/);
assert.match(records, /recordCreationTimeRows\(rows/);
assert.match(records, /checkTimeAvailability\(/);
assert.match(records, /createRecord\(\{/);
assert.match(records, /owner\.commit\(\)/);
assert.doesNotMatch(records, /mountV2ZLayer|v2ZLayer\(/);
assert.match(procedureSelection, /procedureCostForWorkplace/);
assert.match(procedureSelection, /procedureWorkplaceAssignment/);

// Client card is canonical; its configured appearance is not duplicated in the client A menu.
assert.match(people, /data-person-card/);
assert.match(people, /entityVisualCard\(\{/);
assert.match(people, /personCardAppearance\(person\)/);
assert.match(people, /openEntityCardAppearanceQ\(root/);
assert.match(people, /allowPhoto: false/);
assert.doesNotMatch(people, /openPersonPhotoEditor/);
assert.doesNotMatch(people, /metricRail\(/);

// Z2 body keeps programs and optional linked finance; history moved out to its Q.
assert.match(programs, /v2Section\('Программы', entityCardRail\(programCards\)\)/);
assert.match(programs, /personalAccountVisualCard\(/);
assert.match(programs, /\.\.\.deposits\.map\(depositCard\)/);
assert.match(programs, /\.\.\.certificates\.map\(certificateCard\)/);
assert.match(programs, /\.\.\.subscriptions\.map\(subscriptionCard\)/);
assert.match(programs, /\.\.\.referrals\.map\(referralCard\)/);
assert.match(programs, /\.\.\.bonuses\.map\(bonusCard\)/);
assert.match(programs, /financeCards\.length \? v2Section\('Инвестиции \/ Займы'/);
assert.match(programs, /cashEntityCardAppearance\(/);
assert.match(programs, /cashEntityCardPhoto\(/);
assert.doesNotMatch(overview, /v2Section\('История'/);

// Program/finance cards and client data open Q, not another stacked Z.
assert.match(people, /function openPersonRelationshipQ/);
assert.match(people, /people-program-q/);
assert.match(people, /people-edit-q/);
assert.doesNotMatch(people, /people-edit-layer/);
assert.doesNotMatch(people, /data-person-z3-action/);

// Client Q editor stays unchanged: Save when dirty; Delete remains in the Q body.
const dataFieldsStart = people.indexOf('function personDataFields');
const dataFieldsEnd = people.indexOf('function formSnapshot', dataFieldsStart);
const dataFields = people.slice(dataFieldsStart, dataFieldsEnd);
assert.match(dataFields, /people-uei-editor/);
assert.match(dataFields, /uei\(ueiData\(person, all\)\)/);
assert.match(dataFields, /v2Section\('Персональные данные'/);
assert.match(dataFields, /v2Section\('Контактные данные'/);
assert.doesNotMatch(dataFields, /photoField\(/);
assert.match(people, /data-person-q-save/);
assert.match(people, /action\.hidden = !isDirty\(\)/);
assert.match(people, /button\('Удалить клиента', \{ type: 'button', variant: 'danger'/);
assert.doesNotMatch(people, /dirty \? 'Сохранить' : 'Удалить'/);
assert.match(people, /layer\.v2Close\?\.\(\);[\s\S]*callbacks\.onSaved/);
assert.doesNotMatch(people, /data-workspace-back-source/);

// D is always direct chat with the selected client and is never hidden by a client Q.
assert.match(people, /data-person-direct-chat/);
assert.doesNotMatch(people, /hideD/);
assert.match(core, /chatPersonKey/);
assert.match(core, /onDirectChat/);
assert.match(core, /data-workspace-d-action/);

const saveStart = people.indexOf('function savePersonData');
const saveEnd = people.indexOf('function deletePersonByKey', saveStart);
const saveBlock = people.slice(saveStart, saveEnd);
assert.doesNotMatch(saveBlock, /person\.photo\s*=/);

// Existing shared UI owners remain the only geometry/interaction owners.
assert.match(miniCard, /export function miniCardRail/);
assert.match(miniCardCss, /--mini-card-width:238px/);
assert.match(miniCardCss, /--mini-card-height:144px/);
assert.match(miniCardCss, /border:2px solid #111/);
assert.match(miniCardCss, /border-radius:16px/);
assert.match(miniCardCss, /padding:16px/);
assert.match(miniCardCss, /word-break:normal/);
assert.match(miniCardCss, /overflow-wrap:normal/);
assert.match(miniCardCss, /mini-card--surface-photo/);
assert.match(miniCardCss, /mini-card__context-action/);
assert.match(miniCard, /surface = 'default'/);
assert.match(miniCard, /actionLabel = ''/);
assert.doesNotMatch(people, /surface:\s*'photo'/);
assert.doesNotMatch(people, /actionLabel:\s*person\.photo/);

assert.match(selectors, /import \{ modal, mountModal \} from '\.\.\/modals\/index\.js'/);
assert.match(selectors, /variant: 'x'/);
assert.doesNotMatch(selectors, /document\.body\.appendChild\(surface\)/);
assert.doesNotMatch(selectorCss, /\.ui-selector\{[^}]*position:fixed/s);

assert.match(v2, /mountV2ZLayer\(root, html, \{ onClose = null, stack = false, dismissible = true \}/);
assert.match(v2, /const front = app\?\.querySelector\?\.\('\[data-v2-front\]'\)/);
assert.match(v2, /const host = front \|\| stage/);
assert.match(v2, /if \(!stack\) host\.querySelectorAll/);
assert.match(v2, /host\.appendChild\(node\)/);
assert.match(v2, /isTopmost/);
assert.match(v2, /function initV2LayerDismissGesture/);
assert.match(v2, /kind === 'top' \? Math\.min\(0, raw\) : Math\.max\(0, raw\)/);
assert.match(v2, /stopPointerPropagation/);
assert.match(v2, /resolved === 'technical'/);
assert.match(v2Css, /--v2-z-layer-shift/);
assert.match(calendar, /modalRoot\.v2Close\?\.\(\)/);

console.log('People layered UI architecture: OK');
