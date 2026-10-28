import {
  actionBlock,
  button,
  checkList,
  collectCheckList,
  datePicker,
  details,
  emptyState,
  entityCardStack,
  field,
  formValidationMessage,
  initCheckList,
  initDatePickers,
  miniCard,
  miniCardRail,
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
    id: 'bonus-cashback-5', uei: '', name: 'Кэшбэк 5%', description: '5% бонусами с каждой оплаченной операции.',
    term: 'Бессрочно', termType: 'indefinite', termStartDate: '', termEndDate: '', assignment: 'all', condition: 'each-paid', conditionValue: '', conditionServiceIds: [],
    rewardType: 'percent', rewardValue: 5, rewardBase: 'Сумма оплаченной операции', rewardPositionRules: [], rewardTiers: [],
    rewardExpiryType: 'duration', rewardExpiryCount: 90, rewardExpiryUnit: 'days', rewardExpiryValue: '90 дн.', recurrence: 'each', recurrenceValue: '', timing: 'paid-and-completed',
    status: 'active', createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'bonus-vip-10', uei: '', name: 'VIP 10%', description: '10% бонусами по выбранным условиям.',
    term: 'Бессрочно', termType: 'indefinite', termStartDate: '', termEndDate: '', assignment: 'selected', condition: 'minimum-amount', conditionValue: '5000', conditionServiceIds: [],
    rewardType: 'percent', rewardValue: 10, rewardBase: 'Сумма оплаченной операции', rewardPositionRules: [], rewardTiers: [],
    rewardExpiryType: 'indefinite', rewardExpiryCount: 0, rewardExpiryUnit: 'days', rewardExpiryValue: '', recurrence: 'each', recurrenceValue: '', timing: 'payment',
    status: 'active', createdAt: '2026-10-02T10:00:00.000Z',
  },
];

let participants = [];

function statusLabel(status = '') {
  if (status === 'paused') return 'Приостановлена';
  if (status === 'ended' || status === 'closed') return 'Завершена';
  return 'Активна';
}

function assignmentLabel(value = '') { return value === 'selected' ? 'Выбранным контактам' : 'Всем контактам'; }
function periodLabel(count = 0, unit = 'days') { const amount = Math.max(1, Number(count || 1)); return `${amount} ${unit === 'months' ? 'мес.' : unit === 'years' ? 'лет' : 'дн.'}`; }

function conditionLabel(value = '') {
  if (value === 'first-paid') return 'Первая оплаченная операция';
  if (value === 'every-n') return 'Каждая N-я операция';
  if (value === 'after-n') return 'После N операций';
  if (value === 'minimum-amount') return 'Операция не меньше заданной суммы';
  if (value === 'cumulative-amount') return 'Достижение накопленной суммы';
  if (value === 'service-items') return 'Выбранные позиции Сервиса';
  if (value === 'period') return 'Событие в заданный период';
  return 'Каждая оплаченная операция';
}

function rewardLabel(program = {}) {
  const value = Math.max(0, Number(program.rewardValue || 0));
  if (program.rewardType === 'fixed') return `${value} бонусов`;
  if (program.rewardType === 'tiered') return 'Ступенчатое начисление';
  if (program.rewardType === 'per-position') return 'По позициям Сервиса';
  return `${value}% бонусами`;
}

function expiryLabel(program = {}) {
  return program.rewardExpiryType === 'duration'
    ? (program.rewardExpiryValue || periodLabel(program.rewardExpiryCount, program.rewardExpiryUnit))
    : 'Бессрочно';
}

function timingLabel(value = '') {
  if (value === 'completion') return 'После завершения';
  if (value === 'payment') return 'После оплаты';
  return 'После завершения и оплаты';
}

function recurrenceLabel(program = {}) {
  if (program.recurrence === 'once') return 'Один раз';
  if (program.recurrence === 'first-n') return `Первые ${program.recurrenceValue || 'N'} раз`;
  if (program.recurrence === 'limited-period') return `Не чаще ${program.recurrenceValue || 'N за период'}`;
  return 'Каждый раз';
}

