import {
  actionBlock,
  button,
  checkList,
  collectCheckList,
  details,
  emptyState,
  entityCardStack,
  field,
  formValidationMessage,
  initCheckList,
  modal,
  mountModal,
  mountV2ZLayer,
  openDocumentViewer,
  page,
  select,
  setV2ZHeaderRows,
  shortDateTime,
  smallActionButton,
  textareaField,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  v2Section,
  v2ZLayer,
} from '../../../ui/ui.js';
import { getProcedures } from '../../service/procedures/data.js';
import {
  bindViewSettings,
  formObject,
  initLoyaltyTermFields,
  initOptionalUeiField,
  loyaltyCardFields,
  loyaltyHeader,
  loyaltyTermData,
  loyaltyTermFields,
  loyaltyVisualCard,
  notifyLoyaltyContext,
  normalizeOptionalUei,
  openLoyaltyProgramSettings,
  openLoyaltySettingsMenu,
  optionalUeiField,
  text,
  uid,
} from '../shared.js';

let programs = [
  {
    id: 'referral-friend', uei: '', name: 'Приведи друга', description: 'Награда после первой полной оплаты приглашённого.',
    term: 'Бессрочно', termType: 'indefinite', termStartDate: '', termEndDate: '', qualifyingEvent: 'first-paid', eventValue: '', eventServiceIds: [],
    levels: 1, levelRewards: [{ type: 'percent', value: 5, base: 'Сумма оплаченной операции' }], capType: 'per-invitee', capValue: 5000,
    rewardExpiryType: 'duration', rewardExpiryCount: 90, rewardExpiryUnit: 'days', rewardExpiryValue: '90 дн.', inviteeBenefit: 'fixed-bonus', inviteeBenefitValue: 500,
    rewardTiming: 'paid-and-completed', recurrence: 'first', recurrenceValue: '', assignment: 'all', status: 'active', createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'referral-vip', uei: '', name: 'VIP рекомендации', description: 'Два уровня награды за оплаченные операции.',
    term: 'Бессрочно', termType: 'indefinite', termStartDate: '', termEndDate: '', qualifyingEvent: 'each-paid', eventValue: '', eventServiceIds: [],
    levels: 2, levelRewards: [{ type: 'percent', value: 5, base: 'Сумма оплаченной операции' }, { type: 'percent', value: 2, base: 'Сумма оплаченной операции' }],
    capType: 'period', capValue: 10000, rewardExpiryType: 'indefinite', rewardExpiryCount: 0, rewardExpiryUnit: 'days', rewardExpiryValue: '', inviteeBenefit: 'none', inviteeBenefitValue: 0,
    rewardTiming: 'payment', recurrence: 'each', recurrenceValue: '', assignment: 'selected', status: 'active', createdAt: '2026-10-02T10:00:00.000Z',
  },
];

let relations = [];

function statusLabel(status = '') {
  if (status === 'paused') return 'Приостановлена';
  if (status === 'ended' || status === 'closed') return 'Завершена';
  return 'Активна';
}

function eventLabel(value = '') {
  if (value === 'each-paid') return 'Каждая оплаченная операция';
  if (value === 'first-n-paid') return 'Первые N оплаченных операций';
  if (value === 'minimum-amount') return 'Операция не меньше заданной суммы';
  if (value === 'service-items') return 'Выбранные позиции Сервиса';
  if (value === 'paid-supported-event') return 'Оплаченное поддерживаемое событие';
  if (value === 'within-referral-period') return 'Действие в срок после реферальной связи';
  return 'Первая оплаченная операция';
}

function rewardTypeLabel(value = '') { return value === 'fixed' ? 'Фиксированные бонусы' : 'Процент от базы'; }
function assignmentLabel(value = '') { return value === 'selected' ? 'Выбранным контактам' : 'Всем контактам'; }
function relationStatus(value = '') { if (value === 'completed') return 'Выполнено'; if (value === 'cancelled') return 'Отменено'; return 'Ожидает результата'; }
function periodLabel(count = 0, unit = 'days') { const amount = Math.max(1, Number(count || 1)); return `${amount} ${unit === 'months' ? 'мес.' : unit === 'years' ? 'лет' : 'дн.'}`; }

