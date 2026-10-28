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
  availablePeople,
  bindViewSettings,
  formObject,
  initOptionalUeiField,
  loyaltyCardFields,
  loyaltyHeader,
  loyaltyVisualCard,
  money,
  notifyLoyaltyContext,
  normalizeOptionalUei,
  openLoyaltyProgramSettings,
  openLoyaltySettingsMenu,
  optionalUeiField,
  personLabel,
  personOption,
  text,
  uid,
} from '../shared.js';

const fallbackPeople = [];

let programs = [
  {
    id: 'subscription-10', uei: '', name: '10 посещений', description: 'Десять использований выбранной позиции.', price: 30000,
    compositionMode: 'common-limit', procedureIds: [], procedureNames: ['Стрижка'], commonLimit: 10, quantityByProcedure: {},
    termType: 'duration', termCount: 12, termUnit: 'months', termEndDate: '', termValue: '12 мес.', startRule: 'issue', startDate: '', frequencyPeriod: 'none', frequencyLimit: 0,
    multiplePerEvent: false, status: 'active', createdAt: '2026-10-01T10:00:00.000Z',
  },
  {
    id: 'subscription-unlimited', uei: '', name: 'Годовой безлимит', description: 'Безлимит по выбранным позициям.', price: 90000,
    compositionMode: 'unlimited', procedureIds: [], procedureNames: ['Уход', 'Стрижка'], commonLimit: 0, quantityByProcedure: {},
    termType: 'duration', termCount: 12, termUnit: 'months', termEndDate: '', termValue: '12 мес.', startRule: 'first-use', startDate: '', frequencyPeriod: 'week', frequencyLimit: 2,
    multiplePerEvent: true, status: 'active', createdAt: '2026-10-02T10:00:00.000Z',
  },
];

let instances = [];

function statusLabel(status = '') {
  if (status === 'paused') return 'Приостановлен';
  if (status === 'ended' || status === 'closed') return 'Завершён';
  return 'Активен';
}

function compositionLabel(program = {}) {
  if (program.compositionMode === 'unlimited') return 'Безлимит';
  if (program.compositionMode === 'per-position') return 'Лимиты по позициям';
  if (program.compositionMode === 'single') return 'Одна позиция';
  return `Общий лимит ${Math.max(0, Number(program.commonLimit || 0))}`;
}

function startLabel(value) {
  if (value === 'first-use') return 'С первого использования';
  if (value === 'date') return 'С конкретной даты';
  return 'С оформления / покупки';
}

function frequencyLabel(program = {}) {
  const count = Math.max(0, Number(program.frequencyLimit || 0));
  if (!count || program.frequencyPeriod === 'none') return 'Без ограничения частоты';
  if (program.frequencyPeriod === 'day') return `Не более ${count} в день`;
  if (program.frequencyPeriod === 'month') return `Не более ${count} в месяц`;
  return `Не более ${count} в неделю`;
}

function termLabel({ termType = 'indefinite', termCount = 0, termUnit = 'months', termEndDate = '' } = {}) {
  if (termType === 'indefinite') return 'Бессрочно';
  if (termType === 'date') return termEndDate ? `До ${termEndDate}` : 'Период';
  const count = Math.max(1, Number(termCount || 1));
  const unit = termUnit === 'days' ? 'дн.' : termUnit === 'years' ? 'лет' : 'мес.';
  return `${count} ${unit}`;
}

function programCardFields(program = {}) {
  return loyaltyCardFields({
    uei: program.uei || '',
    title: program.name || 'Абонемент',
    subtitle: compositionLabel(program),
    status: statusLabel(program.status),
    metaLeft: program.termValue || termLabel(program),
    metaRight: money(program.price),
  });
}

function instanceProgress(instance = {}, program = {}) {
  if (program.compositionMode === 'unlimited') return 'Безлимит';
  const initial = Math.max(0, Number(instance.used || 0) + Number(instance.remaining || 0));
  return `${Math.max(0, Number(instance.used || 0))} из ${initial}`;
}

function programConditions(program = {}) {
  return [
    `UEI: ${program.uei || '—'}`,
    `Цена: ${money(program.price)}`,
    `Состав: ${compositionLabel(program)}`,
    `Позиции Сервиса: ${(program.procedureNames || []).filter(Boolean).join(' · ') || 'Не выбраны'}`,
    `Срок: ${program.termValue || termLabel(program)}`,
    `Начало срока: ${startLabel(program.startRule)}${program.startRule === 'date' && program.startDate ? ` — ${program.startDate}` : ''}`,
    `Частота: ${frequencyLabel(program)}`,
    `Несколько единиц за событие: ${program.multiplePerEvent ? 'Разрешено' : 'Нет'}`,
    `Состояние: ${statusLabel(program.status)}`,
    '',
    program.description || 'Дополнительные условия не указаны.',
  ].join('\n');
}

