import {
  button,
  collectLinks,
  details,
  collectRepeatedEntries,
  collectTags,
  emptyState,
  entityVisualCard,
  documentTile,
  documentTiles,
  escapeHtml,
  field,
  initLinks,
  initMonthDayPickers,
  initRepeatedFields,
  initTags,
  initUEI,
  links,
  list,
  modal,
  monthDayPicker,
  mountModal,
  mountV2ZLayer,
  page,
  repeatedField,
  select,
  setV2ZHeaderRows,
  shortDate,
  shortDateTime,
  tags,
  uei,
  v2ListEntry,
  v2ListEntries,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
  openEntityCardAppearanceQ,
} from '../../ui/ui.js';
import { applyUEI, detachUEI, getMembers, getOptions, getUEI } from '../uei.js';
import { getTags } from '../../settings/tags/data.js';
import { getDocuments } from '../../settings/documents/data.js';
import { getConsents } from '../../settings/documents/consents.js';
import { getAllPeople, getPeople, savePeople } from './data.js';
import { bindPersonCreateForm, personCreateForm } from './create.js';
import { personDisplay } from './presentation.js';
import { personCardAppearance, personCardFields } from './card-presentation.js';
import { getPersonHistory } from './history.js';
import { getPersonMetadata } from './metadata.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getPeopleFilters, getPeopleSortMode, setPeopleFilters, setPeopleSortMode } from './view-state.js';
import { buildPersonRelationshipSections } from './programs.js';
import { openPersonRecordCreation } from './record-creation.js';
import { canUseRealPersonalData } from '../access.js';

const name = (person) => [person?.name, person?.surname].filter(Boolean).join(' ').trim() || 'Без имени';
const money = (value) => new Intl.NumberFormat('ru-RU').format(Number(value || 0)) + ' ₽';
const initials = (person) => [person?.name, person?.surname].filter(Boolean).slice(0, 2).map((part) => String(part).slice(0, 1).toUpperCase()).join('') || '?';

function notifyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function sortItems(items, mode) {
  return [...items].sort((a, b) => {
    if (mode.startsWith('name')) {
      const compared = name(a).localeCompare(name(b), 'ru');
      return mode === 'nameDesc' ? -compared : compared;
    }
    if (mode.startsWith('uei')) {
      const compared = String(personDisplay(a).uei || '').localeCompare(String(personDisplay(b).uei || ''), 'ru', { numeric: true });
      return mode === 'ueiDesc' ? -compared : compared;
    }
    const av = getPersonMetadata(a.key).lastVisit ? Date.parse(getPersonMetadata(a.key).lastVisit) : 0;
    const bv = getPersonMetadata(b.key).lastVisit ? Date.parse(getPersonMetadata(b.key).lastVisit) : 0;
    return mode === 'lastDesc' ? bv - av : av - bv;
  });
}

function sortOptions() {
  return [
    ['nameAsc', 'Имя ↑'],
    ['nameDesc', 'Имя ↓'],
    ['ueiAsc', 'UEI ↑'],
    ['ueiDesc', 'UEI ↓'],
    ['lastAsc', 'Последнее посещение ↑'],
    ['lastDesc', 'Последнее посещение ↓'],
  ].map(([value, label]) => ({ value, label }));
}

function consentStatus(fact) {
  if (!fact) return 'Не подписано';
  if (fact.status === 'revoked') return 'Отозвано';
  if (fact.status === 'declined') return 'Не подписано';
  return 'Подписано';
}

function consentMoment(fact) {
  const value = fact?.eventAt || fact?.revokedAt || fact?.acceptedAt || fact?.createdAt || '';
  return shortDateTime(value,'—');
}

function consentSource(source) {
  if (source === 'online-booking') return 'Онлайн-запись';
  if (source === 'online-booking-registration') return 'Регистрация в системе';
  if (source === 'manual') return 'Вручную';
  return source || '—';
}

function consentEventTime(fact) {
  const value = Date.parse(fact?.eventAt || fact?.revokedAt || fact?.acceptedAt || fact?.createdAt || 0);
  return Number.isFinite(value) ? value : 0;
}

function canonicalPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function personIdentityMembers(person) {
  const all = getAllPeople();
  if (!person?.uei) return [person];
  const members = all.filter((item) => item.uei === person.uei);
  return members.length ? members : [person];
}

function personConsentFactMatches(person, fact) {
  const members = personIdentityMembers(person);
  const accounts = new Set(members.flatMap((item) => Array.isArray(item.accounts) ? item.accounts : []).map(String).filter(Boolean));
  const phones = new Set(members.flatMap((item) => Array.isArray(item.phones) ? item.phones : []).map(canonicalPhone).filter(Boolean));
  const emails = new Set(members.flatMap((item) => Array.isArray(item.emails) ? item.emails : []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean));
  const telegrams = new Set(members.flatMap((item) => Array.isArray(item.telegrams) ? item.telegrams : []).map((value) => String(value || '').trim()).filter(Boolean));
  if (fact?.subjectType === 'ACCOUNT') return accounts.has(String(fact.subjectKey || ''));
  if (fact?.subjectType !== 'CONTACT_POINT') return false;
  if (fact.contactType === 'PHONE') return phones.has(canonicalPhone(fact.contactValue));
  if (fact.contactType === 'EMAIL') return emails.has(String(fact.contactValue || '').trim().toLowerCase());
  if (fact.contactType === 'TELEGRAM') return telegrams.has(String(fact.contactValue || '').trim());
  return false;
}

