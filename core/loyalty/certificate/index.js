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
  initLoyaltyTermFields,
  initOptionalUeiField,
  loyaltyCardFields,
  loyaltyHeader,
  loyaltyTermData,
  loyaltyTermFields,
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
  { id: 'certificate-10000', uei: '', name: 'Подарочный 10 000', type: 'amount', amount: 10000, service: '', serviceIds: [], term: '12 мес.', termType: 'duration', termCount: 12, termUnit: 'months', termStartDate: '', termEndDate: '', partial: true, status: 'active', description: 'Можно использовать частями.', createdAt: '2026-10-01T10:00:00.000Z' },
  { id: 'certificate-care', uei: '', name: 'Уход в подарок', type: 'service', amount: 0, service: 'Уход', serviceIds: [], term: '6 мес.', termType: 'duration', termCount: 6, termUnit: 'months', termStartDate: '', termEndDate: '', partial: false, status: 'active', description: '', createdAt: '2026-10-02T10:00:00.000Z' },
];

let instances = [];

function typeLabel(type) {
  if (type === 'service') return 'На позицию Сервиса';
  if (type === 'bundle') return 'На набор позиций';
  return 'На сумму';
}

function statusLabel(status = '') {
  if (status === 'paused') return 'Приостановлен';
  if (status === 'ended' || status === 'closed') return 'Завершён';
  return 'Активен';
}

function serviceOptions() {
  const items = getProcedures();
  return [{ value: '', label: items.length ? 'Выберите позицию' : 'Позиции Сервиса пока не созданы' }, ...items.map((item) => ({ value: String(item.id || ''), label: item.name || 'Позиция Сервиса' })).filter((item) => item.value)];
}

function serviceName(id = '') {
  return getProcedures().find((item) => String(item.id || '') === String(id || ''))?.name || '';
}

function serviceChecklist(selected = []) {
  const chosen = new Set((Array.isArray(selected) ? selected : []).map(String));
  return checkList(getProcedures().map((item) => ({
    value: String(item.id || ''),
    label: item.name || 'Позиция Сервиса',
    checked: chosen.has(String(item.id || '')),
  })).filter((item) => item.value));
}

function programRight(program = {}) {
  if (program.type === 'amount') return money(program.amount);
  return program.service || typeLabel(program.type);
}

function instanceRight(instance = {}) {
  const program = programs.find((item) => item.id === instance.programId);
  if (program?.type === 'amount') return `${money(instance.balance)} осталось`;
  return instance.status === 'used' ? 'Использован' : 'Активен';
}

function programCardFields(program = {}) {
  return loyaltyCardFields({
    uei: program.uei || '',
    title: program.name || 'Сертификат',
    subtitle: typeLabel(program.type),
    status: statusLabel(program.status),
    metaLeft: program.term || 'Бессрочно',
    metaRight: programRight(program),
  });
}

function programConditions(program = {}) {
  return [
    `UEI: ${program.uei || '—'}`,
    `Тип: ${typeLabel(program.type)}`,
    `Номинал / право: ${programRight(program)}`,
    `Срок: ${program.term || 'Бессрочно'}`,
    `Частичное использование: ${program.partial ? 'Разрешено' : 'Нет'}`,
    `Состояние: ${statusLabel(program.status)}`,
    '',
    program.description || 'Дополнительные условия не указаны.',
  ].join('\n');
}

function instanceInfo(instance = {}) {
  const program = programs.find((item) => item.id === instance.programId) || {};
  return details([
    { label: 'Владелец', value: instance.ownerName || '—' },
    { label: 'Покупатель', value: instance.buyerName || '—' },
    { label: 'Сертификат', value: program.name || '—' },
    { label: 'Исходное право', value: program.type === 'amount' ? money(instance.initialValue) : programRight(program) },
    { label: 'Остаток', value: program.type === 'amount' ? money(instance.balance) : instanceRight(instance) },
    { label: 'Дата оформления', value: shortDateTime(instance.issuedAt, '—') },
    { label: 'Срок', value: instance.expiresAt || program.term || 'Бессрочно' },
    { label: 'Состояние', value: instance.status === 'used' ? 'Использован' : 'Активен' },
  ]);
}

function certificateHistory(instance = {}) {
  return [...(Array.isArray(instance.history) ? instance.history : [])].reverse();
}