function capLabel(program = {}) {
  const value = Math.max(0, Number(program.capValue || 0));
  if (program.capType === 'none') return 'Без ограничения';
  if (program.capType === 'per-operation') return `До ${value} за операцию`;
  if (program.capType === 'period') return `До ${value} за период`;
  return `До ${value} от одного приглашённого`;
}

function timingLabel(value = '') {
  if (value === 'completion') return 'После завершения';
  if (value === 'payment') return 'После полной оплаты';
  return 'После завершения и полной оплаты';
}

function recurrenceLabel(program = {}) {
  if (program.recurrence === 'each') return 'Каждое успешное действие';
  if (program.recurrence === 'first-n') return `Первые ${program.recurrenceValue || 'N'} успешных действий`;
  if (program.recurrence === 'period') return `Действия в течение ${program.recurrenceValue || 'периода'}`;
  if (program.recurrence === 'until-cap') return `До общего лимита ${program.recurrenceValue || '—'}`;
  return 'Только первое успешное действие';
}

function inviteeBenefitLabel(program = {}) {
  const amount = Math.max(0, Number(program.inviteeBenefitValue || 0));
  if (program.inviteeBenefit === 'fixed-bonus') return `${amount} бонусов внутри программы`;
  if (program.inviteeBenefit === 'percent-bonus') return `${amount}% бонусами внутри программы`;
  if (program.inviteeBenefit === 'discount') return `Скидка ${amount}% на квалифицирующее действие`;
  return 'Без отдельной выгоды';
}

function rewardExpiryLabel(program = {}) { return program.rewardExpiryType === 'duration' ? (program.rewardExpiryValue || periodLabel(program.rewardExpiryCount, program.rewardExpiryUnit)) : 'Бессрочно'; }

function levelSummary(program = {}) {
  return (Array.isArray(program.levelRewards) ? program.levelRewards : [])
    .slice(0, Math.max(1, Number(program.levels || 1)))
    .map((reward, index) => `Уровень ${index + 1}: ${rewardTypeLabel(reward.type)} ${reward.value || 0}${reward.type === 'percent' ? '%' : ''}`)
    .join(' · ');
}

function programCardFields(program = {}) {
  return loyaltyCardFields({
    uei: program.uei || '',
    title: program.name || 'Реферальная программа',
    subtitle: eventLabel(program.qualifyingEvent),
    status: statusLabel(program.status),
    metaLeft: assignmentLabel(program.assignment),
    metaRight: `${program.levels || 1} ур.`,
  });
}

function programConditions(program = {}) {
  return [
    `UEI: ${program.uei || '—'}`,
    `Срок программы: ${program.term || 'Бессрочно'}`,
    `Результативное событие: ${eventLabel(program.qualifyingEvent)}`,
    `Параметр события: ${program.eventValue || '—'}`,
    `Уровни: ${levelSummary(program)}`,
    `Ограничение награды: ${capLabel(program)}`,
    `Срок награды: ${rewardExpiryLabel(program)}`,
    `Выгода приглашённому: ${inviteeBenefitLabel(program)}`,
    `Момент начисления: ${timingLabel(program.rewardTiming)}`,
    `Повторяемость: ${recurrenceLabel(program)}`,
    `Доступность: ${assignmentLabel(program.assignment)}`,
    `Состояние: ${statusLabel(program.status)}`,
    '',
    program.description || 'Дополнительные условия не указаны.',
  ].join('\n');
}

function relationInfo(relation = {}, program = {}) {
  return details([
    { label: 'Пригласил', value: relation.inviterName || '—' }, { label: 'Приглашён', value: relation.inviteeName || '—' },
    { label: 'Дата связи', value: shortDateTime(relation.createdAt, '—') }, { label: 'Программа', value: program.name || '—' },
    { label: 'Уровень', value: String(relation.level || 1) }, { label: 'Состояние', value: relationStatus(relation.status) },
    { label: 'Реферальный код', value: relation.inviterCode || '—' }, { label: 'Квалифицирующее событие', value: relation.qualifyingEvent || '—' },
    { label: 'База результата', value: relation.resultBase ? String(relation.resultBase) : '—' }, { label: 'Начислено', value: `${Math.max(0, Number(relation.reward || 0))} бонусов` },
    { label: 'Доступно', value: `${Math.max(0, Number(relation.rewardAvailable || 0))} бонусов` }, { label: 'Срок награды', value: relation.rewardExpiresAt || rewardExpiryLabel(program) },
  ]);
}