function currentConsentFacts(person, documentId) {
  const relevant = getConsents().filter((fact) => fact.documentId === documentId && personConsentFactMatches(person, fact));
  const latestBySubject = new Map();
  for (const fact of relevant) {
    const key = `${fact.subjectType}:${fact.subjectKey}:${fact.documentId}`;
    const previous = latestBySubject.get(key);
    if (!previous || consentEventTime(fact) > consentEventTime(previous)) latestBySubject.set(key, fact);
  }
  return [...latestBySubject.values()];
}

function personConsentState(person, documentId) {
  const facts = currentConsentFacts(person, documentId);
  const active = facts.filter((fact) => fact.status === 'accepted').sort((a, b) => consentEventTime(b) - consentEventTime(a));
  const inactive = facts.filter((fact) => fact.status !== 'accepted').sort((a, b) => consentEventTime(b) - consentEventTime(a));
  return { active: active.length > 0, fact: active[0] || inactive[0] || null, count: facts.length };
}

function consentStatusState(state, fact) {
  if (state?.active) return 'signed';
  if (fact?.status === 'revoked') return 'revoked';
  return 'pending';
}

function personDocuments(person) {
  const documents = getDocuments().filter((item) => !item.hidden);
  const byId = new Map(documents.map((item) => [String(item.id || ''), item]));
  const relevantIds = new Set(getConsents()
    .filter((fact) => personConsentFactMatches(person, fact))
    .map((fact) => String(fact.documentId || ''))
    .filter(Boolean));
  return documents.filter((item) => item.personConsent || relevantIds.has(String(item.id || '')))
    .concat([...relevantIds].filter((id) => !byId.has(id)).map((id) => ({
      id, title: id, version: 1, text: '', personConsent: true,
    })));
}

function personDocumentTile(person, documentItem) {
  const state = personConsentState(person, documentItem.id);
  const fact = state.fact;
  return documentTile({
    title: documentItem.title || 'Документ',
    version: fact?.documentVersion || documentItem.version || 1,
    status: state.active ? 'Подписано' : consentStatus(fact),
    statusState: consentStatusState(state, fact),
    data: `data-person-document="${escapeHtml(documentItem.id)}"`,
    aria: `Открыть информацию о документе ${documentItem.title || ''}`,
  });
}

function openPersonDocumentInfo(root, person, documentId) {
  const documentItem = personDocuments(person).find((item) => String(item.id) === String(documentId));
  if (!documentItem) return null;
  const state = personConsentState(person, documentItem.id);
  const fact = state.fact;
  const status = state.active ? 'Подписано' : consentStatus(fact);
  const version = fact?.documentVersion || documentItem.version || 1;
  const scope = state.count > 1 ? `<div><span>Фактов</span><strong>${escapeHtml(state.count)}</strong></div>` : '';
  const html = `${documentTiles([documentTile({
      title: documentItem.title || 'Документ',
      version,
      status,
      statusState: consentStatusState(state, fact),
      interactive: false,
    })], { layout: 'rail' })}
    <div class="entity-details">
      <div><span>Статус</span><strong>${escapeHtml(status)}</strong></div>
      <div><span>Версия</span><strong>${escapeHtml(version)}</strong></div>
      <div><span>Дата</span><strong>${escapeHtml(consentMoment(fact))}</strong></div>
      <div><span>Источник</span><strong>${escapeHtml(consentSource(fact?.source))}</strong></div>
      ${scope}
    </div>
    ${fact ? '' : '<p class="muted">Подтверждение отсутствует.</p>'}`;
  return mountModal(root, modal(html, { title: documentItem.title || 'Документ', variant: 's', surface: 'app' }));
}

function openPersonDocuments(root, person) {
  const documents = personDocuments(person);
  const body = documents.length
    ? documentTiles(documents.map((item) => personDocumentTile(person, item)), { layout: 'rail' })
    : emptyState('Документов пока нет', 'Документы и согласия этого человека появятся здесь.');
  const layer = mountModal(root, modal(body, { title: 'Документы / согласия', variant: 'x', surface: 'app' }));
  layer?.querySelectorAll('[data-person-document]').forEach((node) => {
    node.addEventListener('click', () => openPersonDocumentInfo(root, person, node.dataset.personDocument));
  });
  return layer;
}

function historyItems(items = [], query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  if (!needle) return items;
  return items.filter((item) => {
    const kind = item.kind === 'finance' ? 'Продажа операция' : 'Запись';
    const amount = item.amount == null ? '' : money(item.amount);
    const moment = shortDateTime(item.occurredAt, '');
    return [kind, item.title || '', item.subtitle || '', amount, moment]
      .join(' ')
      .toLocaleLowerCase('ru')
      .includes(needle);
  });
}