function programCardFields(program = {}) {
  return loyaltyCardFields({
    uei: program.uei || '',
    title: program.name || 'Бонусная программа',
    subtitle: conditionLabel(program.condition),
    status: statusLabel(program.status),
    metaLeft: assignmentLabel(program.assignment),
    metaRight: rewardLabel(program),
  });
}

function programConditions(program = {}) {
  return [
    `UEI: ${program.uei || '—'}`,
    `Срок программы: ${program.term || 'Бессрочно'}`,
    `Кому действует: ${assignmentLabel(program.assignment)}`,
    `Условие начисления: ${conditionLabel(program.condition)}`,
    `Параметр условия: ${program.conditionValue || '—'}`,
    `Размер начисления: ${rewardLabel(program)}`,
    `База: ${program.rewardBase || '—'}`,
    `Срок жизни награды: ${expiryLabel(program)}`,
    `Повторяемость: ${recurrenceLabel(program)}`,
    `Момент начисления: ${timingLabel(program.timing)}`,
    `Состояние: ${statusLabel(program.status)}`,
    '',
    program.description || 'Дополнительные условия не указаны.',
  ].join('\n');
}

function participantInfo(participant = {}, program = {}) {
  return details([
    { label: 'Контакт', value: participant.personName || '—' },
    { label: 'Программа', value: program.name || '—' },
    { label: 'Дата назначения', value: shortDateTime(participant.assignedAt, '—') },
    { label: 'Состояние', value: participant.assignmentStatus === 'active' ? 'Активна' : 'Отключена' },
    { label: 'Квалифицирующих событий', value: String(Math.max(0, Number(participant.qualifiedEvents || 0))) },
    { label: 'Начислено', value: `${Math.max(0, Number(participant.earned || 0))} бонусов` },
    { label: 'Использовано', value: `${Math.max(0, Number(participant.spent || 0))} бонусов` },
    { label: 'Доступно', value: `${Math.max(0, Number(participant.available || 0))} бонусов` },
    { label: 'Срок текущей награды', value: participant.rewardExpiry || expiryLabel(program) },
  ]);
}

function bonusHistory(participant = {}) {
  return [...(Array.isArray(participant.history) ? participant.history : [])].reverse();
}

function historyMarkup(participant = {}) {
  const history = bonusHistory(participant);
  if (!history.length) return emptyState('Истории пока нет', 'Начисления, списания и корректировки появятся здесь.');
  return miniCardRail(history.map((item, index) => {
    const amount = Number(item.amount || 0);
    return miniCard({
      title: item.title || 'Операция программы',
      value: `${amount >= 0 ? '+' : '−'}${Math.abs(amount)} бонусов`,
      subtitle: shortDateTime(item.occurredAt, '—'),
      rows: [{ label: 'Источник', value: item.source || '—' }],
      interactive: true,
      data: `data-bonus-history-entry="${index}"`,
      aria: `Открыть ${String(item.title || 'операция').toLowerCase()}`,
    });
  }));
}

function historyEventMarkup(item = {}) {
  const amount = Number(item.amount || 0);
  const rows = [
    { label: 'Дата', value: shortDateTime(item.occurredAt, '—') },
    { label: 'Сумма', value: `${amount >= 0 ? '+' : '−'}${Math.abs(amount)} бонусов` },
  ];
  if (item.source) rows.push({ label: 'Источник', value: item.source });
  if (item.balanceAfter != null || item.availableAfter != null) {
    rows.push({ label: 'Остаток', value: `${Math.max(0, Number(item.balanceAfter ?? item.availableAfter ?? 0))} бонусов` });
  }
  rows.push({ label: 'Дата формирования', value: shortDateTime(item.recordedAt || item.createdAt || item.occurredAt, '—') });
  return details(rows);
}