function historyMarkup(instance = {}) {
  const history = certificateHistory(instance);
  if (!history.length) return emptyState('Истории пока нет', 'Использования сертификата появятся здесь.');
  return miniCardRail(history.map((item, index) => miniCard({
    title: item.title || 'Использование',
    value: item.amount ? `−${money(item.amount)}` : 'Использование',
    subtitle: shortDateTime(item.occurredAt, '—'),
    interactive: true,
    data: `data-certificate-history-entry="${index}"`,
    aria: `Открыть ${String(item.title || 'использование').toLowerCase()}`,
  })));
}

function historyEventMarkup(item = {}) {
  const rows = [{ label: 'Дата', value: shortDateTime(item.occurredAt, '—') }];
  if (item.procedure || item.service || item.product) rows.push({ label: 'Позиция', value: item.procedure || item.service || item.product });
  if (item.amount != null) rows.push({ label: 'Сумма', value: `−${money(item.amount)}` });
  if (item.balanceAfter != null) rows.push({ label: 'Остаток', value: money(item.balanceAfter) });
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

function issuedList(items = []) {
  if (!items.length) return emptyState('Оформленных сертификатов пока нет', 'Оформите сертификат контакту.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.ownerName || 'Без имени',
    subtitle: item.buyerName && item.buyerName !== item.ownerName ? `Покупатель: ${item.buyerName}` : 'Покупатель = владелец',
    rightTop: instanceRight(item),
    interactive: true,
    initial: '',
    data: `data-certificate-instance="${item.id}"`,
    aria: `Открыть сертификат ${item.ownerName || ''}`,
  })));
}

function openConditions(program = {}) {
  return openDocumentViewer({ title: program.name || 'Условия сертификата', content: programConditions(program) });
}

function initCertificateTypeFields(layer) {
  const form = layer?.querySelector?.('[data-certificate-form]');
  const type = form?.querySelector?.('[name="type"]');
  if (!form || !type) return;
  const sync = () => {
    form.querySelectorAll('[data-certificate-type-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.certificateTypePanel !== type.value;
    });
  };
  type.addEventListener('change', sync);
  sync();
  initCheckList(form);
}