function personHistoryMarkup(items = [], query = '') {
  const filtered = historyItems(items, query);
  if (!filtered.length) return emptyState(query ? 'Ничего не найдено' : 'Истории пока нет', query ? 'Измените запрос.' : 'Здесь появятся записи, продажи и связанные события.');
  return v2ListEntries(filtered.map((item, index) => v2ListEntry({
    overline: item.kind === 'finance' ? 'Продажа / операция' : 'Запись',
    title: item.title || (item.kind === 'finance' ? 'Финансовая операция' : 'Запись'),
    subtitle: item.subtitle || '',
    rightTop: item.amount == null ? shortDateTime(item.occurredAt, '') : money(item.amount),
    rightBottom: item.amount == null ? '' : shortDateTime(item.occurredAt, ''),
    interactive: true,
    initial: '',
    data: `data-person-history-item="${index}"`,
    aria: `Открыть ${item.title || 'событие'}`,
  })));
}

function personQContext(person, { c = null } = {}) {
  return workspaceHeaderContext({
    title: name(person),
    a: {
      kind: 'avatar',
      image: person.photo || '',
      initials: initials(person),
      settingsTag: true,
      data: 'data-person-settings',
      aria: `Настройки ${name(person)}`,
    },
    c,
    d: {
      kind: 'chat',
      data: 'data-person-direct-chat',
      aria: `Чат с ${name(person)}`,
    },
  });
}

function durationLabel(minutes = 0) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (!value) return '—';
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest} мин`;
  if (!rest) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

function paymentStateLabel(item = {}) {
  if (item.paymentState === 'paid') return 'Оплачено';
  if (item.paymentState === 'partial') return 'Частично оплачено';
  if (item.paymentState === 'unpaid') return 'К оплате';
  return '—';
}

function recordHistoryDetail(item = {}) {
  const recordBlock = v2Section('Запись', details([
    { label: 'Процедуры', value: item.procedures?.join(', ') || item.products?.join(', ') || item.title || '—' },
    { label: 'Запись создана', value: shortDateTime(item.createdAt, '—') },
    ...(item.provenance?.type === 'import' ? [{ label: 'Происхождение', value: 'Импорт' }, { label: 'Перенесено в CO-VA', value: shortDateTime(item.recordedAt, '—') }] : []),
    { label: 'Дата посещения', value: shortDate(item.appointmentDate, '—') },
    { label: 'Время', value: [item.from, item.to].filter(Boolean).join(' — ') || '—' },
    { label: 'Продолжительность', value: durationLabel(item.durationMinutes) },
    { label: 'Статус', value: item.subtitle || '—' },
  ]));

  const paymentRows = (Array.isArray(item.payments) ? item.payments : []).map((payment, index) => v2Section(
    item.payments.length > 1 ? `Оплата ${index + 1}` : 'Оплата',
    details([
      { label: 'Дата оплаты', value: shortDateTime(payment.occurredAt, '—') },
      { label: 'Сумма', value: money(payment.total) },
    ]),
  )).join('');
  const refundRows = (Array.isArray(item.refunds) ? item.refunds : []).map((refund, index) => v2Section(
    item.refunds.length > 1 ? `Возврат ${index + 1}` : 'Возврат',
    details([
      { label: 'Дата возврата', value: shortDateTime(refund.occurredAt, '—') },
      { label: 'Сумма', value: money(refund.total) },
    ]),
  )).join('');
  const paymentSummary = (item.payments?.length || item.refunds?.length || item.planTotal > 0)
    ? v2Section('Итог оплаты', details([
      { label: 'Статус', value: paymentStateLabel(item) },
      { label: 'Оплачено', value: money(item.paidAmount) },
      { label: 'К оплате', value: item.due == null ? 'Не указано' : money(item.due) },
    ]))
    : '';
  return `${recordBlock}${paymentRows}${refundRows}${paymentSummary}`;
}

function financeHistoryDetail(item = {}) {
  return v2Section('Операция', details([
    { label: 'Операция', value: item.title || 'Финансовая операция' },
    ...(item.subtitle ? [{ label: 'Описание', value: item.subtitle }] : []),
    { label: 'Дата', value: shortDateTime(item.occurredAt, '—') },
    ...(item.provenance?.type === 'import' ? [{ label: 'Происхождение', value: 'Импорт' }, { label: 'Перенесено в CO-VA', value: shortDateTime(item.recordedAt, '—') }] : []),
    { label: 'Сумма', value: money(item.amount) },
  ]));
}

function openPersonHistoryItemQ(root, person, item, options = {}) {
  const body = item.kind === 'record' ? recordHistoryDetail(item) : financeHistoryDetail(item);
  const layer = mountModal(root, modal(`${personQContext(person)}${body}`, {
    title: name(person),
    variant: 'q',
    surface: 'app',
    className: 'people-history-q',
  }));
  if (layer) bindPersonContext(layer, person, options);
  return layer;
}

export async function openPersonHistoryQ(root, person, options = {}) {
  const layer = mountModal(root, modal(`${personQContext(person)}<div data-person-history-host></div>`, {
    title: 'История',
    variant: 'q',
    surface: 'app',
    className: 'people-history-q',
  }));
  if (!layer) return null;
  const header = layer.querySelector('[data-v2-q-header-content]');
  if (header) {
    header.innerHTML = `<div class="people-history-search ui-search-field">
      ${field({ name: 'personHistorySearch', type: 'search', placeholder: 'Поиск', autocomplete: 'off', data: 'data-person-history-search' })}
      <div class="people-search-divider ui-search-divider" aria-hidden="true"></div>
    </div>`;
  }
  const host = layer.querySelector('[data-person-history-host]');
  const search = layer.querySelector('[data-person-history-search]');
  let sourceItems = [];
  const render = () => {
    const query = String(search?.value || '').trim();
    const items = historyItems(sourceItems, query);
    if (host) host.innerHTML = personHistoryMarkup(sourceItems, query);
    host?.querySelectorAll('[data-person-history-item]').forEach((node) => {
      node.addEventListener('click', () => {
        const item = items[Number(node.dataset.personHistoryItem)];
        if (item) openPersonHistoryItemQ(layer, person, item, options);
      });
    });
  };
  search?.addEventListener('input', render);
  bindPersonContext(layer, person, options);
  if (host) host.innerHTML = emptyState('История', 'Загружаем данные…');
  try {
    sourceItems = await getPersonHistory(person.key);
    render();
  } catch (error) {
    if (host) host.innerHTML = emptyState('История недоступна', error instanceof Error ? error.message : 'Не удалось загрузить историю.');
  }
  return layer;
}

function openPersonSettings(root, person, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Документы', { variant: 'secondary', data: 'data-person-settings-documents' })}
    ${button('История', { variant: 'secondary', data: 'data-person-settings-history' })}
    ${button('Записать', { data: 'data-person-settings-record' })}
  </div>`, {
    title: 'Настройки',
    variant: 'x',
    surface: 'app',
    xRole: 'action',
  }));
  if (!layer) return null;
  layer.querySelector('[data-person-settings-documents]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonDocuments(root, person);
  });
  layer.querySelector('[data-person-settings-history]')?.addEventListener('click', () => {
    layer.v2Close?.();
    void openPersonHistoryQ(root, person, options);
  });
  layer.querySelector('[data-person-settings-record]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openPersonRecordCreation({ person });
  });
  return layer;
}