function openHistoryEventS(root, item = {}) {
  return mountModal(root, modal(historyEventMarkup(item), {
    variant: 's',
    surface: 'app',
    title: item.title || (Number(item.amount || 0) >= 0 ? 'Начисление' : 'Списание'),
  }));
}

function participantList(items = []) {
  if (!items.length) return emptyState('Участников пока нет', 'Контакты появятся здесь после назначения программы.');
  return v2ListEntries(items.map((participant) => v2ListEntry({
    title: participant.personName || 'Без имени',
    subtitle: participant.assignmentStatus === 'active' ? 'Активна' : 'Отключена',
    rightTop: `${Math.max(0, Number(participant.available || 0))} бонусов`,
    rightBottom: `Начислено ${Math.max(0, Number(participant.earned || 0))}`,
    interactive: true,
    initial: '',
    data: `data-bonus-participant="${participant.id}"`,
    aria: `Открыть результат программы ${participant.personName || ''}`,
  })));
}

function openConditions(program = {}) {
  return openDocumentViewer({ title: program.name || 'Условия бонусной программы', content: programConditions(program) });
}

function services() {
  return getProcedures().map((item) => ({ value: String(item.id || ''), label: item.name || 'Позиция Сервиса' })).filter((item) => item.value);
}

function serviceName(id = '') { return services().find((item) => item.value === String(id || ''))?.label || ''; }

function tierFields(index, tier = {}) {
  return `<div data-bonus-tier="${index}">${twoColumnLayout(
    field({ label: `Ступень ${index} — от суммы`, name: `tier${index}Threshold`, type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: tier.threshold || '' }),
    field({ label: `Ступень ${index} — %`, name: `tier${index}Value`, type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: tier.value || '' }),
    { ariaLabel: `Ступень ${index}` },
  )}</div>`;
}

function positionRewardFields(ids = [], rules = []) {
  return ids.map((id) => {
    const rule = rules.find((item) => String(item.serviceId || '') === String(id)) || {};
    return `<div data-bonus-position-rule="${id}">
      ${select({ label: serviceName(id) || 'Позиция', name: `position_${id}_type`, value: rule.type || 'percent', options: [{ value: 'fixed', label: 'Фиксированные бонусы' }, { value: 'percent', label: 'Процент' }] })}
      ${field({ label: 'Значение', name: `position_${id}_value`, type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: rule.value || '' })}
    </div>`;
  }).join('');
}

function initBonusConstructor(layer, editingProgram = null) {
  const form = layer?.querySelector?.('[data-bonus-form]');
  if (!form) return;
  initLoyaltyTermFields(form);
  initDatePickers(form);
  initCheckList(form);
  initOptionalUeiField(form);
  const condition = form.querySelector('[name="condition"]');
  const rewardType = form.querySelector('[name="rewardType"]');
  const expiry = form.querySelector('[name="rewardExpiryType"]');
  const recurrence = form.querySelector('[name="recurrence"]');
  const tierCount = form.querySelector('[name="tierCount"]');
  const tierHost = form.querySelector('[data-bonus-tiers]');
  const positionList = form.querySelector('[data-bonus-reward-position-list]');
  const positionHost = form.querySelector('[data-bonus-position-rules]');

  const showPanel = (attribute, value) => {
    form.querySelectorAll(`[${attribute}]`).forEach((panel) => {
      panel.hidden = panel.getAttribute(attribute) !== value;
    });
  };
  const syncCondition = () => showPanel('data-bonus-condition-panel', condition?.value || 'each-paid');
  const syncReward = () => showPanel('data-bonus-reward-panel', rewardType?.value || 'percent');
  const syncExpiry = () => { const node = form.querySelector('[data-bonus-expiry-duration]'); if (node) node.hidden = expiry?.value !== 'duration'; };
  const syncRecurrence = () => showPanel('data-bonus-recurrence-panel', recurrence?.value || 'each');
  const renderTiers = () => {
    const count = Math.max(1, Math.floor(Number(tierCount?.value || 1)));
    if (tierCount) tierCount.value = String(count);
    if (tierHost) tierHost.innerHTML = Array.from({ length: count }, (_, index) => tierFields(index + 1, editingProgram?.rewardTiers?.[index] || {})).join('');
  };
  const renderPositionRules = () => {
    if (!positionHost || !positionList) return;
    const ids = collectCheckList(positionList);
    positionHost.innerHTML = positionRewardFields(ids, editingProgram?.rewardPositionRules || []);
  };

  condition?.addEventListener('change', syncCondition);
  rewardType?.addEventListener('change', syncReward);
  expiry?.addEventListener('change', syncExpiry);
  recurrence?.addEventListener('change', syncRecurrence);
  tierCount?.addEventListener('input', renderTiers);
  positionList?.addEventListener('change', renderPositionRules);
  syncCondition(); syncReward(); syncExpiry(); syncRecurrence(); renderTiers(); renderPositionRules();
}