function instanceInfo(instance = {}, program = {}) {
  return details([
    { label: 'Владелец', value: instance.personName || '—' },
    { label: 'Абонемент', value: program.name || '—' },
    { label: 'Дата оформления', value: shortDateTime(instance.issuedAt, '—') },
    { label: 'Исходный состав', value: compositionLabel(program) },
    { label: 'Использовано', value: instanceProgress(instance, program) },
    { label: 'Остаток', value: program.compositionMode === 'unlimited' ? 'Безлимит' : String(Math.max(0, Number(instance.remaining || 0))) },
    { label: 'Начало', value: instance.startsAt || startLabel(program.startRule) },
    { label: 'Срок', value: instance.expiresAt || program.termValue || termLabel(program) },
    { label: 'Состояние', value: instance.status === 'closed' ? 'Завершён' : 'Активен' },
  ]);
}

function subscriptionHistory(instance = {}) {
  return [...(Array.isArray(instance.history) ? instance.history : [])].reverse();
}

function historyMarkup(instance = {}) {
  const history = subscriptionHistory(instance);
  if (!history.length) return emptyState('Истории пока нет', 'Использования абонемента появятся здесь.');
  return miniCardRail(history.map((item, index) => miniCard({
    title: item.title || 'Использование',
    value: item.procedure || 'Использование',
    subtitle: shortDateTime(item.occurredAt, '—'),
    interactive: true,
    data: `data-subscription-history-entry="${index}"`,
    aria: `Открыть ${String(item.title || 'использование').toLowerCase()}`,
  })));
}

function historyEventMarkup(item = {}) {
  const rows = [{ label: 'Дата', value: shortDateTime(item.occurredAt, '—') }];
  if (item.procedure) rows.push({ label: 'Процедура / товар', value: item.procedure });
  if (item.quantity != null) rows.push({ label: 'Количество', value: String(item.quantity) });
  if (item.remainingAfter != null) rows.push({ label: 'Остаток', value: String(item.remainingAfter) });
  rows.push({ label: 'Дата формирования', value: shortDateTime(item.recordedAt || item.createdAt || item.occurredAt, '—') });
  return details(rows);
}

function openHistoryEventS(root, item = {}) {
  return mountModal(root, modal(historyEventMarkup(item), {
    variant: 's',
    surface: 'app',
    title: item.title || 'Использование',
  }));
}

function issuedList(items = [], program = {}) {
  if (!items.length) return emptyState('Участников пока нет', 'Оформите абонемент контакту.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.personName || 'Без имени',
    subtitle: program.compositionMode === 'unlimited' ? 'Безлимит' : `Осталось ${Math.max(0, Number(item.remaining || 0))}`,
    rightTop: instanceProgress(item, program),
    interactive: true,
    initial: '',
    data: `data-subscription-instance="${item.id}"`,
    aria: `Открыть абонемент ${item.personName || ''}`,
  })));
}

function openConditions(program = {}) {
  return openDocumentViewer({ title: program.name || 'Условия абонемента', content: programConditions(program) });
}

function procedures() {
  return getProcedures().map((item) => ({ id: String(item.id || ''), name: item.name || 'Позиция Сервиса' })).filter((item) => item.id);
}

function procedureChecklist(selected = []) {
  const items = procedures();
  const chosen = new Set((Array.isArray(selected) ? selected : []).map(String));
  return items.length
    ? checkList(items.map((item) => ({ value: item.id, label: item.name, checked: chosen.has(item.id) })), { className: 'subscription-service-list' })
    : emptyState('Позиции Сервиса пока не созданы', 'Сначала добавьте позиции в Сервис.');
}

function procedureNameById(id = '') {
  return procedures().find((item) => item.id === String(id || ''))?.name || '';
}