function birthMonth(value = '') {
  const match = String(value || '').match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
  return match ? Number(match[1]) : 0;
}

function applyPeopleFilters(items = [], filters = getPeopleFilters()) {
  const tagsById = new Map(getTags().map((item) => [String(item.id), item]));
  const currentMonth = new Date().getMonth() + 1;
  return items.filter((person) => {
    if (filters.gender === 'none' && person.gender) return false;
    if (filters.gender && filters.gender !== 'none' && person.gender !== filters.gender) return false;
    if (filters.birthday === 'none' && person.birthDate) return false;
    if (filters.birthday === 'has' && !person.birthDate) return false;
    if (filters.birthday === 'month' && birthMonth(person.birthDate) !== currentMonth) return false;
    if (filters.tag && !(person.tags || []).includes(filters.tag)) return false;
    if (filters.tagColor && !(person.tags || []).some((id) => tagsById.get(String(id))?.color === filters.tagColor)) return false;
    if (filters.noEmail === 'yes' && (person.emails || []).some((value) => String(value || '').trim())) return false;
    if (filters.noVisits === 'yes' && getPersonMetadata(person.key).recordCount > 0) return false;
    return true;
  });
}

function tagFilterOptions() {
  return [{ value: '', label: 'Все ярлыки' }, ...getTags().map((item) => ({ value: String(item.id), label: item.name }))];
}

function tagColorOptions() {
  const byColor = new Map();
  for (const tag of getTags()) {
    const color = String(tag.color || '').trim();
    if (!color) continue;
    const names = byColor.get(color) || [];
    names.push(tag.name);
    byColor.set(color, names);
  }
  return [{ value: '', label: 'Любая окраска' }, ...[...byColor.entries()].map(([value, names]) => ({
    value,
    label: names.join(' · '),
  }))];
}

function filterPeople(items, query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  if (!needle) return items;
  return items.filter((person) => {
    const display = personDisplay(person);
    return display.name.toLocaleLowerCase('ru').includes(needle)
      || String(display.uei || '').toLocaleLowerCase('ru').includes(needle);
  });
}

function listMarkup(items, query = '') {
  if (!items.length) {
    return query
      ? emptyState('Ничего не найдено', 'Проверьте имя или UEI.')
      : emptyState('Клиентов пока нет', 'Добавьте человека кнопкой «+».');
  }
  return v2ListEntries(items.map((person) => {
    const display = personDisplay(person);
    return v2ListEntry({
      overline: display.uei,
      title: display.name,
      subtitle: display.phone,
      initial: '',
      className: 'list-entry--record-person',
      interactive: true,
      data: `data-person="${escapeHtml(person.key)}"`,
      aria: `Открыть ${display.name}`,
    });
  }));
}

function refreshPeopleList(root) {
  const host = root.querySelector('[data-people-list-host]');
  if (!host) return;
  const query = root.peopleSearchInput?.value || '';
  const items = filterPeople(applyPeopleFilters(sortItems(getPeople(), getPeopleSortMode())), query);
  host.innerHTML = listMarkup(items, query);
  host.querySelectorAll('[data-person]').forEach((node) => {
    node.addEventListener('click', () => openPersonOverview(root, node.dataset.person, root.peopleOptions || {}));
  });
}