function expiryFromProgram(program = {}, issuedDate = '') {
  if (program.termType === 'indefinite') return '';
  if (program.termType === 'range') return program.termEndDate || '';
  if (program.termType !== 'duration' || !issuedDate) return '';
  const date = new Date(`${issuedDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  const count = Math.max(1, Number(program.termCount || 1));
  if (program.termUnit === 'days') date.setDate(date.getDate() + count);
  else if (program.termUnit === 'years') date.setFullYear(date.getFullYear() + count);
  else date.setMonth(date.getMonth() + count);
  return date.toISOString().slice(0, 10);
}

async function openCreateProgramQ(root, rerender, editingProgram = null) {
  const editing = Boolean(editingProgram?.id);
  const title = editing ? 'Корректировать сертификат' : 'Новый сертификат';
  const selectedIds = Array.isArray(editingProgram?.serviceIds) ? editingProgram.serviceIds : [];
  const singleServiceId = editingProgram?.type === 'service' ? String(selectedIds[0] || '') : '';
  const termMode = editingProgram?.termType || 'indefinite';
  const layer = mountModal(root, modal(`${loyaltyHeader(title)}
    <form class="form-grid" data-certificate-form>
      ${field({ label: 'Название', name: 'name', value: editingProgram?.name || '', required: true })}
      ${optionalUeiField({ name: 'uei', value: editingProgram?.uei || '' })}
      ${select({ label: 'Тип', name: 'type', value: editingProgram?.type || 'amount', options: [
        { value: 'amount', label: 'На сумму' },
        { value: 'service', label: 'На позицию Сервиса' },
        { value: 'bundle', label: 'На набор позиций' },
      ] })}
      <div data-certificate-type-panel="amount">${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: editingProgram?.amount || '' })}</div>
      <div data-certificate-type-panel="service" hidden>${select({ label: 'Позиция Сервиса', name: 'serviceId', value: singleServiceId, options: serviceOptions() })}</div>
      <div data-certificate-type-panel="bundle" hidden>${serviceChecklist(editingProgram?.type === 'bundle' ? selectedIds : [])}</div>
      ${loyaltyTermFields({
        prefix: 'certificateTerm',
        label: 'Срок действия',
        mode: termMode,
        allowDuration: true,
        allowRange: true,
        count: editingProgram?.termCount || '',
        unit: editingProgram?.termUnit || 'months',
        startDate: editingProgram?.termStartDate || '',
        endDate: editingProgram?.termEndDate || '',
      })}
      ${select({ label: 'Частичное использование', name: 'partial', value: editingProgram?.partial === false ? 'no' : 'yes', options: [{ value: 'yes', label: 'Разрешено' }, { value: 'no', label: 'Нет' }] })}
      ${textareaField({ label: 'Условия', name: 'description', value: editingProgram?.description || '' })}
      <div class="form-error" data-certificate-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-certificate-save', aria: 'Сохранить вид сертификата' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  initLoyaltyTermFields(layer);
  initCertificateTypeFields(layer);
  initOptionalUeiField(layer);
  const form = layer.querySelector('[data-certificate-form]');
  layer.querySelector('[data-certificate-save]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-certificate-error]');
    const validation = formValidationMessage(form);
    if (validation) { if (error) error.textContent = validation; return; }
    const values = formObject(form);
    const type = values.type || 'amount';
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    const serviceId = values.serviceId || '';
    const bundleIds = collectCheckList(form, '[data-certificate-type-panel="bundle"] .ui-check-list input[type="checkbox"]');
    if (type === 'amount' && amount <= 0) { if (error) error.textContent = 'Укажите сумму'; return; }
    if (type === 'service' && !serviceId) { if (error) error.textContent = 'Выберите позицию Сервиса'; return; }
    if (type === 'bundle' && !bundleIds.length) { if (error) error.textContent = 'Выберите позиции Сервиса'; return; }
    const term = loyaltyTermData(values, 'certificateTerm');
    if (term.type === 'range' && (!term.startDate || !term.endDate)) { if (error) error.textContent = 'Укажите начало и конец периода'; return; }
    if (term.type === 'range' && term.startDate > term.endDate) { if (error) error.textContent = 'Дата начала не может быть позже даты окончания'; return; }
    const serviceIds = type === 'service' ? [serviceId] : type === 'bundle' ? bundleIds : [];
    const serviceNames = serviceIds.map(serviceName).filter(Boolean);
    const next = {
      ...(editingProgram || {}),
      id: editingProgram?.id || uid('certificate-program'),
      uei: normalizeOptionalUei(values.uei),
      name: values.name,
      type,
      amount,
      service: serviceNames.join(' · '),
      serviceIds,
      term: term.label,
      termType: term.type,
      termCount: term.count,
      termUnit: term.unit,
      termStartDate: term.startDate,
      termEndDate: term.endDate,
      partial: values.partial !== 'no',
      description: values.description || '',
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
  const layer = mountModal(root, modal(`${loyaltyHeader('Оформить сертификат')}
    <form class="form-grid" data-certificate-issue-form>
      ${select({ label: 'Покупатель', name: 'buyerKey', value: '', options })}
      ${select({ label: 'Владелец / получатель', name: 'ownerKey', value: '', options })}
      ${program.type === 'amount' ? field({ label: 'Номинал', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: program.amount || '' }) : field({ label: 'Право', name: 'right', value: programRight(program), disabled: true })}
      ${datePicker({ label: 'Дата оформления', name: 'issuedAt', value: today, showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
      ${field({ label: 'Срок', name: 'termPreview', value: program.term || 'Бессрочно', disabled: true })}
      <div class="form-error" data-certificate-issue-error></div>
      ${actionBlock(button('Оформить', { type: 'button', data: 'data-certificate-issue-save', aria: 'Оформить сертификат' }))}
    </form>`, { variant: 'q', surface: 'app', title: 'Оформить сертификат' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-certificate-issue-form]');
  layer.querySelector('[data-certificate-issue-save]')?.addEventListener('click', async () => {
    const error = layer.querySelector('[data-certificate-issue-error]');
    const values = formObject(form);
    const buyer = people.find((item) => String(item?.key || item?.id || '') === String(values.buyerKey || ''));
    const owner = people.find((item) => String(item?.key || item?.id || '') === String(values.ownerKey || ''));
    if (!buyer || !owner) { if (error) error.textContent = 'Укажите покупателя и получателя'; return; }
    const amount = program.type === 'amount' ? Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0) : 0;
    if (program.type === 'amount' && amount <= 0) { if (error) error.textContent = 'Укажите номинал'; return; }
    instances.push({
      id: uid('certificate-instance'),
      programId: program.id,
      buyerKey: String(buyer.key || buyer.id || ''),
      buyerName: personLabel(buyer),
      ownerKey: String(owner.key || owner.id || ''),
      ownerName: personLabel(owner),
      initialValue: amount,
      balance: amount,
      status: 'active',
      issuedAt: new Date(`${values.issuedAt}T12:00:00`).toISOString(),
      expiresAt: expiryFromProgram(program, values.issuedAt),
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
  const layer = mountModal(root, modal('<div data-certificate-instance-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: program.name || 'Сертификат',
    className: 'loyalty-certificate-instance-q',
  }));
  if (!layer) return null;

  const render = () => {
    const effectiveVisible = typeof instance.visibleToPersonOverride === 'boolean'
      ? instance.visibleToPersonOverride
      : program.showToAll !== false;
    const history = certificateHistory(instance);
    const host = layer.querySelector('[data-certificate-instance-q-host]');
    if (!host) return;
    host.innerHTML = page([
      loyaltyHeader(program.name || 'Сертификат', { settings: true, settingsData: 'data-certificate-instance-settings' }),
      instanceInfo(instance),
      v2Section('История', historyMarkup(instance)),
    ]);
    host.querySelector('[data-certificate-instance-settings]')?.addEventListener('click', () => openLoyaltySettingsMenu({
      title: program.name || 'Сертификат',
      checked: effectiveVisible,
      onToggle: async (value) => {
        instance.visibleToPersonOverride = value;
        return value;
      },
    }));
    host.querySelectorAll('[data-certificate-history-entry]').forEach((node) => node.addEventListener('click', () => {
      const item = history[Number(node.dataset.certificateHistoryEntry)];
      if (item) openHistoryEventS(layer, item);
    }));
    notifyLoyaltyContext();
  };
  render();
  return layer;
}

async function openProgramLayer(root, programId, onChanged) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-certificate-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    const program = programs.find((item) => item.id === programId);
    if (!program) { layer.v2Close?.(); await onChanged?.(); return; }
    const issued = instances.filter((item) => item.programId === program.id);
    layer.innerHTML = page([
      loyaltyHeader(program.name || 'Сертификат', {
        settings: true,
        settingsData: 'data-certificate-program-settings',
      }),
      issuedList(issued),
      program.status === 'active' ? actionBlock(button('Оформить', { type: 'button', data: 'data-certificate-issue', aria: 'Оформить сертификат' })) : '',
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'info', data: 'data-certificate-info', aria: 'Условия сертификата' })]);
    layer.querySelector('[data-certificate-info]')?.addEventListener('click', () => openConditions(program));
    layer.querySelector('[data-certificate-program-settings]')?.addEventListener('click', () => openLoyaltyProgramSettings({
      title: program.name || 'Сертификат',
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
    layer.querySelector('[data-certificate-issue]')?.addEventListener('click', () => openIssueQ(root, program, async () => {
      await render();
      await onChanged?.();
    }));
    layer.querySelectorAll('[data-certificate-instance]').forEach((node) => node.addEventListener('click', () => openInstanceLayer(root, text(node.dataset.certificateInstance))));
    notifyLoyaltyContext();
  };
  await render();
  return layer;
}

export function getCertificateAssignmentsForPerson(personKey = '') {
  const key = String(personKey || '');
  return instances
    .filter((instance) => String(instance?.ownerKey || '') === key)
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

export async function renderCertificate(root) {
  const render = async () => {
    const cards = programs.length ? entityCardStack(programs.map((program) => loyaltyVisualCard('certificate', programCardFields(program), {
      data: `data-certificate-program="${program.id}"`,
      aria: `Открыть ${program.name}`,
    }))) : emptyState('Сертификатов пока нет', 'Создайте первый вид сертификата кнопкой «+».');

    root.innerHTML = page([
      loyaltyHeader('Сертификат', {
        settings: true,
        c: { label: '+', data: 'data-certificate-create', aria: 'Создать вид сертификата' },
      }),
      cards,
    ]);
    bindViewSettings(root, 'Сертификат', {
      type: 'certificate',
      fields: () => programCardFields(programs[0] || { name: 'Сертификат', type: 'amount', amount: 10000, term: '12 мес.', status: 'active' }),
      onSaved: render,
    });
    root.querySelector('[data-certificate-create]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    root.querySelectorAll('[data-certificate-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, text(node.dataset.certificateProgram), render)));
    notifyLoyaltyContext();
  };
  await render();
}