function relationList(items = []) {
  if (!items.length) return emptyState('Связей пока нет', 'Реферальные связи появятся после использования программы.');
  return v2ListEntries(items.map((relation) => v2ListEntry({
    title: `${relation.inviterName || '—'} → ${relation.inviteeName || '—'}`,
    subtitle: relation.qualifyingEvent || 'Реферальная связь',
    rightTop: relationStatus(relation.status),
    rightBottom: relation.reward ? `${relation.reward} бонусов` : '',
    interactive: true,
    initial: '',
    data: `data-referral-relation="${relation.id}"`,
    aria: `Открыть реферальную связь ${relation.inviterName || ''} ${relation.inviteeName || ''}`,
  })));
}

function openConditions(program = {}) { return openDocumentViewer({ title: program.name || 'Условия реферальной программы', content: programConditions(program) }); }

function baseValue(value = '') {
  if (String(value).includes('пози')) return 'items';
  if (String(value).includes('Поддерж')) return 'supported';
  return 'operation';
}

function levelFields(level, reward = {}) {
  return `<div data-referral-level="${level}">
    ${select({ label: `Уровень ${level} — тип награды`, name: `level${level}Type`, value: reward.type || 'percent', options: [{ value: 'fixed', label: 'Фиксированное количество бонусов' }, { value: 'percent', label: 'Процент от базы' }] })}
    ${field({ label: `Уровень ${level} — значение`, name: `level${level}Value`, type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: reward.value || '' })}
    ${select({ label: `Уровень ${level} — база процента`, name: `level${level}Base`, value: baseValue(reward.base), options: [{ value: 'operation', label: 'Сумма оплаченной операции' }, { value: 'items', label: 'Сумма выбранных позиций' }, { value: 'supported', label: 'Другая поддерживаемая база программы' }] })}
  </div>`;
}

function baseLabel(value = '') { if (value === 'items') return 'Сумма выбранных позиций'; if (value === 'supported') return 'Поддерживаемая база программы'; return 'Сумма оплаченной операции'; }
function serviceItems() { return getProcedures().map((item) => ({ value: String(item.id || ''), label: item.name || 'Позиция Сервиса' })).filter((item) => item.value); }
function serviceName(id = '') { return serviceItems().find((item) => item.value === String(id || ''))?.label || ''; }

function initReferralConstructor(layer, editingProgram = null) {
  const form = layer?.querySelector?.('[data-referral-form]');
  if (!form) return;
  initLoyaltyTermFields(form);
  initOptionalUeiField(form);
  initCheckList(form);
  const event = form.querySelector('[name="qualifyingEvent"]');
  const levels = form.querySelector('[name="levels"]');
  const cap = form.querySelector('[name="capType"]');
  const expiry = form.querySelector('[name="rewardExpiryType"]');
  const benefit = form.querySelector('[name="inviteeBenefit"]');
  const recurrence = form.querySelector('[name="recurrence"]');
  const levelHost = form.querySelector('[data-referral-levels]');
  const syncPanels = (name, value) => form.querySelectorAll(`[data-referral-${name}-panel]`).forEach((panel) => { panel.hidden = panel.dataset[`referral${name[0].toUpperCase()}${name.slice(1)}Panel`] !== value; });
  const syncEvent = () => syncPanels('event', event?.value || 'first-paid');
  const syncCap = () => { const node = form.querySelector('[data-referral-cap-value]'); if (node) node.hidden = cap?.value === 'none'; };
  const syncExpiry = () => { const node = form.querySelector('[data-referral-expiry-duration]'); if (node) node.hidden = expiry?.value !== 'duration'; };
  const syncBenefit = () => { const node = form.querySelector('[data-referral-benefit-value]'); if (node) node.hidden = benefit?.value === 'none'; };
  const syncRecurrence = () => syncPanels('recurrence', recurrence?.value || 'first');
  const renderLevels = () => {
    const count = Math.max(1, Math.floor(Number(levels?.value || 1)));
    if (levels) levels.value = String(count);
    if (levelHost) levelHost.innerHTML = Array.from({ length: count }, (_, index) => levelFields(index + 1, editingProgram?.levelRewards?.[index] || {})).join('');
  };
  event?.addEventListener('change', syncEvent); cap?.addEventListener('change', syncCap); expiry?.addEventListener('change', syncExpiry); benefit?.addEventListener('change', syncBenefit); recurrence?.addEventListener('change', syncRecurrence); levels?.addEventListener('input', renderLevels);
  syncEvent(); syncCap(); syncExpiry(); syncBenefit(); syncRecurrence(); renderLevels();
}