function listContext() {
  return workspaceHeaderContext({
    title: 'Клиенты',
    a: {
      kind: 'settings',
      data: 'data-people-list-settings',
      aria: 'Настройки клиентов',
    },
  });
}

export function renderPeople(root, options = {}) {
  root.peopleOptions = options;
  root.innerHTML = page([
    listContext(),
    `<section><div data-people-list-host></div></section>`,
    button('+', {
      className: 'v2-primary-source-only',
      data: 'data-add data-v2-primary-action data-v2-primary-label="+"',
      aria: 'Добавить клиента',
    }),
  ]);
  const [searchRow] = setV2ZHeaderRows(root, [`<div class="people-search ui-search-field">
    ${field({ name: 'peopleSearch', type: 'search', placeholder: 'Поиск по имени или UEI', autocomplete: 'off', data: 'data-people-search' })}
    <div class="people-search-divider ui-search-divider" aria-hidden="true"></div>
  </div>`]);
  root.peopleSearchInput = searchRow?.querySelector('[data-people-search]') || null;
  refreshPeopleList(root);
  root.peopleSearchInput?.addEventListener('input', () => refreshPeopleList(root));
  root.querySelector('[data-people-list-settings]')?.addEventListener('click', () => openListSettings(root, options));
  root.querySelector('[data-add]')?.addEventListener('click', () => openAddMenu(root, options));
}

function openSortSettings(root) {
  const layer = mountModal(root, modal(`<div class="form-grid">${select({
    label: 'Сортировка',
    value: getPeopleSortMode(),
    options: sortOptions(),
    aria: 'Сортировка клиентов',
    data: 'data-people-sort-settings',
  })}</div>`, { title: 'Сортировка', variant: 'x', surface: 'app' }));
  layer?.querySelector('[data-people-sort-settings]')?.addEventListener('change', (event) => {
    setPeopleSortMode(event.target.value);
    refreshPeopleList(root);
  });
  return layer;
}

function openFilterSettings(root) {
  const filters = getPeopleFilters();
  const content = `<div class="form-grid">
    ${select({ label: 'Пол', name: 'peopleGenderFilter', value: filters.gender, options: [
      { value: '', label: 'Любой' }, { value: 'female', label: 'Женский' }, { value: 'male', label: 'Мужской' }, { value: 'none', label: 'Не указан' },
    ] })}
    ${select({ label: 'День рождения', name: 'peopleBirthdayFilter', value: filters.birthday, options: [
      { value: '', label: 'Любой' }, { value: 'month', label: 'В этом месяце' }, { value: 'has', label: 'Дата указана' }, { value: 'none', label: 'Дата не указана' },
    ] })}
    ${select({ label: 'Ярлык', name: 'peopleTagFilter', value: filters.tag, options: tagFilterOptions(), searchable: true })}
    ${select({ label: 'Окраска ярлыка', name: 'peopleTagColorFilter', value: filters.tagColor, options: tagColorOptions() })}
    ${select({ label: 'Почта', name: 'peopleNoEmailFilter', value: filters.noEmail, options: [{ value: '', label: 'Все' }, { value: 'yes', label: 'Без почты' }] })}
    ${select({ label: 'Посещения', name: 'peopleNoVisitsFilter', value: filters.noVisits, options: [{ value: '', label: 'Все' }, { value: 'yes', label: 'Без посещений' }] })}
  </div>`;
  const layer = mountModal(root, modal(content, { title: 'Фильтр', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  const sync = () => {
    setPeopleFilters({
      gender: layer.querySelector('[name="peopleGenderFilter"]')?.value || '',
      birthday: layer.querySelector('[name="peopleBirthdayFilter"]')?.value || '',
      tag: layer.querySelector('[name="peopleTagFilter"]')?.value || '',
      tagColor: layer.querySelector('[name="peopleTagColorFilter"]')?.value || '',
      noEmail: layer.querySelector('[name="peopleNoEmailFilter"]')?.value || '',
      noVisits: layer.querySelector('[name="peopleNoVisitsFilter"]')?.value || '',
    });
    refreshPeopleList(root);
  };
  layer.querySelectorAll('select, input').forEach((node) => node.addEventListener('change', sync));
  return layer;
}

function openExcelSettings(root) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Выгрузить', { variant: 'secondary', data: 'data-export' })}
  </div>`, { title: 'Excel', variant: 'x', surface: 'app' }));
  layer?.querySelector('[data-export]')?.addEventListener('click', () => downloadCsv());
  return layer;
}

function openListSettings(root, options = {}) {
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Сортировка', { variant: 'secondary', data: 'data-people-sort' })}
    ${button('Фильтр', { variant: 'secondary', data: 'data-people-filter' })}
    ${button('Вид', { variant: 'secondary', data: 'data-people-appearance' })}
    ${button('Excel', { variant: 'secondary', data: 'data-people-excel' })}
  </div>`, { title: 'Клиенты', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  layer.querySelector('[data-people-sort]')?.addEventListener('click', () => { layer.v2Close?.(); openSortSettings(root); });
  layer.querySelector('[data-people-filter]')?.addEventListener('click', () => { layer.v2Close?.(); openFilterSettings(root); });
  layer.querySelector('[data-people-appearance]')?.addEventListener('click', () => { layer.v2Close?.(); openPeopleAppearanceQ(root, options); });
  layer.querySelector('[data-people-excel]')?.addEventListener('click', () => { layer.v2Close?.(); openExcelSettings(root, options); });
  return layer;
}

function openPeopleAppearanceQ(root, options = {}) {
  const values = getPeople();
  const sample = values[0] || {
    key: '', name: 'Имя', surname: 'Фамилия', phones: ['+7 900 000-00-00'],
    emails: [], telegrams: [], uei: '0000', photo: '',
  };
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Карта',
    typeOptions: [{ value: 'person', label: 'Клиент' }],
    initialType: 'person',
    targetOptions: () => [],
    allowPhoto: false,
    resolve: () => ({
      appearance: personCardAppearance(sample),
      fields: personCardFields(sample),
      photo: sample.photo || '',
      photoPosition: '50% 50%',
    }),
    save: async ({ appearance }) => {
      saveCardAppearanceTemplate('person', { appearance, photo: '', photoPosition: '50% 50%' });
    },
    onSaved: () => renderPeople(root, options),
  });
}

function downloadCsv() {
  const headers = ['Имя', 'Фамилия', 'Телефон', 'Email'];
  const rows = getPeople().map((person) => [person.name, person.surname, person.phones?.[0], person.emails?.[0]]);
  const text = '\uFEFF' + [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(';'))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'люди.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}


function openAddMenu(root, options = {}) {
  const allowReal = canUseRealPersonalData();
  const layer = mountModal(root, modal(`<div class="modal-actions">
    ${button('Из контакта', { variant: 'secondary', data: 'data-add-from-contacts' })}
    ${button('Внести вручную', { variant: 'secondary', data: 'data-add-manual' })}
  </div><div class="form-error" data-add-choice-error></div>`, {
    title: 'Добавить клиента',
    variant: 'x',
    surface: 'app',
  }));
  if (!layer) return null;

  layer.querySelector('[data-add-manual]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openCreateX(root, options);
  });
  layer.querySelector('[data-add-from-contacts]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-add-choice-error]');
    if (!allowReal) {
      if (error) error.textContent = 'Добавление реальных контактов недоступно в текущем режиме.';
      return;
    }
    if (!navigator.contacts?.select) {
      if (error) error.textContent = 'Доступ к системным контактам не поддерживается этим браузером.';
      return;
    }
    try {
      const contact = (await navigator.contacts.select(['name', 'tel'], { multiple: false }))[0];
      if (!contact) return;
      layer.v2Close?.();
      openCreateX(root, options, {
        name: contact.name?.[0] || '',
        phone: contact.tel?.[0] || '',
      });
    } catch {}
  });
  return layer;
}