async function openCreateProgramQ(root, rerender, editingProgram = null) {
  const editing = Boolean(editingProgram?.id);
  const title = editing ? 'Корректировать бонусную программу' : 'Новая бонусная программа';
  const serviceItems = services();
  const conditionChosen = new Set((editingProgram?.conditionServiceIds || []).map(String));
  const rewardChosen = new Set((editingProgram?.rewardPositionRules || []).map((item) => String(item.serviceId || '')));
  const conditionServiceList = serviceItems.length
    ? checkList(serviceItems.map((item) => ({ ...item, checked: conditionChosen.has(item.value) })), { className: 'bonus-condition-service-list' })
    : emptyState('Позиции Сервиса пока не созданы', 'Сначала добавьте позиции в Сервис.');
  const rewardServiceList = serviceItems.length
    ? checkList(serviceItems.map((item) => ({ ...item, checked: rewardChosen.has(item.value) })), { className: 'bonus-reward-service-list' })
    : emptyState('Позиции Сервиса пока не созданы', 'Сначала добавьте позиции в Сервис.');
  const termMode = editingProgram?.termType || 'indefinite';
  const conditionValue = editingProgram?.conditionValue || '';
  const layer = mountModal(root, modal(`${loyaltyHeader(title)}
    <form class="form-grid" data-bonus-form>
      ${field({ label: 'Название', name: 'name', value: editingProgram?.name || '', required: true })}
      ${optionalUeiField({ name: 'uei', value: editingProgram?.uei || '' })}
      ${textareaField({ label: 'Описание / условия', name: 'description', value: editingProgram?.description || '' })}
      ${loyaltyTermFields({ prefix: 'bonusTerm', label: 'Срок программы', mode: termMode, allowDuration: false, allowRange: true, startDate: editingProgram?.termStartDate || '', endDate: editingProgram?.termEndDate || '' })}
      ${select({ label: 'Кому действует', name: 'assignment', value: editingProgram?.assignment || 'all', options: [
        { value: 'all', label: 'Всем контактам' },
        { value: 'selected', label: 'Выбранным контактам' },
      ] })}
      ${select({ label: 'Условие начисления', name: 'condition', value: editingProgram?.condition || 'each-paid', options: [
        { value: 'each-paid', label: 'Каждая оплаченная операция' }, { value: 'first-paid', label: 'Первая оплаченная операция' },
        { value: 'every-n', label: 'Каждая N-я операция' }, { value: 'after-n', label: 'После N операций' },
        { value: 'minimum-amount', label: 'Операция не меньше заданной суммы' }, { value: 'cumulative-amount', label: 'Достижение накопленной суммы' },
        { value: 'service-items', label: 'Выбранные позиции Сервиса' }, { value: 'period', label: 'Событие в заданный период' },
      ] })}
      <div data-bonus-condition-panel="every-n" hidden>${field({ label: 'Каждая N-я операция', name: 'conditionCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.conditionCount || (editingProgram?.condition === 'every-n' ? conditionValue : 2) })}</div>
      <div data-bonus-condition-panel="after-n" hidden>${field({ label: 'После N операций', name: 'conditionCountAfter', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.conditionCountAfter || (editingProgram?.condition === 'after-n' ? conditionValue : 5) })}</div>
      <div data-bonus-condition-panel="minimum-amount" hidden>${field({ label: 'Минимальная сумма', name: 'conditionAmount', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.conditionAmount || (editingProgram?.condition === 'minimum-amount' ? conditionValue : '') })}</div>
      <div data-bonus-condition-panel="cumulative-amount" hidden>${field({ label: 'Накопленная сумма', name: 'conditionCumulative', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.conditionCumulative || (editingProgram?.condition === 'cumulative-amount' ? conditionValue : '') })}</div>
      <div data-bonus-condition-panel="service-items" hidden>${conditionServiceList}</div>
      <div data-bonus-condition-panel="period" hidden>${twoColumnLayout(
        datePicker({ label: 'С', name: 'conditionStartDate', value: editingProgram?.conditionStartDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        datePicker({ label: 'До', name: 'conditionEndDate', value: editingProgram?.conditionEndDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        { ariaLabel: 'Период условия' },
      )}</div>
      ${select({ label: 'Размер начисления', name: 'rewardType', value: editingProgram?.rewardType || 'percent', options: [
        { value: 'fixed', label: 'Фиксированное количество бонусов' }, { value: 'percent', label: 'Процент от денежной базы' },
        { value: 'per-position', label: 'Отдельно по позициям Сервиса' }, { value: 'tiered', label: 'Ступенчатое правило' },
      ] })}
      <div data-bonus-reward-panel="fixed" hidden>${field({ label: 'Бонусов', name: 'rewardFixedValue', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.rewardType === 'fixed' ? editingProgram.rewardValue : '' })}</div>
      <div data-bonus-reward-panel="percent">${twoColumnLayout(
        field({ label: 'Процент', name: 'rewardPercentValue', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.rewardType === 'percent' ? editingProgram.rewardValue : 5 }),
        select({ label: 'База', name: 'rewardBase', value: String(editingProgram?.rewardBase || '').includes('выбран') ? 'items' : 'operation', options: [{ value: 'operation', label: 'Сумма оплаченной операции' }, { value: 'items', label: 'Сумма выбранных позиций' }] }),
        { ariaLabel: 'Процентное начисление' },
      )}</div>
      <div data-bonus-reward-panel="per-position" hidden><div data-bonus-reward-position-list>${rewardServiceList}</div><div data-bonus-position-rules></div></div>
      <div data-bonus-reward-panel="tiered" hidden>
        ${field({ label: 'Количество ступеней', name: 'tierCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: Math.max(1, editingProgram?.rewardTiers?.length || 3) })}
        <div data-bonus-tiers></div>
      </div>
      ${select({ label: 'Срок жизни награды', name: 'rewardExpiryType', value: editingProgram?.rewardExpiryType || 'indefinite', options: [{ value: 'indefinite', label: 'Бессрочно' }, { value: 'duration', label: 'Период после начисления' }] })}
      <div data-bonus-expiry-duration hidden>${twoColumnLayout(
        field({ label: 'Количество', name: 'rewardExpiryCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.rewardExpiryCount || 90 }),
        select({ label: 'Период', name: 'rewardExpiryUnit', value: editingProgram?.rewardExpiryUnit || 'days', options: [{ value: 'days', label: 'Дней' }, { value: 'months', label: 'Месяцев' }] }),
        { ariaLabel: 'Срок жизни награды' },
      )}</div>
      ${select({ label: 'Повторяемость', name: 'recurrence', value: editingProgram?.recurrence || 'each', options: [
        { value: 'once', label: 'Один раз' }, { value: 'each', label: 'Каждый раз' }, { value: 'first-n', label: 'Первые N раз' }, { value: 'limited-period', label: 'Не чаще N раз за период' },
      ] })}
      <div data-bonus-recurrence-panel="first-n" hidden>${field({ label: 'Количество начислений', name: 'recurrenceCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.recurrenceCount || (editingProgram?.recurrence === 'first-n' ? editingProgram?.recurrenceValue : 1) })}</div>
      <div data-bonus-recurrence-panel="limited-period" hidden>${twoColumnLayout(
        field({ label: 'Не чаще N раз', name: 'recurrenceLimit', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.recurrenceLimit || 1 }),
        select({ label: 'За период', name: 'recurrencePeriod', value: editingProgram?.recurrencePeriod || 'day', options: [{ value: 'day', label: 'День' }, { value: 'week', label: 'Неделю' }, { value: 'month', label: 'Месяц' }] }),
        { ariaLabel: 'Ограничение повторяемости' },
      )}</div>
      ${select({ label: 'Момент начисления', name: 'timing', value: editingProgram?.timing || 'paid-and-completed', options: [
        { value: 'completion', label: 'После завершения' }, { value: 'payment', label: 'После оплаты' }, { value: 'paid-and-completed', label: 'После завершения и оплаты' },
      ] })}
      <div class="form-error" data-bonus-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-bonus-save', aria: 'Сохранить бонусную программу' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  initBonusConstructor(layer, editingProgram);
  const form = layer.querySelector('[data-bonus-form]');
  layer.querySelector('[data-bonus-save]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-bonus-error]');
    const validation = formValidationMessage(form);
    if (validation) { if (error) error.textContent = validation; return; }
    const values = formObject(form);
    const term = loyaltyTermData(values, 'bonusTerm');
    if (term.type === 'range' && (!term.startDate || !term.endDate)) { if (error) error.textContent = 'Укажите начало и конец периода'; return; }
    if (term.type === 'range' && term.startDate > term.endDate) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания'; return; }

    const condition = values.condition || 'each-paid';
    const conditionServiceIds = collectCheckList(form, '[data-bonus-condition-panel="service-items"] .ui-check-list input[type="checkbox"]');
    let conditionValue = '';
    if (condition === 'every-n') conditionValue = String(Math.max(1, Number(values.conditionCount || 1)));
    if (condition === 'after-n') conditionValue = String(Math.max(1, Number(values.conditionCountAfter || 1)));
    if (condition === 'minimum-amount') conditionValue = String(Math.max(0, Number(values.conditionAmount || 0)));
    if (condition === 'cumulative-amount') conditionValue = String(Math.max(0, Number(values.conditionCumulative || 0)));
    if (condition === 'service-items') {
      if (!conditionServiceIds.length) { if (error) error.textContent = 'Выберите позиции Сервиса'; return; }
      conditionValue = conditionServiceIds.map(serviceName).filter(Boolean).join(' · ');
    }
    if (condition === 'period') {
      if (!values.conditionStartDate || !values.conditionEndDate) { if (error) error.textContent = 'Укажите начало и конец периода'; return; }
      if (values.conditionStartDate > values.conditionEndDate) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания'; return; }
      conditionValue = `${values.conditionStartDate} — ${values.conditionEndDate}`;
    }

    const rewardType = values.rewardType || 'percent';
    let rewardValue = 0;
    let rewardBase = 'Сумма оплаченной операции';
    let rewardPositionRules = [];
    let rewardTiers = [];
    if (rewardType === 'fixed') rewardValue = Math.max(0, Number(values.rewardFixedValue || 0));
    if (rewardType === 'percent') {
      rewardValue = Math.max(0, Number(values.rewardPercentValue || 0));
      rewardBase = values.rewardBase === 'items' ? 'Сумма выбранных позиций' : 'Сумма оплаченной операции';
    }
    if (rewardType === 'per-position') {
      const ids = collectCheckList(form, '[data-bonus-reward-position-list] .ui-check-list input[type="checkbox"]');
      if (!ids.length) { if (error) error.textContent = 'Выберите позиции Сервиса для начисления'; return; }
      rewardPositionRules = ids.map((id) => ({ serviceId: id, serviceName: serviceName(id), type: values[`position_${id}_type`] || 'percent', value: Math.max(0, Number(values[`position_${id}_value`] || 0)) }));
    }
    if (rewardType === 'tiered') {
      const count = Math.max(1, Math.floor(Number(values.tierCount || 1)));
      rewardTiers = Array.from({ length: count }, (_, index) => ({ threshold: Math.max(0, Number(values[`tier${index + 1}Threshold`] || 0)), value: Math.max(0, Number(values[`tier${index + 1}Value`] || 0)) }));
    }

    const rewardExpiryType = values.rewardExpiryType || 'indefinite';
    const rewardExpiryCount = rewardExpiryType === 'duration' ? Math.max(1, Number(values.rewardExpiryCount || 1)) : 0;
    const rewardExpiryUnit = values.rewardExpiryUnit || 'days';
    const recurrence = values.recurrence || 'each';
    let recurrenceValue = '';
    if (recurrence === 'first-n') recurrenceValue = String(Math.max(1, Number(values.recurrenceCount || 1)));
    if (recurrence === 'limited-period') {
      const period = values.recurrencePeriod === 'week' ? 'неделю' : values.recurrencePeriod === 'month' ? 'месяц' : 'день';
      recurrenceValue = `${Math.max(1, Number(values.recurrenceLimit || 1))} за ${period}`;
    }

    const next = {
      ...(editingProgram || {}),
      id: editingProgram?.id || uid('bonus-program'),
      uei: normalizeOptionalUei(values.uei), name: values.name, description: values.description || '', term: term.label, termType: term.type, termStartDate: term.startDate, termEndDate: term.endDate,
      assignment: values.assignment || 'all', condition, conditionValue, conditionServiceIds,
      conditionCount: values.conditionCount || '', conditionCountAfter: values.conditionCountAfter || '', conditionAmount: values.conditionAmount || '', conditionCumulative: values.conditionCumulative || '', conditionStartDate: values.conditionStartDate || '', conditionEndDate: values.conditionEndDate || '',
      rewardType, rewardValue, rewardBase, rewardPositionRules, rewardTiers,
      rewardExpiryType, rewardExpiryCount, rewardExpiryUnit, rewardExpiryValue: rewardExpiryType === 'duration' ? periodLabel(rewardExpiryCount, rewardExpiryUnit) : '',
      recurrence, recurrenceValue, recurrenceCount: values.recurrenceCount || '', recurrenceLimit: values.recurrenceLimit || '', recurrencePeriod: values.recurrencePeriod || 'day',
      timing: values.timing || 'paid-and-completed', showToAll: editingProgram?.showToAll !== false, status: editingProgram?.status || 'active', createdAt: editingProgram?.createdAt || new Date().toISOString(),
    };
    if (editing) programs = programs.map((item) => item.id === next.id ? next : item);
    else programs.push(next);
    layer.v2Close?.();
    await rerender?.();
  });
  notifyLoyaltyContext();
  return layer;
}

async function openParticipantLayer(root, participantId) {
  const participant = participants.find((item) => item.id === participantId);
  if (!participant) return null;
  const program = programs.find((item) => item.id === participant.programId) || {};
  const layer = mountModal(root, modal('<div data-bonus-participant-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: participant.personName || 'Участник программы',
    className: 'loyalty-bonus-participant-q',
  }));
  if (!layer) return null;

  const render = () => {
    const effectiveVisible = typeof participant.visibleToPersonOverride === 'boolean'
      ? participant.visibleToPersonOverride
      : program.showToAll !== false;
    const history = bonusHistory(participant);
    const host = layer.querySelector('[data-bonus-participant-q-host]');
    if (!host) return;
    host.innerHTML = page([
      loyaltyHeader(participant.personName || 'Участник программы', { settings: true, settingsData: 'data-bonus-participant-settings' }),
      participantInfo(participant, program),
      v2Section('История', historyMarkup(participant)),
    ]);
    host.querySelector('[data-bonus-participant-settings]')?.addEventListener('click', () => openLoyaltySettingsMenu({
      title: participant.personName || 'Бонусная программа',
      checked: effectiveVisible,
      onToggle: async (value) => {
        participant.visibleToPersonOverride = value;
        return value;
      },
    }));
    host.querySelectorAll('[data-bonus-history-entry]').forEach((node) => node.addEventListener('click', () => {
      const item = history[Number(node.dataset.bonusHistoryEntry)];
      if (item) openHistoryEventS(layer, item);
    }));
    notifyLoyaltyContext();
  };
  render();
  return layer;
}

async function openProgramLayer(root, programId, onChanged) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-bonus-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    const program = programs.find((item) => item.id === programId);
    if (!program) { layer.v2Close?.(); await onChanged?.(); return; }
    const items = participants.filter((item) => item.programId === program.id);
    layer.innerHTML = page([
      loyaltyHeader(program.name || 'Бонусная программа', { settings: true, settingsData: 'data-bonus-program-settings' }),
      v2Section('Участники', participantList(items)),
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'info', data: 'data-bonus-info', aria: 'Условия бонусной программы' })]);
    layer.querySelector('[data-bonus-info]')?.addEventListener('click', () => openConditions(program));
    layer.querySelector('[data-bonus-program-settings]')?.addEventListener('click', () => openLoyaltyProgramSettings({
      title: program.name || 'Бонусная программа',
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
        participants = participants.filter((item) => item.programId !== program.id);
        layer.v2Close?.();
        await onChanged?.();
      },
    }));
    layer.querySelectorAll('[data-bonus-participant]').forEach((node) => node.addEventListener('click', () => openParticipantLayer(root, text(node.dataset.bonusParticipant))));
    notifyLoyaltyContext();
  };
  await render();
  return layer;
}

export function getBonusAssignmentsForPerson(personKey = '') {
  const key = String(personKey || '');
  return programs
    .filter((program) => program?.status === 'active')
    .map((program) => {
      const participant = participants.find((item) => String(item?.programId || '') === String(program.id)
        && String(item?.personKey || '') === key) || null;
      if (program.assignment !== 'all' && !participant) return null;
      const visible = typeof participant?.visibleToPersonOverride === 'boolean'
        ? participant.visibleToPersonOverride
        : program.showToAll !== false;
      if (!visible) return null;
      return { program: { ...program }, participant: participant ? { ...participant } : null };
    })
    .filter(Boolean);
}

export async function renderBonus(root) {
  const render = async () => {
    const cards = programs.length
      ? entityCardStack(programs.map((program) => loyaltyVisualCard('bonus', programCardFields(program), {
          data: `data-bonus-program="${program.id}"`,
          aria: `Открыть ${program.name}`,
        })))
      : emptyState('Бонусных программ пока нет', 'Создайте первую программу кнопкой «+».');

    root.innerHTML = page([
      loyaltyHeader('Бонусная программа', {
        settings: true,
        c: { label: '+', data: 'data-bonus-create', aria: 'Создать бонусную программу' },
      }),
      cards,
    ]);
    bindViewSettings(root, 'Бонусная программа', {
      type: 'bonus',
      fields: () => programCardFields(programs[0] || { name: 'Бонусная программа', condition: 'each-paid', assignment: 'all', rewardType: 'percent', rewardValue: 5, status: 'active' }),
      onSaved: render,
    });
    root.querySelector('[data-bonus-create]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    root.querySelectorAll('[data-bonus-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, text(node.dataset.bonusProgram), render)));
    notifyLoyaltyContext();
  };
  await render();
}