async function openCreateProgramQ(root, rerender, editingProgram = null) {
  const editing = Boolean(editingProgram?.id);
  const title = editing ? 'Корректировать реферальную программу' : 'Новая реферальная программа';
  const services = serviceItems();
  const chosenServices = new Set((editingProgram?.eventServiceIds || []).map(String));
  const termMode = editingProgram?.termType || 'indefinite';
  const layer = mountModal(root, modal(`${loyaltyHeader(title)}
    <form class="form-grid" data-referral-form>
      ${field({ label: 'Название', name: 'name', value: editingProgram?.name || '', required: true })}
      ${optionalUeiField({ name: 'uei', value: editingProgram?.uei || '' })}
      ${textareaField({ label: 'Описание / условия', name: 'description', value: editingProgram?.description || '' })}
      ${loyaltyTermFields({ prefix: 'referralTerm', label: 'Срок программы', mode: termMode, allowDuration: false, allowRange: true, startDate: editingProgram?.termStartDate || '', endDate: editingProgram?.termEndDate || '' })}
      ${select({ label: 'Результативное событие', name: 'qualifyingEvent', value: editingProgram?.qualifyingEvent || 'first-paid', options: [
        { value: 'first-paid', label: 'Первая оплаченная операция приглашённого' }, { value: 'each-paid', label: 'Каждая оплаченная операция' },
        { value: 'first-n-paid', label: 'Первые N оплаченных операций' }, { value: 'minimum-amount', label: 'Операция не меньше заданной суммы' },
        { value: 'service-items', label: 'Выбранные позиции Сервиса' }, { value: 'paid-supported-event', label: 'Оплаченный Заказ / Продажа / другое событие' },
        { value: 'within-referral-period', label: 'Действие в течение срока после связи' },
      ] })}
      <div data-referral-event-panel="first-n-paid" hidden>${field({ label: 'Количество оплаченных операций', name: 'eventCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.eventCount || editingProgram?.eventValue || 1 })}</div>
      <div data-referral-event-panel="minimum-amount" hidden>${field({ label: 'Минимальная сумма', name: 'eventAmount', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.eventAmount || editingProgram?.eventValue || '' })}</div>
      <div data-referral-event-panel="service-items" hidden>${services.length ? checkList(services.map((item) => ({ ...item, checked: chosenServices.has(item.value) }))) : emptyState('Позиции Сервиса пока не созданы', 'Сначала добавьте позиции в Сервис.')}</div>
      <div data-referral-event-panel="paid-supported-event" hidden>${select({ label: 'Событие', name: 'supportedEvent', value: editingProgram?.supportedEvent || editingProgram?.eventValue || 'sale', options: [{ value: 'sale', label: 'Продажа' }, { value: 'order', label: 'Заказ' }, { value: 'other', label: 'Другое поддерживаемое событие' }] })}</div>
      <div data-referral-event-panel="within-referral-period" hidden>${twoColumnLayout(field({ label: 'Срок', name: 'eventPeriodCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.eventPeriodCount || 30 }), select({ label: 'Период', name: 'eventPeriodUnit', value: editingProgram?.eventPeriodUnit || 'days', options: [{ value: 'days', label: 'Дней' }, { value: 'months', label: 'Месяцев' }] }), { ariaLabel: 'Срок после реферальной связи' })}</div>
      ${field({ label: 'Количество уровней', name: 'levels', type: 'number', min: '1', step: '1', value: editingProgram?.levels || 1, inputmode: 'numeric' })}
      <div data-referral-levels></div>
      ${select({ label: 'Ограничение награды', name: 'capType', value: editingProgram?.capType || 'none', options: [{ value: 'none', label: 'Без ограничения' }, { value: 'per-operation', label: 'Максимум за одну операцию' }, { value: 'per-invitee', label: 'Максимум от одного приглашённого' }, { value: 'period', label: 'Максимум за период' }] })}
      <div data-referral-cap-value hidden>${field({ label: 'Максимум бонусов', name: 'capValue', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.capValue || '' })}</div>
      ${select({ label: 'Срок жизни награды', name: 'rewardExpiryType', value: editingProgram?.rewardExpiryType || 'indefinite', options: [{ value: 'indefinite', label: 'Бессрочно' }, { value: 'duration', label: 'Период после начисления' }] })}
      <div data-referral-expiry-duration hidden>${twoColumnLayout(field({ label: 'Количество', name: 'rewardExpiryCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.rewardExpiryCount || 90 }), select({ label: 'Период', name: 'rewardExpiryUnit', value: editingProgram?.rewardExpiryUnit || 'days', options: [{ value: 'days', label: 'Дней' }, { value: 'months', label: 'Месяцев' }] }), { ariaLabel: 'Срок жизни награды' })}</div>
      ${select({ label: 'Выгода приглашённому', name: 'inviteeBenefit', value: editingProgram?.inviteeBenefit || 'none', options: [{ value: 'none', label: 'Без отдельной выгоды' }, { value: 'fixed-bonus', label: 'Фиксированные бонусы внутри программы' }, { value: 'percent-bonus', label: 'Процент бонусами внутри программы' }, { value: 'discount', label: 'Скидка на квалифицирующее действие' }] })}
      <div data-referral-benefit-value hidden>${field({ label: 'Размер выгоды', name: 'inviteeBenefitValue', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.inviteeBenefitValue || '' })}</div>
      ${select({ label: 'Момент начисления', name: 'rewardTiming', value: editingProgram?.rewardTiming || 'paid-and-completed', options: [{ value: 'completion', label: 'После завершения события' }, { value: 'payment', label: 'После полной оплаты' }, { value: 'paid-and-completed', label: 'После завершения и полной оплаты' }] })}
      ${select({ label: 'Повторяемость', name: 'recurrence', value: editingProgram?.recurrence || 'first', options: [{ value: 'first', label: 'Только первое успешное действие' }, { value: 'each', label: 'Каждое успешное действие' }, { value: 'first-n', label: 'Первые N успешных действий' }, { value: 'period', label: 'Действия в течение периода' }, { value: 'until-cap', label: 'До заданного общего лимита начислений' }] })}
      <div data-referral-recurrence-panel="first-n" hidden>${field({ label: 'Количество действий', name: 'recurrenceCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.recurrenceCount || editingProgram?.recurrenceValue || 1 })}</div>
      <div data-referral-recurrence-panel="period" hidden>${twoColumnLayout(field({ label: 'Срок', name: 'recurrencePeriodCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.recurrencePeriodCount || 30 }), select({ label: 'Период', name: 'recurrencePeriodUnit', value: editingProgram?.recurrencePeriodUnit || 'days', options: [{ value: 'days', label: 'Дней' }, { value: 'months', label: 'Месяцев' }] }), { ariaLabel: 'Период повторяемости' })}</div>
      <div data-referral-recurrence-panel="until-cap" hidden>${field({ label: 'Общий лимит начислений', name: 'recurrenceCap', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.recurrenceCap || editingProgram?.recurrenceValue || '' })}</div>
      ${select({ label: 'Кому доступна', name: 'assignment', value: editingProgram?.assignment || 'all', options: [{ value: 'all', label: 'Всем контактам' }, { value: 'selected', label: 'Выбранным контактам' }] })}
      <div class="form-error" data-referral-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-referral-save', aria: 'Сохранить реферальную программу' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  initReferralConstructor(layer, editingProgram);
  const form = layer.querySelector('[data-referral-form]');
  layer.querySelector('[data-referral-save]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-referral-error]');
    const validation = formValidationMessage(form);
    if (validation) { if (error) error.textContent = validation; return; }
    const values = formObject(form);
    const term = loyaltyTermData(values, 'referralTerm');
    if (term.type === 'range' && (!term.startDate || !term.endDate)) { if (error) error.textContent = 'Укажите начало и конец периода'; return; }
    if (term.type === 'range' && term.startDate > term.endDate) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания'; return; }
    const serviceIds = collectCheckList(form, '[data-referral-event-panel="service-items"] .ui-check-list input[type="checkbox"]');
    const event = values.qualifyingEvent || 'first-paid';
    let eventValue = '';
    if (event === 'first-n-paid') eventValue = String(Math.max(1, Number(values.eventCount || 1)));
    if (event === 'minimum-amount') eventValue = String(Math.max(0, Number(values.eventAmount || 0)));
    if (event === 'service-items') { if (!serviceIds.length) { if (error) error.textContent = 'Выберите позиции Сервиса'; return; } eventValue = serviceIds.map(serviceName).filter(Boolean).join(' · '); }
    if (event === 'paid-supported-event') eventValue = values.supportedEvent || 'sale';
    if (event === 'within-referral-period') eventValue = periodLabel(values.eventPeriodCount, values.eventPeriodUnit);
    const levels = Math.max(1, Math.floor(Number(values.levels || 1)));
    const levelRewards = Array.from({ length: levels }, (_, index) => {
      const level = index + 1;
      return { type: values[`level${level}Type`] || 'percent', value: Math.max(0, Number(String(values[`level${level}Value`] || '0').replace(',', '.')) || 0), base: baseLabel(values[`level${level}Base`]) };
    });
    const rewardExpiryType = values.rewardExpiryType || 'indefinite';
    const rewardExpiryCount = rewardExpiryType === 'duration' ? Math.max(1, Number(values.rewardExpiryCount || 1)) : 0;
    const rewardExpiryUnit = values.rewardExpiryUnit || 'days';
    const recurrence = values.recurrence || 'first';
    let recurrenceValue = '';
    if (recurrence === 'first-n') recurrenceValue = String(Math.max(1, Number(values.recurrenceCount || 1)));
    if (recurrence === 'period') recurrenceValue = periodLabel(values.recurrencePeriodCount, values.recurrencePeriodUnit);
    if (recurrence === 'until-cap') recurrenceValue = String(Math.max(0, Number(values.recurrenceCap || 0)));
    const next = {
      ...(editingProgram || {}),
      id: editingProgram?.id || uid('referral-program'),
      uei: normalizeOptionalUei(values.uei), name: values.name, description: values.description || '', term: term.label, termType: term.type, termStartDate: term.startDate, termEndDate: term.endDate,
      qualifyingEvent: event, eventValue, eventServiceIds: serviceIds, eventCount: values.eventCount || '', eventAmount: values.eventAmount || '', supportedEvent: values.supportedEvent || '', eventPeriodCount: values.eventPeriodCount || '', eventPeriodUnit: values.eventPeriodUnit || 'days', levels, levelRewards,
      capType: values.capType || 'none', capValue: values.capType === 'none' ? 0 : Math.max(0, Number(String(values.capValue || '0').replace(',', '.')) || 0),
      rewardExpiryType, rewardExpiryCount, rewardExpiryUnit, rewardExpiryValue: rewardExpiryType === 'duration' ? periodLabel(rewardExpiryCount, rewardExpiryUnit) : '',
      inviteeBenefit: values.inviteeBenefit || 'none', inviteeBenefitValue: values.inviteeBenefit === 'none' ? 0 : Math.max(0, Number(String(values.inviteeBenefitValue || '0').replace(',', '.')) || 0),
      rewardTiming: values.rewardTiming || 'paid-and-completed', recurrence, recurrenceValue, recurrenceCount: values.recurrenceCount || '', recurrencePeriodCount: values.recurrencePeriodCount || '', recurrencePeriodUnit: values.recurrencePeriodUnit || 'days', recurrenceCap: values.recurrenceCap || '', assignment: values.assignment || 'all', showToAll: editingProgram?.showToAll !== false, status: editingProgram?.status || 'active', createdAt: editingProgram?.createdAt || new Date().toISOString(),
    };
    if (editing) programs = programs.map((item) => item.id === next.id ? next : item);
    else programs.push(next);
    layer.v2Close?.();
    await rerender?.();
  });
  notifyLoyaltyContext();
  return layer;
}

async function openRelationLayer(root, relationId) {
  const relation = relations.find((item) => item.id === relationId);
  if (!relation) return null;
  const program = programs.find((item) => item.id === relation.programId) || {};
  const layer = mountModal(root, modal('<div data-referral-relation-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: `${relation.inviterName || '—'} → ${relation.inviteeName || '—'}`,
    className: 'loyalty-referral-relation-q',
  }));
  if (!layer) return null;

  const effectiveVisible = typeof relation.visibleToPersonOverride === 'boolean'
    ? relation.visibleToPersonOverride
    : program.showToAll !== false;
  const host = layer.querySelector('[data-referral-relation-q-host]');
  if (!host) return layer;
  host.innerHTML = page([
    loyaltyHeader(`${relation.inviterName || '—'} → ${relation.inviteeName || '—'}`, { settings: true, settingsData: 'data-referral-relation-settings' }),
    relationInfo(relation, program),
  ]);
  host.querySelector('[data-referral-relation-settings]')?.addEventListener('click', () => openLoyaltySettingsMenu({
    title: 'Реферальная связь',
    checked: effectiveVisible,
    onToggle: async (value) => {
      relation.visibleToPersonOverride = value;
      return value;
    },
  }));
  notifyLoyaltyContext();
  return layer;
}

async function openProgramLayer(root, programId, onChanged) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-referral-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    const program = programs.find((item) => item.id === programId);
    if (!program) { layer.v2Close?.(); await onChanged?.(); return; }
    const items = relations.filter((item) => item.programId === program.id);
    layer.innerHTML = page([
      loyaltyHeader(program.name || 'Реферальная программа', { settings: true, settingsData: 'data-referral-program-settings' }),
      v2Section('Связи', relationList(items)),
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'info', data: 'data-referral-info', aria: 'Условия реферальной программы' })]);
    layer.querySelector('[data-referral-info]')?.addEventListener('click', () => openConditions(program));
    layer.querySelector('[data-referral-program-settings]')?.addEventListener('click', () => openLoyaltyProgramSettings({
      title: program.name || 'Реферальная программа',
      status: program.status,
      visible: program.showToAll !== false,
      onVisibility: async (value) => {
        program.showToAll = value;
        await onChanged?.();
        return value;
      },
      onCorrect: () => openCreateProgramQ(root, async () => { await render(); await onChanged?.(); }, program),
      onToggle: async () => { program.status = program.status === 'paused' ? 'active' : 'paused'; await render(); await onChanged?.(); },
      onFinish: async () => { program.status = 'ended'; await render(); await onChanged?.(); },
      onDelete: async () => {
        programs = programs.filter((item) => item.id !== program.id);
        relations = relations.filter((item) => item.programId !== program.id);
        layer.v2Close?.();
        await onChanged?.();
      },
    }));
    layer.querySelectorAll('[data-referral-relation]').forEach((node) => node.addEventListener('click', () => openRelationLayer(root, text(node.dataset.referralRelation))));
    notifyLoyaltyContext();
  };
  await render();
  return layer;
}

export function getReferralAssignmentsForPerson(personKey = '') {
  const key = String(personKey || '');
  return programs
    .filter((program) => program?.status === 'active')
    .map((program) => {
      const relation = relations.find((item) => String(item?.programId || '') === String(program.id)
        && [item?.inviterKey, item?.inviteeKey, item?.personKey].some((value) => String(value || '') === key)) || null;
      if (program.assignment !== 'all' && !relation) return null;
      const visible = typeof relation?.visibleToPersonOverride === 'boolean'
        ? relation.visibleToPersonOverride
        : program.showToAll !== false;
      if (!visible) return null;
      return { program: { ...program }, relation: relation ? { ...relation } : null };
    })
    .filter(Boolean);
}

export async function renderReferral(root) {
  const render = async () => {
    const cards = programs.length ? entityCardStack(programs.map((program) => loyaltyVisualCard('referral', programCardFields(program), { data: `data-referral-program="${program.id}"`, aria: `Открыть ${program.name}` }))) : emptyState('Реферальных программ пока нет', 'Создайте первую программу кнопкой «+».');
    root.innerHTML = page([loyaltyHeader('Реферальная программа', { settings: true, c: { label: '+', data: 'data-referral-create', aria: 'Создать реферальную программу' } }), cards]);
    bindViewSettings(root, 'Реферальная программа', { type: 'referral', fields: () => programCardFields(programs[0] || { name: 'Реферальная программа', qualifyingEvent: 'first-paid', assignment: 'all', levels: 1, status: 'active' }), onSaved: render });
    root.querySelector('[data-referral-create]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    root.querySelectorAll('[data-referral-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, text(node.dataset.referralProgram), render)));
    notifyLoyaltyContext();
  };
  await render();
}