function openCreateX(root, options = {}, preset = {}) {
  const layer = mountModal(root, modal(personCreateForm(preset), {
    title: 'Внести вручную',
    variant: 'x',
    surface: 'app',
    className: 'people-create-x',
  }));
  if (!layer) return null;
  bindPersonCreateForm(layer, {
    onCreated: (person) => {
      layer.v2Close?.();
      renderPeople(root, options);
      openPersonOverview(root, person.key, options);
    },
  });
  return layer;
}

function personContext(person) {
  return personQContext(person);
}

function bindPersonContext(root, person, options = {}) {
  root.querySelector('[data-person-settings]')?.addEventListener('click', () => {
    openPersonSettings(root, person, options);
  });
  root.querySelector('[data-person-direct-chat]')?.addEventListener('click', () => {
    options.onDirectChat?.(person.key);
  });
}

function overviewCard(person) {
  const display = personDisplay(person);
  return entityVisualCard({
    appearance: personCardAppearance(person),
    fields: personCardFields(person),
    image: person.photo || '',
    imagePosition: '50% 50%',
    interactive: true,
    data: 'data-person-card',
    aria: `Открыть данные ${display.name}`,
  });
}

async function renderPersonOverview(layer, baseRoot, key, options = {}) {
  const person = getAllPeople().find((item) => item.key === key);
  if (!person) {
    layer.v2Close?.();
    renderPeople(baseRoot, options);
    return;
  }
  const relationships = await buildPersonRelationshipSections(person);
  layer.innerHTML = page([
    personContext(person),
    relationships.markup,
  ]);
  setV2ZHeaderRows(layer, [overviewCard(person)]);
  bindPersonContext(layer, person, options);
  relationships.bind(layer, (detail) => openPersonRelationshipQ(baseRoot, person, detail, options));
  layer.querySelector('[data-person-card]')?.addEventListener('click', () => {
    openPersonEdit(layer, baseRoot, person.key, options, {
      onSaved: (nextKey) => void renderPersonOverview(layer, baseRoot, nextKey || person.key, options),
      onDeleted: () => {
        layer.v2Close?.();
        renderPeople(baseRoot, options);
      },
    });
  });
  notifyContext();
}

function openPersonRelationshipQ(root, person, detail, options = {}) {
  const layer = mountModal(root, modal(`${personQContext(person)}${detail?.body || ''}`, {
    title: detail?.title || name(person),
    variant: 'q',
    surface: 'app',
    className: 'people-program-q',
  }));
  if (layer) bindPersonContext(layer, person, options);
  return layer;
}

