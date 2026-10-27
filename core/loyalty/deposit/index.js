import {
  actionBlock,
  button,
  datePicker,
  details,
  emptyState,
  entityCardStack,
  entityVisualCard,
  escapeHtml,
  field,
  formValidationMessage,
  initDatePickers,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  mountV2ZLayer,
  openDocumentViewer,
  openEntityCardAppearanceQ,
  openNotice,
  openSharedProfileSettingsMenu,
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
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { getWallets } from '../../finance/index.js';
import { getProfile } from '../../profile/data.js';
import { getAllPeople } from '../../people/data.js';
import { personDisplay } from '../../people/presentation.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../card-appearance-templates.js';
import { createUEI, getUEI, listUEIs, normalizeUEI, releaseUEI, replaceUEI } from '../../uei.js';
import {
  correctDepositFunding,
  deleteDeposit,
  deleteDepositFunding,
  fundDeposit,
  fundExistingDeposit,
  getDepositPrograms,
  listAllDeposits,
  loadDepositPrograms,
  saveDepositPrograms,
  updateDepositSettings,
  withdrawDeposit,
} from './data.js';
import {
  depositCardAppearance,
  depositCardFields,
  depositCardPhoto,
  depositCardPhotoPosition,
  depositCardScope,
} from './card-presentation.js';

const PROGRAM_UEI_TYPE = 'loyalty-deposit-program';
const ASSIGNED_DEPOSIT_UEI_TYPE = 'loyalty-deposit';

const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;
const uid = () => globalThis.crypto?.randomUUID?.() || `deposit-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function notifyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function crop(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 50;
}

function depositHeaderContext({ title = 'Депозит', settingsData = '', settingsAria = 'Настройки депозита', c = null } = {}) {
  const profile = getProfile();
  const profileName = [profile?.name, profile?.surname].filter(Boolean).join(' ').trim() || 'Профиль';
  return workspaceHeaderContext({
    title,
    a: {
      kind: 'avatar',
      image: String(profile?.photo || ''),
      imagePosition: `${crop(profile?.photoCropX)}% ${crop(profile?.photoCropY)}%`,
      initials: profileName.slice(0, 1).toUpperCase() || '?',
      settingsTag: Boolean(settingsData),
      data: settingsData,
      aria: settingsAria,
      disabled: !settingsData,
    },
    c,
  });
}

function formObject(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
}

function programStatusLabel(status = '') {
  if (status === 'paused') return 'Приостановлена';
  if (status === 'closed' || status === 'ended') return 'Завершена';
  return 'Активна';
}

function depositStatusLabel(status = '') {
  if (status === 'expired') return 'Срок завершён';
  if (status === 'closed') return 'Закрыт';
  return 'Активен';
}

function contactLabel(person = {}) {
  const display = personDisplay(person);
  return display.name || 'Без имени';
}

function contactOption(person = {}) {
  const display = personDisplay(person);
  return {
    value: String(person?.key || person?.id || ''),
    label: [display.uei, display.name].filter(Boolean).join(' · ') || 'Без имени',
  };
}

function programUei(program = {}) {
  return getUEI(PROGRAM_UEI_TYPE, program.id) || '';
}

function depositPerson(deposit = {}) {
  const key = String(deposit?.person?.key || deposit?.person?.personKey || deposit?.person?.id || '');
  return getAllPeople().find((item) => String(item?.key || item?.id || '') === key) || deposit?.person || {};
}

function depositUei(deposit = {}) {
  const program = getDepositPrograms().find((item) => String(item?.id || '') === String(deposit?.programId || '')) || {};
  const programCode = programUei(program) || '0000';
  const personCode = personDisplay(depositPerson(deposit)).uei || '0000';
  const sequence = String(Math.max(0, Math.trunc(Number(deposit?.cardSequence || 0)))).padStart(4, '0').slice(-4);
  return `${programCode} ${personCode} ${sequence}`;
}

function normalizeRequiredUei(value) {
  const normalized = normalizeUEI(value);
  if (!normalized || normalized === '0000') throw new Error('Сформируйте UEI');
  return normalized;
}

function ensureUeiAvailable(value, current = '') {
  const normalized = normalizeRequiredUei(value);
  if (normalized === current) return normalized;
  if (listUEIs().some((item) => String(item?.uei || '') === normalized)) throw new Error('Этот UEI уже используется');
  return normalized;
}

function bindUeiInput(root, name = 'uei') {
  const input = root?.querySelector?.(`[name="${CSS.escape(name)}"]`);
  input?.addEventListener('input', () => {
    input.value = Array.from(String(input.value || ''))
      .filter((char) => /[A-Za-zА-Яа-яЁё0-9]/.test(char))
      .slice(0, 4)
      .join('')
      .toUpperCase();
  });
}

function ueiField({ name = 'uei', value = '', readonly = false, required = true } = {}) {
  return field({
    label: 'UEI',
    name,
    value,
    maxlength: 4,
    autocomplete: 'off',
    required: required && !readonly,
    readonly,
    data: 'data-deposit-uei-field',
  });
}

function programFields(program = {}) {
  const amount = Number(program?.amount || 0);
  return depositCardFields({
    uei: programUei(program),
    title: program?.name || 'Депозит',
    subtitle: program?.termRule || 'Бессрочно',
    status: programStatusLabel(program?.status),
    metaLeft: program?.benefit || 'Без дополнительной выгоды',
    metaRight: amount > 0 ? money(amount) : 'Свободная сумма',
  });
}

function card(fields, { data = '', aria = '', interactive = true } = {}) {
  return entityVisualCard({
    appearance: depositCardAppearance(),
    fields,
    image: depositCardPhoto(),
    imagePosition: depositCardPhotoPosition(),
    interactive,
    data,
    aria,
  });
}

function programConditions(program = {}, issuedCount = null) {
  const lines = [
    `UEI: ${programUei(program) || '—'}`,
    `Состояние: ${programStatusLabel(program?.status)}`,
    `Сумма: ${Number(program?.amount || 0) > 0 ? money(program.amount) : 'Свободная'}`,
    `Срок: ${program?.termRule || 'Бессрочно'}`,
    `Выгода: ${program?.benefit || 'Без дополнительной выгоды'}`,
    `Показывать всем: ${program?.showToAll === false ? 'Нет' : 'Да'}`,
  ];
  if (issuedCount != null) lines.push(`Оформлено: ${Math.max(0, Number(issuedCount) || 0)}`);
  lines.push(`Создано: ${shortDateTime(program?.createdAt, '—')}`, '', program?.description || 'Дополнительные условия не указаны.');
  return lines.join('\n');
}

function depositInfo(deposit = {}) {
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  const benefitBalance = Math.max(0, Number(deposit?.benefitBalance || 0));
  const refundableAmount = Math.max(0, Number(deposit?.refundableAmount ?? deposit?.principalBalance ?? 0));
  const rows = [
    { label: 'UEI', value: depositUei(deposit) },
    { label: 'Контакт', value: contactLabel(depositPerson(deposit)) },
    { label: 'Дата оформления', value: shortDateTime(deposit?.fundedAt, '—') },
    { label: 'Внесено', value: money(deposit?.fundedAmount) },
    { label: 'Остаток', value: money(deposit?.balance) },
    { label: 'Срок', value: terms?.termRule || 'Бессрочно' },
    { label: 'Условие выгоды', value: terms?.benefit || 'Без дополнительной выгоды' },
  ];
  if (String(deposit?.benefitMode || 'none') === 'accrual' || benefitBalance > 0.009) {
    rows.push({ label: 'Выгода в остатке', value: money(benefitBalance) });
  }
  if (deposit?.canRefund || refundableAmount > 0.009) {
    rows.push({ label: 'К возврату', value: money(refundableAmount) });
  }
  rows.push({ label: 'Состояние', value: depositStatusLabel(deposit?.status) });
  return details(rows);
}

function historyMarkup(deposit = {}) {
  const items = Array.isArray(deposit?.history) ? deposit.history : [];
  if (!items.length) return emptyState('Истории пока нет', 'Движения депозита появятся здесь.');
  const kindLabel = (kind) => {
    if (kind === 'deposit-funding') return 'Внесение';
    if (kind === 'deposit-benefit') return 'Выгода';
    if (kind === 'deposit-benefit-reversal') return 'Отмена выгоды';
    if (kind === 'deposit-withdrawal') return 'Возврат остатка';
    if (kind === 'refund') return 'Возврат оплаты';
    if (kind === 'payment') return 'Использование при оплате';
    return 'Операция';
  };
  return miniCardRail([...items].reverse().map((item) => miniCard({
    title: kindLabel(item?.kind),
    value: `${String(item?.direction || '').toUpperCase() === 'IN' ? '+' : '−'}${money(item?.amount)}`,
    subtitle: shortDateTime(item?.occurredAt, '—'),
    interactive: item?.kind === 'deposit-funding',
    data: item?.kind === 'deposit-funding' ? `data-deposit-funding="${escapeHtml(item.operationId || '')}"` : '',
    aria: item?.kind === 'deposit-funding' ? 'Настройки внесения' : '',
    actionLabel: item?.kind === 'deposit-funding' ? 'Настройки' : '',
  })));
}

function issuedList(items = []) {
  if (!items.length) return emptyState('Депозитов пока нет', 'Оформленные депозиты этой программы появятся здесь.');
  return v2ListEntries(items.map((deposit) => v2ListEntry({
    title: contactLabel(depositPerson(deposit)),
    subtitle: depositUei(deposit),
    rightTop: money(deposit?.balance),
    rightBottom: depositStatusLabel(deposit?.status),
    interactive: true,
    initial: '',
    data: `data-deposit-instance="${escapeHtml(deposit.depositId)}"`,
    aria: `Открыть депозит ${contactLabel(depositPerson(deposit))}`,
  })));
}

async function setProgramStatus(programId, status) {
  const now = new Date().toISOString();
  const next = getDepositPrograms().map((item) => String(item?.id) === String(programId)
    ? { ...item, status, updatedAt: now }
    : item);
  await saveDepositPrograms(next);
}

async function setProgramVisibility(programId, showToAll) {
  const now = new Date().toISOString();
  const next = getDepositPrograms().map((item) => String(item?.id) === String(programId)
    ? { ...item, showToAll: Boolean(showToAll), updatedAt: now }
    : item);
  await saveDepositPrograms(next);
}

async function deleteProgram(programId) {
  const id = String(programId || '');
  await saveDepositPrograms(getDepositPrograms().filter((item) => String(item?.id) !== id));
  releaseUEI({ entityType: PROGRAM_UEI_TYPE, entityId: id });
}

function openProgramCodeX(program, onSaved = () => {}) {
  const current = programUei(program);
  const layer = mountModal(document.body, modal(`<form class="form-grid" data-deposit-code-form>
    ${ueiField({ value: current, required: true })}
    ${button('Сохранить', { type: 'submit' })}
    <div class="form-error" data-deposit-code-error></div>
  </form>`, { title: 'UEI программы', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  bindUeiInput(layer);
  const form = layer.querySelector('[data-deposit-code-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-deposit-code-error]');
    try {
      const value = ensureUeiAvailable(new FormData(form).get('uei'), current);
      replaceUEI({ entityType: PROGRAM_UEI_TYPE, entityId: program.id, value });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить UEI';
    }
  });
  return layer;
}

function openAppearanceQ(root, onSaved = () => {}) {
  const programs = getDepositPrograms();
  const sample = programs[0] || {
    id: '', name: 'Депозит', amount: 30000, termRule: '12 месяцев', benefit: 'Условия программы', status: 'active',
  };
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Карта',
    typeOptions: [{ value: depositCardScope(), label: 'Депозит' }],
    initialType: depositCardScope(),
    targetOptions: () => [],
    allowPhoto: true,
    resolve: () => ({
      appearance: depositCardAppearance(),
      fields: programFields(sample),
      photo: depositCardPhoto(),
      photoPosition: depositCardPhotoPosition(),
    }),
    save: async ({ appearance, photo }) => {
      const current = getCardAppearanceTemplate(depositCardScope());
      saveCardAppearanceTemplate(depositCardScope(), {
        appearance,
        photo,
        photoPosition: current?.photoPosition || depositCardPhotoPosition(),
      });
    },
    onSaved,
  });
}

function openProgramConditions(program, issuedCount) {
  return openDocumentViewer({
    title: program?.name || 'Условия депозита',
    content: programConditions(program, issuedCount),
  });
}

function initDepositProgramConstructor(layer) {
  const form = layer?.querySelector?.('[data-deposit-program-form]');
  if (!form) return;
  initDatePickers(form);
  const amountMode = form.querySelector('[name="amountMode"]');
  const termMode = form.querySelector('[name="termMode"]');
  const benefitType = form.querySelector('[name="benefitType"]');
  const sync = () => {
    const amountPanel = form.querySelector('[data-deposit-amount-fixed]');
    const termPanel = form.querySelector('[data-deposit-term-dates]');
    const benefitPanel = form.querySelector('[data-deposit-benefit-value]');
    if (amountPanel) amountPanel.hidden = amountMode?.value !== 'fixed';
    if (termPanel) termPanel.hidden = termMode?.value !== 'dated';
    if (benefitPanel) benefitPanel.hidden = benefitType?.value === 'none';
  };
  amountMode?.addEventListener('change', sync);
  termMode?.addEventListener('change', sync);
  benefitType?.addEventListener('change', sync);
  sync();
}

function depositBenefit(values = {}) {
  const type = String(values.benefitType || 'none');
  const value = Math.max(0, Number(String(values.benefitValue || '0').replace(',', '.')) || 0);
  if (type === 'discount') return value > 0 ? `На обслуживание ${value}%` : '';
  if (type === 'accrual') return value > 0 ? `Сразу +${value}%` : '';
  return '';
}

async function openCreateProgramQ(root, onSaved = () => {}, sourceProgram = null) {
  const copying = Boolean(sourceProgram?.id);
  const title = copying ? 'Создать копию' : 'Новая депозитная программа';
  const layer = mountModal(root, modal(`${depositHeaderContext({ title })}
    <form class="form-grid" data-deposit-program-form>
      ${field({ label: 'Название', name: 'name', value: sourceProgram?.name || '', required: true })}
      ${ueiField({ name: 'programUei', value: '', required: true })}
      ${select({ label: 'Сумма', name: 'amountMode', value: sourceProgram?.amountMode || (Number(sourceProgram?.amount || 0) > 0 ? 'fixed' : 'free'), options: [
        { value: 'fixed', label: 'Фиксированная сумма' },
        { value: 'free', label: 'Свободная сумма' },
      ] })}
      <div data-deposit-amount-fixed>${field({ label: 'Сумма программы', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: sourceProgram?.amount || '' })}</div>
      ${select({ label: 'Срок', name: 'termMode', value: sourceProgram?.termMode || 'indefinite', options: [
        { value: 'indefinite', label: 'Бессрочно' },
        { value: 'dated', label: 'Период' },
      ] })}
      <div data-deposit-term-dates hidden>${twoColumnLayout(
        datePicker({ label: 'С', name: 'termStartDate', value: sourceProgram?.termStartDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        datePicker({ label: 'До', name: 'termEndDate', value: sourceProgram?.termEndDate || '', showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false }),
        { ariaLabel: 'Период депозитной программы' },
      )}</div>
      ${select({ label: 'Выгода', name: 'benefitType', value: sourceProgram?.benefitType || 'none', options: [
        { value: 'none', label: 'Без дополнительной выгоды' },
        { value: 'discount', label: 'Выгода на обслуживание' },
        { value: 'accrual', label: 'Выгода сразу' },
      ] })}
      <div data-deposit-benefit-value hidden>${field({ label: 'Размер, %', name: 'benefitValue', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: sourceProgram?.benefitValue || '' })}</div>
      ${textareaField({ label: 'Условия', name: 'description', value: sourceProgram?.description || '' })}
      <div class="form-error" data-deposit-program-error></div>
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-deposit-program-save', aria: 'Сохранить депозитную программу' }))}
    </form>`, { variant: 'q', surface: 'app', title }));
  if (!layer) return null;
  bindUeiInput(layer, 'programUei');
  initDepositProgramConstructor(layer);
  const form = layer.querySelector('[data-deposit-program-form]');
  layer.querySelector('[data-deposit-program-save]')?.addEventListener('click', async () => {
    const errorNode = layer.querySelector('[data-deposit-program-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const amountMode = values.amountMode || 'fixed';
    const amount = amountMode === 'free' ? 0 : Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (amountMode === 'fixed' && amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите сумму программы';
      return;
    }
    const termMode = values.termMode || 'indefinite';
    const termStartDate = values.termStartDate || '';
    const termEndDate = values.termEndDate || '';
    if (termMode === 'dated' && (!termStartDate || !termEndDate)) {
      if (errorNode) errorNode.textContent = 'Укажите начало и конец периода';
      return;
    }
    if (termMode === 'dated' && termStartDate > termEndDate) {
      if (errorNode) errorNode.textContent = 'Дата начала не может быть позже даты окончания';
      return;
    }
    if (copying) {
      const sameName = String(values.name || '').trim() === String(sourceProgram?.name || '').trim();
      const samePeriod = termMode === String(sourceProgram?.termMode || 'indefinite')
        && termStartDate === String(sourceProgram?.termStartDate || '')
        && termEndDate === String(sourceProgram?.termEndDate || '');
      if (sameName && samePeriod) {
        if (errorNode) errorNode.textContent = 'Измените название или период новой программы';
        return;
      }
    }
    const benefit = depositBenefit(values);
    if (values.benefitType !== 'none' && !benefit) {
      if (errorNode) errorNode.textContent = 'Укажите размер выгоды';
      return;
    }
    const id = uid();
    try {
      const code = ensureUeiAvailable(values.programUei);
      const now = new Date().toISOString();
      const program = {
        ...(sourceProgram || {}),
        id,
        name: values.name,
        amount,
        amountMode,
        termMode,
        termStartDate,
        termEndDate,
        termRule: termMode === 'dated' ? `${termStartDate} — ${termEndDate}` : 'Бессрочно',
        benefitType: values.benefitType || 'none',
        benefitValue: Math.max(0, Number(String(values.benefitValue || '0').replace(',', '.')) || 0),
        benefit,
        description: values.description || '',
        showToAll: sourceProgram?.showToAll !== false,
        status: 'active',
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await saveDepositPrograms([...getDepositPrograms(), program]);
      createUEI({ entityType: PROGRAM_UEI_TYPE, entityId: id, value: code });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить программу';
    }
  });
  notifyContext();
  return layer;
}

async function openFundQ(root, program, { person = null, onSaved = () => {} } = {}) {
  const wallets = getWallets();
  const people = getAllPeople();
  const fixedPersonKey = String(person?.key || person?.id || '');
  const selectedPerson = fixedPersonKey ? person : null;
  const contactField = selectedPerson
    ? field({ label: 'Контакт', name: 'personName', value: contactLabel(selectedPerson), disabled: true })
    : select({
        label: 'Контакт',
        name: 'personKey',
        value: '',
        options: [{ value: '', label: 'Выберите контакт' }, ...people.map(contactOption).filter((item) => item.value)],
      });
  const layer = mountModal(root, modal(`${depositHeaderContext({ title: 'Оформить депозит' })}
    <form class="form-grid" data-deposit-fund-form>
      ${contactField}
      ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: Number(program?.amount || 0) > 0 ? program.amount : '' })}
      ${field({ label: 'Срок', name: 'termPreview', value: program?.termRule || 'Бессрочно', disabled: true })}
      ${select({ label: 'Кошелёк приёма денег', name: 'walletId', value: '', options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
      ${datePicker({ label: 'Дата внесения', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
      <div class="form-error" data-deposit-fund-error></div>
      ${actionBlock(button('Оформить', { type: 'button', data: 'data-deposit-fund-save', aria: 'Оформить депозит' }))}
    </form>`, { variant: 'q', surface: 'app', title: 'Оформить депозит' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-fund-form]');
  layer.querySelector('[data-deposit-fund-save]')?.addEventListener('click', async () => {
    const errorNode = layer.querySelector('[data-deposit-fund-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const owner = selectedPerson || people.find((item) => String(item?.key || item?.id || '') === String(values.personKey || ''));
    const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!owner || !wallet || amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите контакт, сумму и кошелёк';
      return;
    }
    try {
      const display = personDisplay(owner);
      const deposit = await fundDeposit({
        programId: program.id,
        person: { key: owner.key || owner.id || '', uei: display.uei || '', name: display.name || '' },
        amount,
        walletId: wallet.id,
        walletName: wallet.name,
        occurredAt: new Date(`${values.occurredAt}T12:00:00`),
      });
      if (!deposit?.depositId) throw new Error('Депозит не создан');
      layer.v2Close?.();
      const available = Number(deposit?.balance || 0);
      const benefit = Number(deposit?.benefitBalance || 0);
      const message = benefit > 0.009
        ? `Принято ${money(amount)}. Выгода ${money(benefit)}. Доступно ${money(available)}. UEI: ${depositUei(deposit)}`
        : `Принято ${money(amount)}. Доступно ${money(available || amount)}. UEI: ${depositUei(deposit)}`;
      openNotice({ title: 'Депозит оформлен', message });
      await onSaved?.(deposit);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось оформить депозит';
    }
  });
  notifyContext();
  return layer;
}

async function openFundingQ(root, deposit, { entry = null, onSaved = () => {} } = {}) {
  const wallets = getWallets();
  const editing = Boolean(entry?.operationId);
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  const target = Number(terms?.amount || 0);
  const remaining = target > 0 ? Math.max(0, target - Number(deposit?.fundedAmount || 0)) : 0;
  const selectedWallet = String(entry?.walletId || '');
  const layer = mountModal(root, modal(`<form class="form-grid" data-deposit-existing-fund-form>
    ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: editing ? entry.amount : (remaining || '') })}
    ${select({ label: 'Кошелёк приёма денег', name: 'walletId', value: selectedWallet, options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
    ${datePicker({ label: 'Дата внесения', name: 'occurredAt', value: editing ? String(entry.occurredAt || '').slice(0, 10) : new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    <div class="form-error" data-deposit-existing-fund-error></div>
    ${actionBlock(button(editing ? 'Сохранить' : 'Добавить платёж', { type: 'submit' }))}
  </form>`, { variant: 'q', surface: 'app', title: editing ? 'Корректировать платёж' : 'Добавить платёж' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-existing-fund-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formObject(form);
    const errorNode = layer.querySelector('[data-deposit-existing-fund-error]');
    const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!wallet || amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите сумму и кошелёк';
      return;
    }
    try {
      if (editing) {
        await correctDepositFunding({
          depositId: deposit.depositId,
          operationId: entry.operationId,
          amount,
          walletId: wallet.id,
          walletName: wallet.name,
          occurredAt: new Date(`${values.occurredAt}T12:00:00`),
        });
      } else {
        await fundExistingDeposit({
          depositId: deposit.depositId,
          amount,
          walletId: wallet.id,
          walletName: wallet.name,
          occurredAt: new Date(`${values.occurredAt}T12:00:00`),
        });
      }
      layer.v2Close?.();
      openNotice({ title: editing ? 'Платёж исправлен' : 'Платёж добавлен', message: `${money(amount)} · ${values.occurredAt}` });
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить платёж';
    }
  });
  return layer;
}

async function openWithdrawX(root, deposit, onSaved = () => {}) {
  const wallets = getWallets();
  const refundable = Math.max(0, Number(deposit?.refundableAmount ?? deposit?.principalBalance ?? 0));
  if (!deposit?.canRefund || refundable <= 0.009) {
    openNotice({ title: 'Возврат недоступен', message: 'У этого депозита нет возвратного остатка.' });
    return null;
  }
  const layer = mountModal(root, modal(`<form class="form-grid" data-deposit-withdraw-form>
    ${field({ label: 'К возврату', name: 'amount', type: 'number', min: '0.01', max: refundable, step: '0.01', inputmode: 'decimal', value: refundable, readonly: true })}
    ${select({ label: 'Кошелёк возврата', name: 'walletId', value: '', options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))] })}
    ${datePicker({ label: 'Дата возврата', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${textareaField({ label: 'Комментарий', name: 'reason' })}
    ${button('Вернуть', { type: 'submit', variant: 'danger' })}
    <div class="form-error" data-deposit-withdraw-error></div>
  </form>`, { variant: 'x', surface: 'app', title: 'Возврат депозита' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-deposit-withdraw-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = formObject(form);
    const errorNode = layer.querySelector('[data-deposit-withdraw-error]');
    const wallet = wallets.find((item) => String(item?.id) === String(values.walletId));
    if (!wallet) {
      if (errorNode) errorNode.textContent = 'Выберите кошелёк';
      return;
    }
    try {
      await withdrawDeposit({
        depositId: deposit.depositId,
        amount: refundable,
        walletId: wallet.id,
        walletName: wallet.name,
        reason: values.reason || '',
        occurredAt: new Date(`${values.occurredAt}T12:00:00`),
      });
      layer.v2Close?.();
      await onSaved?.();
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось вернуть депозит';
    }
  });
  return layer;
}

function openRootSettings(root, rerender) {
  return openSharedProfileSettingsMenu({
    title: 'Депозит',
    actions: [
      { id: 'appearance', label: 'Вид', onSelect: () => openAppearanceQ(root, rerender) },
    ],
  });
}

function openProgramSettings(root, program, rerender) {
  return openSharedProfileSettingsMenu({
    title: program.name || 'Депозит',
    actions: [
      { id: 'code', label: `UEI · ${programUei(program) || 'не задан'}`, onSelect: () => openProgramCodeX(program, rerender) },
      {
        id: 'visibility',
        label: program?.showToAll === false ? 'Показывать всем · Нет' : 'Показывать всем · Да',
        onSelect: async () => {
          await setProgramVisibility(program.id, program?.showToAll === false);
          await rerender();
        },
      },
      { id: 'copy', label: 'Создать копию', onSelect: () => openCreateProgramQ(root, rerender, program) },
      ...(program.status === 'closed' || program.status === 'ended' ? [] : [
        {
          id: 'toggle',
          label: program.status === 'paused' ? 'Возобновить' : 'Приостановить',
          onSelect: async () => {
            await setProgramStatus(program.id, program.status === 'paused' ? 'active' : 'paused');
            await rerender();
          },
        },
        {
          id: 'finish', label: 'Завершить', onSelect: async () => {
            await setProgramStatus(program.id, 'closed');
            await rerender();
          },
        },
      ]),
      {
        id: 'delete', label: 'Удалить', variant: 'danger', onSelect: async () => {
          await deleteProgram(program.id);
          await rerender();
        },
      },
    ],
  });
}

async function openDepositLayer(root, depositId, onChanged = () => {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-deposit-instance-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    const deposits = await listAllDeposits();
    const deposit = deposits.find((item) => String(item?.depositId) === String(depositId));
    if (!deposit) {
      layer.v2Close?.();
      return;
    }
    if (getUEI(ASSIGNED_DEPOSIT_UEI_TYPE, deposit.depositId)) {
      releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
    }
    const program = getDepositPrograms().find((item) => String(item?.id) === String(deposit.programId)) || {};
    const inheritedVisible = program?.showToAll !== false;
    const effectiveVisible = typeof deposit.visibleToPersonOverride === 'boolean'
      ? deposit.visibleToPersonOverride
      : inheritedVisible;
    layer.innerHTML = page([
      depositHeaderContext({ title: deposit.programName || 'Депозит' }),
      depositInfo(deposit),
      v2Section('История', historyMarkup(deposit)),
      deposit?.canRefund ? actionBlock(button('Возврат', { type: 'button', data: 'data-deposit-withdraw', aria: 'Вернуть остаток депозита' })) : '',
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'settings', data: 'data-deposit-instance-settings', aria: 'Настройки депозита' })]);
    layer.querySelector('[data-deposit-instance-settings]')?.addEventListener('click', () => {
      openSharedProfileSettingsMenu({
        title: deposit.programName || 'Депозит',
        actions: [
          {
            id: 'fund', label: 'Добавить платёж', onSelect: () => openFundingQ(root, deposit, { onSaved: async () => {
              await render(); await onChanged?.();
            } }),
          },
          {
            id: 'visibility',
            label: effectiveVisible ? 'Показывать этому человеку · Да' : 'Показывать этому человеку · Нет',
            onSelect: async () => {
              await updateDepositSettings(deposit.depositId, { visibleToPerson: !effectiveVisible });
              await render();
              await onChanged?.();
            },
          },
          {
            id: 'delete',
            label: 'Удалить карту',
            variant: 'danger',
            onSelect: async () => {
              await deleteDeposit(deposit.depositId);
              releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
              layer.v2Close?.();
              await onChanged?.();
            },
          },
        ],
      });
    });
    layer.querySelectorAll('[data-deposit-funding]').forEach((node) => {
      node.addEventListener('click', () => {
        const operationId = String(node.dataset.depositFunding || '');
        const entry = (deposit.history || []).find((item) => item?.kind === 'deposit-funding' && String(item?.operationId || '') === operationId);
        if (!entry) return;
        openSharedProfileSettingsMenu({
          title: 'Внесение',
          actions: [
            {
              id: 'correct', label: 'Корректировать', onSelect: () => openFundingQ(root, deposit, { entry, onSaved: async () => {
                await render(); await onChanged?.();
              } }),
            },
            {
              id: 'delete', label: 'Удалить платёж', variant: 'danger', onSelect: async () => {
                try {
                  await deleteDepositFunding({ depositId: deposit.depositId, operationId });
                  await render();
                  await onChanged?.();
                } catch (error) {
                  openNotice({ title: 'Платёж не удалён', message: error instanceof Error ? error.message : 'Не удалось удалить платёж' });
                }
              },
            },
          ],
        });
      });
    });
    layer.querySelector('[data-deposit-withdraw]')?.addEventListener('click', () => openWithdrawX(root, deposit, async () => {
      await render();
      await onChanged?.();
    }));
    notifyContext();
  };
  await render();
  return layer;
}

async function openProgramLayer(root, programId, { person = null, onChanged = () => {} } = {}) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-deposit-program-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    await loadDepositPrograms();
    const program = getDepositPrograms().find((item) => String(item?.id) === String(programId));
    if (!program) {
      layer.v2Close?.();
      await onChanged?.();
      return;
    }
    const allDeposits = await listAllDeposits();
    const issued = allDeposits.filter((item) => String(item?.programId) === String(program.id));
    for (const deposit of issued) {
      if (getUEI(ASSIGNED_DEPOSIT_UEI_TYPE, deposit.depositId)) releaseUEI({ entityType: ASSIGNED_DEPOSIT_UEI_TYPE, entityId: deposit.depositId });
    }
    layer.innerHTML = page([
      depositHeaderContext({
        title: program.name || 'Депозит',
        settingsData: 'data-deposit-program-settings',
        settingsAria: 'Настройки депозитной программы',
      }),
      v2Section('Оформленные депозиты', issuedList(issued)),
      program.status === 'active' ? actionBlock(button('Оформить', { type: 'button', data: 'data-deposit-program-fund', aria: 'Оформить депозит' })) : '',
    ]);
    setV2ZHeaderRows(layer, [smallActionButton({ icon: 'info', data: 'data-deposit-info', aria: 'Условия депозитной программы' })]);
    layer.querySelector('[data-deposit-info]')?.addEventListener('click', () => openProgramConditions(program, issued.length));
    layer.querySelector('[data-deposit-program-settings]')?.addEventListener('click', () => openProgramSettings(root, program, async () => {
      await render();
      await onChanged?.();
    }));
    layer.querySelector('[data-deposit-program-fund]')?.addEventListener('click', () => openFundQ(root, program, {
      person,
      onSaved: async () => {
        await render();
        await onChanged?.();
      },
    }));
    layer.querySelectorAll('[data-deposit-instance]').forEach((node) => {
      node.addEventListener('click', () => openDepositLayer(root, node.dataset.depositInstance, async () => {
        await render();
        await onChanged?.();
      }));
    });
    notifyContext();
  };
  await render();
  return layer;
}

export async function openDepositForPerson(root, person = null) {
  await loadDepositPrograms();
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'loyalty-deposit-z' }), { stack: true });
  if (!layer) return null;
  const render = async () => {
    await loadDepositPrograms();
    const programs = getDepositPrograms().filter((item) => !item?.archivedAt);
    const cards = programs.length
      ? entityCardStack(programs.map((program) => card(programFields(program), {
          data: `data-deposit-program="${escapeHtml(program.id)}"`,
          aria: `Открыть депозитную программу ${program.name || ''}`,
        })))
      : emptyState('Депозитных программ пока нет', 'Создайте первую программу кнопкой «+».');
    layer.innerHTML = page([
      depositHeaderContext({
        title: 'Депозит',
        settingsData: 'data-deposit-settings',
        settingsAria: 'Настройки депозита',
        c: { label: '+', data: 'data-deposit-program-add', aria: 'Создать депозитную программу' },
      }),
      cards,
    ]);
    layer.querySelector('[data-deposit-settings]')?.addEventListener('click', () => openRootSettings(root, render));
    layer.querySelector('[data-deposit-program-add]')?.addEventListener('click', () => openCreateProgramQ(root, render));
    layer.querySelectorAll('[data-deposit-program]').forEach((node) => {
      node.addEventListener('click', () => openProgramLayer(root, node.dataset.depositProgram, { person, onChanged: render }));
    });
    notifyContext();
  };
  await render();
  return layer;
}

export async function renderDeposit(root) {
  await loadDepositPrograms();
  const programs = getDepositPrograms().filter((item) => !item?.archivedAt);
  root.innerHTML = page([
    depositHeaderContext({
      title: 'Депозит',
      settingsData: 'data-deposit-settings',
      settingsAria: 'Настройки депозита',
      c: { label: '+', data: 'data-deposit-program-add', aria: 'Создать депозитную программу' },
    }),
    programs.length ? entityCardStack(programs.map((program) => card(programFields(program), {
      data: `data-deposit-program="${escapeHtml(program.id)}"`,
      aria: `Открыть депозитную программу ${program.name || ''}`,
    }))) : emptyState('Депозитных программ пока нет', 'Создайте первую программу кнопкой «+».')
  ]);
  const rerender = () => renderDeposit(root);
  root.querySelector('[data-deposit-settings]')?.addEventListener('click', () => openRootSettings(root, rerender));
  root.querySelector('[data-deposit-program-add]')?.addEventListener('click', () => openCreateProgramQ(root, rerender));
  root.querySelectorAll('[data-deposit-program]').forEach((node) => node.addEventListener('click', () => openProgramLayer(root, node.dataset.depositProgram, { onChanged: rerender })));
  notifyContext();
}

export { renderDeposit as render };