function initSubscriptionConstructor(layer, editingProgram = null) {
  const form = layer?.querySelector?.('[data-subscription-form]');
  if (!form) return;
  initDatePickers(form);
  initCheckList(form);
  initOptionalUeiField(form);
  const composition = form.querySelector('[name="compositionMode"]');
  const termType = form.querySelector('[name="termType"]');
  const startRule = form.querySelector('[name="startRule"]');
  const frequency = form.querySelector('[name="frequencyPeriod"]');
  const quantityHost = form.querySelector('[data-subscription-quantity-fields]');
  const initialQuantities = editingProgram?.quantityByProcedure || {};

  const syncQuantities = () => {
    if (!quantityHost || !composition) return;
    const ids = collectCheckList(form, '[data-subscription-service-list] input[type="checkbox"]');
    if (composition.value === 'single' && ids.length > 1) {
      const keep = ids.at(-1);
      form.querySelectorAll('[data-subscription-service-list] input[type="checkbox"]').forEach((input) => {
        if (input.value !== keep) {
          input.checked = false;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      return;
    }
    const visible = composition.value === 'single' || composition.value === 'per-position';
    quantityHost.hidden = !visible;
    quantityHost.innerHTML = visible ? ids.map((id) => field({
      label: `Количество — ${procedureNameById(id) || 'позиция'}`,
      name: `quantity_${id}`,
      type: 'number',
      min: '1',
      step: '1',
      inputmode: 'numeric',
      value: initialQuantities[id] || 1,
    })).join('') : '';
  };

  const syncComposition = () => {
    const mode = composition?.value || 'common-limit';
    const common = form.querySelector('[data-subscription-common-limit]');
    if (common) common.hidden = mode !== 'common-limit';
    syncQuantities();
  };
  const syncTerm = () => {
    const value = termType?.value || 'duration';
    form.querySelectorAll('[data-subscription-term-panel]').forEach((panel) => { panel.hidden = panel.dataset.subscriptionTermPanel !== value; });
  };
  const syncStart = () => {
    const datePanel = form.querySelector('[data-subscription-start-date]');
    if (datePanel) datePanel.hidden = startRule?.value !== 'date';
  };
  const syncFrequency = () => {
    const limit = form.querySelector('[data-subscription-frequency-limit]');
    if (limit) limit.hidden = frequency?.value === 'none';
  };

  composition?.addEventListener('change', syncComposition);
  termType?.addEventListener('change', syncTerm);
  startRule?.addEventListener('change', syncStart);
  frequency?.addEventListener('change', syncFrequency);
  form.querySelector('[data-subscription-service-list]')?.addEventListener('change', syncQuantities);
  syncComposition();
  syncTerm();
  syncStart();
  syncFrequency();
}

function addPeriod(dateValue, count, unit) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const amount = Math.max(1, Number(count || 1));
  if (unit === 'days') date.setDate(date.getDate() + amount);
  else if (unit === 'years') date.setFullYear(date.getFullYear() + amount);
  else date.setMonth(date.getMonth() + amount);
  return date.toISOString().slice(0, 10);
}

function instanceDates(program = {}, issuedAt = '') {
  const startsAt = program.startRule === 'date' ? (program.startDate || '') : program.startRule === 'first-use' ? '' : issuedAt;
  if (program.termType === 'indefinite') return { startsAt, expiresAt: '' };
  if (program.termType === 'date') return { startsAt, expiresAt: program.termEndDate || '' };
  return { startsAt, expiresAt: startsAt ? addPeriod(startsAt, program.termCount, program.termUnit) : '' };
}

async function openCreateProgramQ(root, rerender, editingProgram = null) {
  const editing = Boolean(editingProgram?.id);
  const title = editing ? 'Корректировать абонемент' : 'Новый абонемент';
  const layer = mountModal(root, modal(`${loyaltyHeader(title)}
    <form class="form-grid" data-subscription-form>
      ${field({ label: 'Название', name: 'name', value: editingProgram?.name || '', required: true })}
      ${optionalUeiField({ name: 'uei', value: editingProgram?.uei || '' })}
      ${textareaField({ label: 'Описание / условия', name: 'description', value: editingProgram?.description || '' })}
      ${field({ label: 'Цена', name: 'price', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: editingProgram?.price || '' })}
      ${select({ label: 'Модель состава', name: 'compositionMode', value: editingProgram?.compositionMode || 'common-limit', options: [
        { value: 'single', label: 'Одна позиция с количеством' },
        { value: 'per-position', label: 'Несколько позиций с отдельным количеством' },
        { value: 'common-limit', label: 'Общий лимит на выбранные позиции' },
        { value: 'unlimited', label: 'Безлимит по выбранным позициям' },
      ] })}
      <div data-subscription-service-list>${procedureChecklist(editingProgram?.procedureIds || [])}</div>
      <div data-subscription-quantity-fields hidden></div>
      <div data-subscription-common-limit>${field({ label: 'Общий лимит', name: 'commonLimit', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.commonLimit || '' })}</div>
      ${select({ label: 'Срок действия', name: 'termType', value: editingProgram?.termType || 'duration', options: [
        { value: 'indefinite', label: 'Бессрочно' },
        { value: 'duration', label: 'Период' },
        { value: 'date', label: 'Период до даты' },
      ] })}
      <div data-subscription-term-panel="duration">${twoColumnLayout(
        field({ label: 'Количество', name: 'termCount', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.termCount || 12 }),
        select({ label: 'Период', name: 'termUnit', value: editingProgram?.termUnit || 'months', options: [{ value: 'days', label: 'Дней' }, { value: 'months', label: 'Месяцев' }, { value: 'years', label: 'Лет' }] }),
        { ariaLabel: 'Срок абонемента' },
      )}</div>
      <div data-subscription-term-panel="date" hidden>${datePicker({ label: 'До', name: 'termEndDate', value: editingProgram?.termEndDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}</div>
      ${select({ label: 'Начало срока', name: 'startRule', value: editingProgram?.startRule || 'issue', options: [
        { value: 'issue', label: 'С оформления / покупки' },
        { value: 'first-use', label: 'С первого использования' },
        { value: 'date', label: 'С даты' },
      ] })}
      <div data-subscription-start-date hidden>${datePicker({ label: 'Дата начала', name: 'startDate', value: editingProgram?.startDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}</div>
      ${select({ label: 'Ограничение частоты', name: 'frequencyPeriod', value: editingProgram?.frequencyPeriod || 'none', options: [
        { value: 'none', label: 'Без ограничения' },
        { value: 'day', label: 'Не более N раз в день' },
        { value: 'week', label: 'Не более N раз в неделю' },
        { value: 'month', label: 'Не более N раз в месяц' },
      ] })}
      <div data-subscription-frequency-limit hidden>${field({ label: 'N использований', name: 'frequencyLimit', type: 'number', min: '1', step: '1', inputmode: 'numeric', value: editingProgram?.frequencyLimit || 1 })}</div>
      ${select({ label: 'Несколько единиц за одно событие', name: 'multiplePerEvent', value: editingProgram?.multiplePerEvent ? 'yes' : 'no', options: [{ value: 'no', label: 'Нет' }, { value: 'yes', label: 'Да' }] })}
      <div class="form-error" data-subscription-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-subscription-save', aria: 'Сохранить программу абонемента' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  initSubscriptionConstructor(layer, editingProgram);
  const form = layer.querySelector('[data-subscription-form]');
  layer.querySelector('[data-subscription-save]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-subscription-error]');
    const validation = formValidationMessage(form);
    if (validation) { if (error) error.textContent = validation; return; }
    const values = formObject(form);
    const procedureIds = collectCheckList(form, '[data-subscription-service-list] input[type="checkbox"]');
    if (!procedureIds.length) { if (error) error.textContent = 'Выберите позиции Сервиса'; return; }
    if (values.compositionMode === 'single' && procedureIds.length !== 1) { if (error) error.textContent = 'Для этой модели выберите одну позицию'; return; }
    const procedureNames = procedureIds.map(procedureNameById).filter(Boolean);
    const quantityByProcedure = Object.fromEntries(procedureIds.map((id) => [id, Math.max(1, Number(values[`quantity_${id}`] || 1))]));
    const commonLimit = Math.max(0, Number(values.commonLimit || 0));
    if (values.compositionMode === 'common-limit' && !commonLimit) { if (error) error.textContent = 'Укажите общий лимит'; return; }
    const termType = values.termType || 'duration';
    const termCount = Math.max(1, Number(values.termCount || 1));
    const termUnit = values.termUnit || 'months';
    const termEndDate = values.termEndDate || '';
    if (termType === 'date' && !termEndDate) { if (error) error.textContent = 'Укажите дату окончания'; return; }
    if (values.startRule === 'date' && !values.startDate) { if (error) error.textContent = 'Укажите дату начала'; return; }
    if (values.startRule === 'date' && termType === 'date' && values.startDate > termEndDate) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания'; return; }
    const frequencyLimit = values.frequencyPeriod === 'none' ? 0 : Math.max(1, Number(values.frequencyLimit || 1));
    const next = {
      ...(editingProgram || {}),
      id: editingProgram?.id || uid('subscription-program'),
      uei: normalizeOptionalUei(values.uei),
      name: values.name,
      description: values.description || '',
      price: Math.max(0, Number(String(values.price || '0').replace(',', '.')) || 0),
      compositionMode: values.compositionMode || 'common-limit',
      procedureIds,
      procedureNames,
      commonLimit,
      quantityByProcedure,
      termType,
      termCount,
      termUnit,
      termEndDate,
      termValue: termLabel({ termType, termCount, termUnit, termEndDate }),
      startRule: values.startRule || 'issue',
      startDate: values.startDate || '',
      frequencyPeriod: values.frequencyPeriod || 'none',
      frequencyLimit,
      multiplePerEvent: values.multiplePerEvent === 'yes',
      showToAll: editingProgram?.showToAll !== false,
      status: editingProgram?.status || 'active',
      createdAt: editingProgram?.createdAt || new Date().toISOString(),
    };
    if (editing) programs = programs.map((item) => item.id === next.id ? next : item);
    else programs.push(next);
    layer.v2Close?.();
    await rerender?.();
  });
  notifyLoyaltyContext();
  return layer;
}

async function openIssueQ(root, program, rerender) {
  const people = availablePeople(fallbackPeople);
  const options = [{ value: '', label: 'Выберите контакт' }, ...people.map(personOption).filter((item) => item.value)];
  const today = new Date().toISOString().slice(0, 10);
  const dates = instanceDates(program, today);
  const layer = mountModal(root, modal(`${loyaltyHeader('Оформить абонемент')}
    <form class="form-grid" data-subscription-issue-form>
      ${select({ label: 'Контакт', name: 'personKey', value: '', options })}
      ${field({ label: 'Цена', name: 'price', type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: program.price || 0 })}
      ${datePicker({ label: 'Дата оформления', name: 'issuedAt', value: today, showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
      ${field({ label: 'Начало', name: 'startPreview', value: dates.startsAt || startLabel(program.startRule), disabled: true })}
      ${field({ label: 'Срок', name: 'termPreview', value: dates.expiresAt ? `До ${dates.expiresAt}` : (program.termValue || termLabel(program)), disabled: true })}
      <div class="form-error" data-subscription-issue-error></div>
      ${actionBlock(button('Оформить', { type: 'button', data: 'data-subscription-issue-save', aria: 'Оформить абонемент' }))}
    </form>`, { variant: 'q', surface: 'app', title: 'Оформить абонемент' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-subscription-issue-form]');
  layer.querySelector('[name="issuedAt"]')?.addEventListener('change', (event) => {
    const next = instanceDates(program, event.target.value || today);
    const start = layer.querySelector('[name="startPreview"]');
    const term = layer.querySelector('[name="termPreview"]');
    if (start) start.value = next.startsAt || startLabel(program.startRule);
    if (term) term.value = next.expiresAt ? `До ${next.expiresAt}` : (program.termValue || termLabel(program));
  });
  layer.querySelector('[data-subscription-issue-save]')?.addEventListener('click', async () => {
    const values = formObject(form);
    const error = layer.querySelector('[data-subscription-issue-error]');
    const person = people.find((item) => String(item?.key || item?.id || '') === String(values.personKey || ''));
    if (!person) { if (error) error.textContent = 'Укажите контакт'; return; }
    const total = program.compositionMode === 'unlimited'
      ? 0
      : program.compositionMode === 'common-limit'
        ? Math.max(0, Number(program.commonLimit || 0))
        : Object.values(program.quantityByProcedure || {}).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
    const resolvedDates = instanceDates(program, values.issuedAt);
    instances.push({
      id: uid('subscription-instance'),
      programId: program.id,
      personKey: String(person.key || person.id || ''),
      personName: personLabel(person),
      issuedAt: new Date(`${values.issuedAt}T12:00:00`).toISOString(),
      used: 0,
      remaining: total,
      status: 'active',
      startsAt: resolvedDates.startsAt || startLabel(program.startRule),
      expiresAt: resolvedDates.expiresAt || (program.termType === 'indefinite' ? 'Бессрочно' : program.termValue),
      history: [],
    });
    layer.v2Close?.();
    await rerender?.();
  });
  notifyLoyaltyContext();
  return layer;
}

async function openInstanceLayer(root, instanceId) {
  const instance = instances.find((item) => item.id === instanceId);
  if (!instance) return null;
  const program = programs.find((item) => item.id === instance.programId) || {};
  const layer = mountModal(root, modal('<div data-subscription-instance-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: program.name || 'Абонемент',
    className: 'loyalty-subscription-instance-q',
  }));
  if (!layer) return null;

  const render = () => {
    const effectiveVisible = typeof instance.visibleToPersonOverride === 'boolean'
      ? instance.visibleToPersonOverride
      : program.showToAll !== false;
    const history = subscriptionHistory(instance);
    const host = layer.querySelector('[data-subscription-instance-q-host]');
    if (!host) return;
    host.innerHTML = page([
      loyaltyHeader(program.name || 'Абонемент', { settings: true, settingsData: 'data-subscription-instance-settings' }),
      instanceInfo(instance, program),
      v2Section('История', historyMarkup(instance)),
    ]);
    host.querySelector('[data-subscription-instance-settings]')?.addEventListener('click', () => openLoyaltySettingsMenu({
      title: program.name || 'Абонемент',
      checked: effectiveVisible,
      onToggle: async (value) => {
        instance.visibleToPersonOverride = value;
        return value;
      },
    }));
    host.querySelectorAll('[data-subscription-history-entry]').forEach((node) => node.addEventListener('click', () => {
      const item = history[Number(node.dataset.subscriptionHistoryEntry)];
      if (item) openHistoryEventS(layer, item);
    }));
    notifyLoyaltyContext();
  };
  render();
  return layer;
}

async function openProgramLayer(root, programId, onChanged) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-subscription-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    const program = programs.find((item) => item.id === programId);
    if (!program) { layer.v2Close?.(); await onChanged?.(); return; }
    const issued = instances.filter((item) => item.programId === program.id);
    layer.innerHTML = page([
      loyaltyHeader(program.name || 'Абонемент', {
        settings: true,
        settingsData: 'data-subscription-program-settings',
      }),
      v2Section('Участники', issuedList(issued, program)),
      program.status === 'active' ? actionBlock(button('Оформить', { type: 'button', data: 'data-subscription-issue', aria: 'Оформить абонемент' })) : '',
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'info', data: 'data-subscription-info', aria: 'Условия абонемента' })]);
    layer.querySelector('[data-subscription-info]')?.addEventListener('click', () => openConditions(program));
    layer.querySelector('[data-subscription-program-settings]')?.addEventListener('click', () => openLoyaltyProgramSettings({
      title: program.name || 'Абонемент',
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
        instances = instances.filter((item) => item.programId !== program.id);
        layer.v2Close?.();
        await onChanged?.();
      },
    }));
    layer.querySelector('[data-subscription-issue]')?.addEventListener('click', () => openIssueQ(root, program, async () => {
      await render();
      await onChanged?.();
    }));
    layer.querySelectorAll('[data-subscription-instance]').forEach((node) => node.addEventListener('click', () => openInstanceLayer(root, text(node.dataset.subscriptionInstance))));
    notifyLoyaltyContext();
  };
  await render();
  return layer;
}

export function getSubscriptionAssignmentsForPerson(personKey = '') {
  const key = String(personKey || '');
  return instances
    .filter((instance) => String(instance?.personKey || '') === key)
    .filter((instance) => {
      const program = programs.find((item) => item.id === instance.programId) || {};
      return typeof instance.visibleToPersonOverride === 'boolean'
        ? instance.visibleToPersonOverride
        : program.showToAll !== false;
    })
    .map((instance) => ({
      instance: { ...instance },
      program: { ...(programs.find((program) => program.id === instance.programId) || {}) },
    }));
}

export async function renderSubscription(root) {
  const render = async () => {
    const cards = programs.length ? entityCardStack(programs.map((program) => loyaltyVisualCard('subscription', programCardFields(program), {
      data: `data-subscription-program="${program.id}"`,
      aria: `Открыть ${program.name}`,
    }))) : emptyState('Абонементов пока нет', 'Создайте первую программу кнопкой «+».');

    root.innerHTML = page([
      loyaltyHeader('Абонемент', {
        settings: true,
        c: { label: '+', data: 'data-subscription-create', aria: 'Создать программу абонемента' },
      }),
      cards,
    ]);
    bindViewSettings(root, 'Абонемент', {
      type: 'subscription',
      fields: () => programCardFields(programs[0] || { name: 'Абонемент', price: 30000, compositionMode: 'common-limit', commonLimit: 10, termType: 'duration', termCount: 12, termUnit: 'months', termValue: '12 мес.', status: 'active' }),
      onSaved: render,
    });
    root.querySelector('[data-subscription-create]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    root.querySelectorAll('[data-subscription-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, text(node.dataset.subscriptionProgram), render)));
    notifyLoyaltyContext();
  };
  await render();
}