function openPersonOverview(root, key, options = {}) {
  if (!key) return null;
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'people-overview-layer' }), {
    stack: true,
    onClose: options.onClose || null,
  });
  if (!layer) return null;
  void renderPersonOverview(layer, root, key, options);
  return layer;
}

export function openPerson({ root = document.body, key, onClose, onDirectChat } = {}) {
  return openPersonOverview(root, key, { onClose, onDirectChat });
}

function memberPeople(person, all) {
  const members = getMembers(person.uei);
  if (members.length <= 1) return [person];
  const ids = members.map((member) => member.startsWith('person:') ? member.slice(7) : member);
  return ids.map((id) => all.find((item) => item.key === id)).filter(Boolean);
}

function businessEntries(person, all, fieldName) {
  const people = memberPeople(person, all);
  const entries = [];
  const seen = new Set();
  for (const member of people) {
    for (const value of Array.isArray(member[fieldName]) ? member[fieldName] : []) {
      const text = String(value ?? '').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      entries.push({ value: text, source: member.key });
    }
  }
  return entries;
}

function contactAnchor(person) {
  const telegram = (person.telegrams || []).map((value) => String(value || '').trim()).find(Boolean);
  if (telegram) return { value: person.key, label: telegram };
  const phone = (person.phones || []).map((value) => String(value || '').trim()).find(Boolean);
  if (phone) return { value: person.key, label: phone };
  const email = (person.emails || []).map((value) => String(value || '').trim()).find(Boolean);
  if (email) return { value: person.key, label: email };
  return null;
}

function hasContact(person) {
  return Boolean(contactAnchor(person));
}

function ueiData(person, all) {
  const current = person.uei || getUEI('person', person.key) || '';
  const existing = getOptions('person', person.key);
  const members = getMembers(current);
  const detachable = members.map((member) => {
    const id = member.startsWith('person:') ? member.slice(7) : member;
    const item = all.find((candidate) => candidate.key === id);
    return item ? contactAnchor(item) : null;
  }).filter(Boolean);
  return {
    value: current,
    existing,
    detachable,
    memberCount: members.length,
    showApply: false,
  };
}

function personDataFields(person, all) {
  return [
    `<div class="form-grid people-uei-editor">${uei(ueiData(person, all))}</div>`,
    v2Section('Персональные данные', `<div class="form-grid">
      ${field({ label: 'Имя', name: 'name', value: person.name, required: true })}
      ${field({ label: 'Фамилия', name: 'surname', value: person.surname })}
      ${select({ label: 'Пол', name: 'gender', value: person.gender || '', options: [
        { value: '', label: 'Не указан' },
        { value: 'female', label: 'Женский' },
        { value: 'male', label: 'Мужской' },
      ] })}
      ${monthDayPicker({ label: 'Дата рождения', name: 'birthDate', value: person.birthDate || '' })}
      ${field({ label: 'Скидка %', name: 'discountPercent', value: person.discountPercent || '', type: 'number', inputmode: 'decimal' })}
    </div>`),
    v2Section('Контактные данные',
      repeatedField({ label: 'Телефон', name: 'phones', values: businessEntries(person, all, 'phones'), type: 'tel' })
      + repeatedField({ label: 'Telegram', name: 'telegrams', values: businessEntries(person, all, 'telegrams') })
      + repeatedField({ label: 'Email', name: 'emails', values: businessEntries(person, all, 'emails'), type: 'email' })),
    v2Section('Ссылки', links({ links: person.links || [], name: 'person-links' })),
    v2Section('Ярлыки', tags({ tags: getTags(), selected: person.tags || [], name: 'person-tags' })),
  ].join('');
}

function formSnapshot(form) {
  if (!form) return '';
  return JSON.stringify([...new FormData(form).entries()].map(([key, value]) => [key, typeof value === 'string' ? value : '']));
}

function saveBusinessEntries(all, ownerKey, fieldName, entries, memberKeys) {
  const valuesBySource = new Map(memberKeys.map((key) => [key, []]));
  for (const entry of entries) {
    const source = memberKeys.includes(entry.source) ? entry.source : ownerKey;
    if (!valuesBySource.has(source)) valuesBySource.set(source, []);
    if (!valuesBySource.get(source).includes(entry.value)) valuesBySource.get(source).push(entry.value);
  }
  for (const key of memberKeys) {
    const person = all.find((item) => item.key === key);
    if (person) person[fieldName] = valuesBySource.get(key) || [];
  }
}

function savePersonUei(root, key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) return key;
  const current = person.uei || getUEI('person', person.key) || '';
  const value = String(root.querySelector('[name="uei"]')?.value || '').trim();
  const linkValue = String(root.querySelector('[name="ueiLink"]')?.value || '').trim();
  const detachValue = String(root.querySelector('[name="ueiDetach"]')?.value || '').trim();
  const identifiers = [...(person.phones || []), ...(person.telegrams || []), ...(person.emails || [])];

  if (detachValue && current) {
    detachUEI({ entityType: 'person', entityId: detachValue, uei: current, explicit: true });
    savePeople(all);
    return key;
  }
  if (linkValue) {
    if (!hasContact(person)) {
      const targetMembers = getMembers(linkValue);
      const targetOwner = targetMembers[0]?.startsWith('person:') ? targetMembers[0].slice(7) : targetMembers[0];
      savePeople(all.filter((item) => item.key !== person.key));
      return targetOwner || key;
    }
    applyUEI({ entityType: 'person', entityId: key, currentUEI: current, value, linkValue, identifiers });
    savePeople(all);
    return key;
  }
  if (value && value !== current) {
    applyUEI({ entityType: 'person', entityId: key, currentUEI: current, value, linkValue: '', identifiers });
    savePeople(all);
  }
  return key;
}

function savePersonData(root, key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) throw new Error('Человек не найден');
  const memberKeys = getMembers(person.uei).map((member) => member.startsWith('person:') ? member.slice(7) : member);
  if (!memberKeys.length) memberKeys.push(key);
  person.name = root.querySelector('[name="name"]')?.value.trim() || person.name;
  person.surname = root.querySelector('[name="surname"]')?.value.trim() || '';
  person.gender = root.querySelector('[name="gender"]')?.value || '';
  person.birthDate = root.querySelector('[name="birthDate"]')?.value || '';
  const rawDiscount = Number(String(root.querySelector('[name="discountPercent"]')?.value || '0').replace(',', '.'));
  person.discountPercent = Number.isFinite(rawDiscount) ? Math.max(0, Math.min(100, rawDiscount)) : 0;
  saveBusinessEntries(all, key, 'phones', collectRepeatedEntries(root, 'phones'), memberKeys);
  saveBusinessEntries(all, key, 'telegrams', collectRepeatedEntries(root, 'telegrams'), memberKeys);
  saveBusinessEntries(all, key, 'emails', collectRepeatedEntries(root, 'emails'), memberKeys);
  person.links = collectLinks(root, 'person-links');
  person.tags = collectTags(root, 'person-tags');
  savePeople(all);
  return getAllPeople().find((item) => item.key === key) || person;
}

function deletePersonByKey(key) {
  const all = getAllPeople();
  const person = all.find((item) => item.key === key);
  if (!person) return;
  const current = getUEI('person', key) || person.uei || '';
  if (current) detachUEI({ entityType: 'person', entityId: key, uei: current, explicit: false });
  savePeople(all.filter((item) => item.key !== key));
}

function confirmDelete(root, person, onDeleted) {
  const layer = mountModal(root, modal(`<div class="modal-title"><h2>Удалить?</h2><p>${escapeHtml(name(person))} будет удалён.</p></div>
    <div class="modal-actions">
      ${button('Удалить', { variant: 'danger', data: 'data-confirm-delete' })}
      ${button('Отмена', { variant: 'secondary', data: 'data-cancel-delete' })}
    </div>`, { title: 'Удалить', variant: 'x', surface: 'app' }));
  if (!layer) return;
  layer.querySelector('[data-cancel-delete]')?.addEventListener('click', () => layer.v2Close?.());
  layer.querySelector('[data-confirm-delete]')?.addEventListener('click', () => {
    deletePersonByKey(person.key);
    layer.v2Close?.();
    onDeleted?.();
  });
}

function openPersonEdit(parentLayer, baseRoot, key, options = {}, callbacks = {}) {
  const person = getAllPeople().find((item) => item.key === key);
  if (!person) return null;
  const all = getAllPeople();
  const layer = mountModal(baseRoot, modal(`${personQContext(person, {
    c: { label: 'Сохранить', data: 'data-person-q-save', aria: 'Сохранить изменения' },
  })}<form data-person-edit-form>
    ${personDataFields(person, all)}
    ${button('Удалить клиента', { type: 'button', variant: 'danger', data: 'data-person-delete' })}
    <div class="form-error" data-person-edit-error></div>
  </form>`, {
    title: name(person),
    variant: 'q',
    surface: 'app',
    className: 'people-edit-q',
  }));
  if (!layer) return null;

  initMonthDayPickers(layer);
  initLinks(layer);
  initTags(layer);
  initRepeatedFields(layer);
  initUEI(layer);

  const form = layer.querySelector('[data-person-edit-form]');
  const action = layer.querySelector('[data-person-q-save]');
  const initialState = formSnapshot(form);
  const isDirty = () => formSnapshot(form) !== initialState;
  const syncAction = () => {
    if (!action) return;
    action.hidden = !isDirty();
    notifyContext();
  };
  const save = () => {
    if (!isDirty()) return;
    try {
      savePersonData(layer, key);
      const nextKey = savePersonUei(layer, key);
      layer.v2Close?.();
      callbacks.onSaved?.(nextKey || key);
    } catch (error) {
      const node = layer.querySelector('[data-person-edit-error]');
      if (node) node.textContent = error instanceof Error ? error.message : 'Не удалось сохранить';
    }
  };

  action?.addEventListener('click', save);
  layer.querySelector('[data-person-delete]')?.addEventListener('click', () => {
    confirmDelete(layer, person, () => {
      layer.v2Close?.();
      callbacks.onDeleted?.();
    });
  });
  form?.addEventListener('input', syncAction);
  form?.addEventListener('change', syncAction);
  form?.addEventListener('submit', (event) => { event.preventDefault(); save(); });
  bindPersonContext(layer, person, options);
  syncAction();
  return layer;
}
