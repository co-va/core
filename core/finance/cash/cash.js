import {
  button,
  actionBlock,
  datePicker,
  emptyState,
  entityCardRail,
  entityVisualCard,
  escapeHtml,
  field,
  formValidationMessage,
  initDatePickers,
  initPhotoField,
  modal,
  mountModal,
  openEntityCardAppearanceQ,
  mountV2ZLayer,
  openNotice,
  openSharedProfileSettingsMenu,
  page,
  photoField,
  select,
  shortDate,
  shortDateTime,
  shortDateTimeParts,
  v2ListEntries,
  v2ListEntry,
  v2Section,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { readOnlyReceipt } from '../../../ui/receipt/index.js';
import { canUseBookCapability } from '../../access.js';
import { findPersonByAccountId, getPeople } from '../../people/data.js';
import {
  canPermanentlyDeleteFinanceData,
  cancelFinanceOperation,
  hardDeleteFinanceWallet,
} from '../service.js';
import {
  financeOperationGroups,
  openFinanceEntityOperation as openEntityFinanceOperation,
  openFinanceOperations,
} from '../operations/index.js';
import { getFinanceEntityBalance, getFinanceEntityMovements } from '../read.js';
import {
  deleteWallet as deleteWalletData,
  deleteWalletPermanently,
  getWalletBalance,
  getWalletHistory,
  getWallets,
  saveWallet as saveWalletData,
  updateWallet,
} from './data.js';
import { cashEntityCardAppearance, cashEntityCardFields, cashEntityCardPhoto, walletCardAppearance, walletCardFields, walletCardPhoto } from './card-presentation.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../../card-appearance-templates.js';
import {
  getInvestmentEntities,
  getLoanEntities,
  saveInvestmentEntity,
  saveLoanEntity,
} from './entities.js';
import {
  buildLoanSchedule,
  calculateLoanState,
  normalizeLoanTerms,
} from './loan-calculator.js';
import {
  calculateInvestmentState,
  investmentRoleLabel,
  normalizeInvestmentTerms,
} from './investment-calculator.js';

const formatMoney = (value) => `${(Number(value) || 0).toLocaleString('ru-RU')} ₽`;
const formatPercent = (value) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : `${Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%`;

let cashRuntimeOptions = {};

function operationMoment(item) {
  const raw = item?.occurredAt || item?.refundedAt || item?.paidAt || item?.createdAt || '';
  const fallback = `${item?.date || ''} ${item?.time || ''}`.trim();
  return shortDateTime(raw, fallback);
}

function operationName(item) {
  const direction = String(item?.direction || '');
  const economicType = String(item?.economicType || '');
  let title = direction === 'OUT' ? 'Расход' : 'Доход';
  if (economicType === 'SERVICE_REVENUE') title = 'Оплата услуги';
  else if (economicType === 'SERVICE_REFUND') title = 'Возврат услуги';
  else if (economicType === 'TIPS_REFUND') title = 'Возврат чаевых';
  else if (economicType === 'TIPS') title = 'Чаевые';
  else if (economicType === 'LOAN_RECEIVED') title = 'Получен займ';
  else if (economicType === 'LOAN_REPAYMENT') title = 'Возврат займа';
  else if (economicType === 'INVESTMENT_RECEIVED') title = 'Получена инвестиция';
  else if (economicType === 'INVESTMENT_RETURN') title = 'Возврат капитала';
  else if (economicType === 'INVESTMENT_CONTRIBUTION') title = 'Вложение';
  else if (economicType === 'INVESTMENT_CAPITAL_RETURN') title = 'Возврат капитала';
  else if (economicType === 'INVESTMENT_INCOME') title = 'Доход';
  else if (economicType === 'INVESTMENT_EXPENSE') title = 'Расход';
  else if (economicType === 'INVESTMENT_INCOME_PAYMENT') title = 'Выплата дохода';
  else if (economicType === 'TRANSFER') title = direction === 'OUT' ? 'Перевод · списание' : 'Перевод · зачисление';
  else if (item?.articleName) title = item.articleName;
  return title;
}

function personName(item) {
  return [item?.person?.name, item?.person?.surname].filter(Boolean).join(' ').trim();
}

function walletOperations(walletId) {
  const grouped = new Map();
  for (const entry of getWalletHistory(walletId)) {
    const operationId = String(entry?.operationId || '');
    if (!operationId) continue;
    if (entry?.operationKind === 'cancel' || entry?.operationStatus === 'cancelled' || entry?.economicType === 'REVERSAL') continue;
    const current = grouped.get(operationId) || { ...entry, operationId, total: 0, entries: [] };
    current.entries.push(entry);
    current.total += Number(entry?.total) || 0;
    if (!current.counterparty && entry?.counterparty) current.counterparty = entry.counterparty;
    if (!current.workplace && entry?.workplace) current.workplace = entry.workplace;
    if (!current.person && entry?.person) current.person = entry.person;
    grouped.set(operationId, current);
  }
  return [...grouped.values()]
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')));
}

function renderOperationRow(operation) {
  const name = personName(operation);
  const counterparty = String(operation?.counterparty || '').trim();
  const workplace = String(operation?.workplace || '').trim();
  const label = operationName(operation);
  const source = [name || counterparty, workplace].filter(Boolean).join(' · ');
  return v2ListEntry({
    overline: String(operation?.person?.uei || ''),
    title: label,
    subtitle: source,
    rightTop: formatMoney(operation.total),
    rightBottom: operationMoment(operation),
    initial: '',
    interactive: true,
    data: `data-wallet-operation="${escapeHtml(operation.operationId)}"`,
    aria: `Открыть операцию ${label}`,
  });
}

function cashContext() {
  const investmentOnly = allowedInvestmentRoles().length > 0
    && !canUseBookCapability('finance.cash.access')
    && !canUseBookCapability('finance.special.access');
  const hasSettings = cashAppearanceTypeOptions().length > 0
    || financeOperationGroups({ groups: ['income-expense', 'transfer'] }).length > 0;
  return workspaceHeaderContext({
    title: investmentOnly ? 'Инвестиции' : 'Касса',
    v: hasSettings ? {
      kind: 'settings',
      data: 'data-cash-settings',
      aria: 'Настройки кассы',
    } : null,
    c: canCreateCashEntity() ? {
      label: '+',
      data: 'data-cash-create',
      aria: investmentOnly ? 'Добавить инвестицию' : 'Создать сущность кассы',
    } : null,
  });
}

function walletContext(wallet, title = wallet?.name || 'Касса') {
  return workspaceHeaderContext({
    title,
    v: wallet && !wallet.system ? {
      kind: 'settings',
      data: 'data-wallet-settings',
      aria: `Настройки ${wallet?.name || 'кассы'}`,
    } : null,
  });
}

function operationContext(operation) {
  return workspaceHeaderContext({
    title: operationName(operation),
    v: {
      kind: 'settings',
      data: 'data-wallet-operation-settings',
      aria: 'Настройки операции',
    },
  });
}

function renderWalletCard(wallet) {
  const balance = getWalletBalance(wallet.id);
  return entityVisualCard({
    appearance: walletCardAppearance(wallet),
    fields: walletCardFields(wallet, balance),
    image: walletCardPhoto(wallet),
    interactive: true,
    data: `data-wallet="${escapeHtml(wallet.id)}"`,
    aria: `Открыть кошелёк ${wallet.name}`,
  });
}

function renderCashEntityCard(entity, kind) {
  const label = kind === 'investment' ? 'инвестицию' : 'займ';
  const movements = getFinanceEntityMovements(kind, entity.id);
  const loanState = kind === 'loan' ? calculateLoanState(entity, movements) : null;
  const investmentState = kind === 'investment' ? calculateInvestmentState(entity, movements) : null;
  const investmentTerms = kind === 'investment' ? normalizeInvestmentTerms(entity) : null;
  const balance = kind === 'loan'
    ? loanState.totalDue
    : kind === 'investment'
      ? (investmentState.role === 'raise' ? investmentState.remainingObligation : investmentState.result)
      : getFinanceEntityBalance(kind, entity.id);
  const investment = investmentState ? {
    roleLabel: investmentRoleLabel(investmentTerms.role),
    balanceLabel: investmentState.role === 'raise' ? 'Обязательства' : 'Результат',
    balanceValue: balance,
  } : null;
  return entityVisualCard({
    appearance: cashEntityCardAppearance(entity, kind),
    fields: cashEntityCardFields(entity, balance, kind, loanState?.endDate || '', investment),
    image: cashEntityCardPhoto(entity, kind),
    interactive: true,
    data: `data-finance-entity-type="${escapeHtml(kind)}" data-finance-entity-id="${escapeHtml(entity.id)}"`,
    aria: `Открыть ${label} ${entity.name}`,
  });
}

function horizontalCards(cards = []) {
  const values = (Array.isArray(cards) ? cards : []).filter(Boolean);
  return values.length ? entityCardRail(values) : '';
}

function allowedInvestmentRoles() {
  return [
    canUseBookCapability('finance.investment.self.access') ? { value: 'self', label: 'В своё дело' } : null,
    canUseBookCapability('finance.investment.raise.access') ? { value: 'raise', label: 'Привлекаю инвестора' } : null,
    canUseBookCapability('finance.investment.external.access') ? { value: 'external', label: 'Я инвестор' } : null,
  ].filter(Boolean);
}

function creatableInvestmentRoles() {
  return allowedInvestmentRoles().filter((item) => item.value === 'self' || item.value === 'raise');
}

function canCreateInvestment() {
  return creatableInvestmentRoles().length > 0;
}

function canCreateCashEntity() {
  return canUseBookCapability('finance.cash.access')
    || canUseBookCapability('finance.special.access')
    || canCreateInvestment();
}

function openCashCreateMenu(root) {
  const actions = [
    canUseBookCapability('finance.cash.access')
      ? button('+ Добавить кошелек', { variant: 'secondary', data: 'data-cash-create-wallet' })
      : '',
    canCreateInvestment()
      ? button('+ Добавить инвестицию', { variant: 'secondary', data: 'data-cash-create-investment' })
      : '',
    canUseBookCapability('finance.special.access')
      ? button('+ Добавить займ', { variant: 'secondary', data: 'data-cash-create-loan' })
      : '',
  ].filter(Boolean);
  if (!actions.length) return null;
  const content = actionBlock(actions.join(''));
  const layer = mountModal(document.body, modal(content, {
    title: 'Добавить',
    variant: 'x',
    surface: 'app',
  }));
  if (!layer) return null;

  layer.querySelector('[data-cash-create-wallet]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openWalletForm(root);
  });
  layer.querySelector('[data-cash-create-investment]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openCashEntityForm(root, 'investment');
  });
  layer.querySelector('[data-cash-create-loan]')?.addEventListener('click', () => {
    layer.v2Close?.();
    openCashEntityForm(root, 'loan');
  });
  return layer;
}

function cashAppearanceTypeOptions() {
  return [
    canUseBookCapability('finance.cash.access') ? { value: 'wallet', label: 'Кошелёк' } : null,
    canUseBookCapability('finance.special.access') ? { value: 'loan', label: 'Займ' } : null,
    allowedInvestmentRoles().length > 0 ? { value: 'investment', label: 'Инвестиция' } : null,
  ].filter(Boolean);
}

function cashAppearanceEntities(type) {
  if (type === 'wallet') return getWallets();
  if (type === 'loan') return getLoanEntities();
  if (type === 'investment') return getInvestmentEntities();
  return [];
}

function cashAppearanceTargetOptions(type) {
  const labels = {
    wallet: 'Все кошельки',
    loan: 'Все займы',
    investment: 'Все инвестиции',
  };
  return [
    { value: 'all', label: labels[type] || 'Все карты' },
    ...cashAppearanceEntities(type).map((item) => ({
      value: String(item.id || ''),
      label: String(item.name || (type === 'wallet' ? 'Кошелёк' : type === 'loan' ? 'Займ' : 'Инвестиция')),
    })),
  ];
}

function cashAppearanceEditor(type, target) {
  const values = cashAppearanceEntities(type);
  const selected = target === 'all'
    ? (values[0] || null)
    : (values.find((item) => String(item.id || '') === String(target || '')) || values[0] || null);
  const template = getCardAppearanceTemplate(type);

  if (type === 'wallet') {
    const wallet = selected || { id: '', name: 'Кошелёк', photo: '', cardAppearance: {} };
    return {
      appearance: target === 'all' && template?.appearance ? template.appearance : walletCardAppearance(wallet),
      fields: walletCardFields(wallet, wallet.id ? getWalletBalance(wallet.id) : 0),
      photo: target === 'all' ? String(template?.photo || wallet.photo || '') : walletCardPhoto(wallet),
      photoPosition: String(template?.photoPosition || '50% 50%'),
    };
  }

  const entity = selected || {
    id: '',
    name: type === 'loan' ? 'Займ' : 'Инвестиция',
    photo: '',
    cardAppearance: {},
    investmentTerms: type === 'investment' ? { role: allowedInvestmentRoles()[0]?.value || 'raise' } : undefined,
  };
  const movements = entity.id ? getFinanceEntityMovements(type, entity.id) : [];
  if (type === 'loan') {
    const state = calculateLoanState(entity, movements);
    return {
      appearance: target === 'all' && template?.appearance ? template.appearance : cashEntityCardAppearance(entity, type),
      fields: cashEntityCardFields(entity, state.totalDue, type, state.endDate),
      photo: target === 'all' ? String(template?.photo || entity.photo || '') : cashEntityCardPhoto(entity, type),
      photoPosition: String(template?.photoPosition || '50% 50%'),
    };
  }

  const state = calculateInvestmentState(entity, movements);
  const terms = normalizeInvestmentTerms(entity);
  const value = state.role === 'raise' ? state.remainingObligation : state.result;
  return {
    appearance: target === 'all' && template?.appearance ? template.appearance : cashEntityCardAppearance(entity, type),
    fields: cashEntityCardFields(entity, value, type, '', {
      roleLabel: investmentRoleLabel(terms.role),
      balanceLabel: state.role === 'raise' ? 'Обязательства' : 'Результат',
      balanceValue: value,
    }),
    photo: target === 'all' ? String(template?.photo || entity.photo || '') : cashEntityCardPhoto(entity, type),
    photoPosition: String(template?.photoPosition || '50% 50%'),
  };
}

async function saveCashAppearance({ type, target, appearance, photo, editor }) {
  if (target === 'all') {
    saveCardAppearanceTemplate(type, {
      appearance,
      photo,
      photoPosition: editor?.photoPosition || '50% 50%',
    });
    if (type === 'wallet') {
      cashAppearanceEntities(type).forEach((wallet) => updateWallet(wallet.id, { cardAppearance: {} }));
    } else if (type === 'loan') {
      cashAppearanceEntities(type).forEach((entity) => saveLoanEntity({ ...entity, cardAppearance: {}, updatedAt: new Date().toISOString() }));
    } else if (type === 'investment') {
      cashAppearanceEntities(type).forEach((entity) => saveInvestmentEntity({ ...entity, cardAppearance: {}, updatedAt: new Date().toISOString() }));
    }
    return;
  }

  const current = cashAppearanceEntities(type).find((item) => String(item.id || '') === String(target || ''));
  if (!current) return;
  if (type === 'wallet') {
    updateWallet(current.id, { photo, cardAppearance: appearance });
  } else if (type === 'loan') {
    saveLoanEntity({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  } else if (type === 'investment') {
    saveInvestmentEntity({ ...current, photo, cardAppearance: appearance, updatedAt: new Date().toISOString() });
  }
}

function openCashAppearanceQ(root) {
  const types = cashAppearanceTypeOptions();
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Тип карты',
    typeOptions: types,
    initialType: types[0]?.value || 'wallet',
    targetLabel: 'Карта',
    initialTarget: 'all',
    targetOptions: cashAppearanceTargetOptions,
    resolve: cashAppearanceEditor,
    save: saveCashAppearance,
    onSaved: () => renderList(root),
  });
}

function openCashSettings(root) {
  const groups = ['income-expense', 'transfer'];
  const actions = cashAppearanceTypeOptions().length
    ? [{ id: 'appearance', label: 'Вид', onSelect: () => openCashAppearanceQ(root) }]
    : [];
  if (financeOperationGroups({ groups }).length) {
    actions.push({
      id: 'financial-operations',
      label: 'Финансовые операции',
      onSelect: () => openFinanceOperations(root, {
        groups,
        onSaved: () => renderList(root),
      }),
    });
  }
  if (!actions.length) return null;
  return openSharedProfileSettingsMenu({
    title: 'Касса',
    actions,
  });
}

function renderList(root) {
  const wallets = getWallets();
  const investments = getInvestmentEntities();
  const loans = getLoanEntities();
  const canUseWallets = canUseBookCapability('finance.cash.access');
  const canUseInvestments = allowedInvestmentRoles().length > 0;
  const canUseLoans = canUseBookCapability('finance.special.access');
  root.innerHTML = page([
    cashContext(),
    canUseWallets ? v2Section('Кошельки', horizontalCards(wallets.map(renderWalletCard))) : '',
    canUseInvestments ? v2Section('Инвестиции', horizontalCards(investments.map((item) => renderCashEntityCard(item, 'investment')))) : '',
    canUseLoans ? v2Section('Займ', horizontalCards(loans.map((item) => renderCashEntityCard(item, 'loan')))) : '',
  ]);

  root.querySelector('[data-cash-settings]')?.addEventListener('click', () => openCashSettings(root));
  root.querySelector('[data-cash-create]')?.addEventListener('click', () => openCashCreateMenu(root));
  root.querySelectorAll('[data-wallet]').forEach((element) => {
    element.addEventListener('click', () => openWalletZ2(root, element.dataset.wallet));
  });
  root.querySelectorAll('[data-finance-entity-type][data-finance-entity-id]').forEach((element) => {
    element.addEventListener('click', () => {
      openFinanceEntityZ2(root, element.dataset.financeEntityType, element.dataset.financeEntityId);
    });
  });
}

function openWalletForm(root, existing = null) {
  const wallet = existing || { photo: '', name: '', cardAppearance: {} };
  const html = `<form class="compact-form" data-wallet-form novalidate>
    <div class="modal-title"><h2>${existing ? 'Изменить кошелёк' : 'Новый кошелёк'}</h2></div>
    ${photoField({ name: 'walletPhoto', value: wallet.photo || '' })}
    ${field({ label: 'Наименование кошелька', name: 'walletName', value: wallet.name || '', placeholder: 'Наименование', required: true })}
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
  const layer = mountModal(root, modal(html, { title: existing ? 'Изменить кошелёк' : 'Новый кошелёк', variant: 'q' }));
  if (!layer) return;
  initPhotoField(layer);
  layer.querySelector('[data-wallet-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = layer.querySelector('[data-wallet-form]');
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const data = new FormData(form);
    const name = String(data.get('walletName') || '').trim();
    if (!name) {
      openNotice({ message: 'Укажите наименование кошелька.' });
      return;
    }
    saveWalletData({
      id: existing?.id || crypto.randomUUID(),
      name,
      photo: String(data.get('walletPhoto') || ''),
      cardAppearance: existing?.cardAppearance || {},
      system: Boolean(existing?.system),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    layer.v2Close?.();
    renderList(root);
  });
}

function openCashEntityForm(root, kind) {
  const investment = kind === 'investment';
  if (investment) {
    const role = creatableInvestmentRoles()[0]?.value || '';
    if (!role) {
      openNotice({ message: 'Инвестиции недоступны.' });
      return null;
    }
    return openInvestmentTerms(root, null, {
      id: crypto.randomUUID(),
      name: '',
      photo: '',
      cardAppearance: {},
      investmentEvents: [],
      investmentTerms: { role },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { creating: true });
  }
  const title = 'Новый займ';
  const fieldLabel = investment ? 'Наименование инвестиции' : 'Наименование займа';
  const dataName = investment ? 'investmentName' : 'loanName';
  const photoName = investment ? 'investmentPhoto' : 'loanPhoto';
  const formData = investment ? 'data-investment-form' : 'data-loan-form';
  const html = `<form class="compact-form" ${formData} novalidate>
    <div class="modal-title"><h2>${title}</h2></div>
    ${photoField({ name: photoName, value: '' })}
    ${field({ label: fieldLabel, name: dataName, value: '', placeholder: 'Наименование', required: true })}
    ${button('Сохранить', { type: 'submit' })}
  </form>`;
  const layer = mountModal(root, modal(html, { title, variant: 'q' }));
  if (!layer) return;
  initPhotoField(layer);
  const form = layer.querySelector(`[${formData}]`);
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const data = new FormData(form);
    const name = String(data.get(dataName) || '').trim();
    if (!name) {
      openNotice({ message: `Укажите ${fieldLabel.toLocaleLowerCase('ru-RU')}.` });
      return;
    }
    const entity = {
      id: crypto.randomUUID(),
      name,
      photo: String(data.get(photoName) || ''),
      cardAppearance: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    if (investment) saveInvestmentEntity(entity);
    else saveLoanEntity(entity);
    layer.v2Close?.();
    renderList(root);
  });
}

function financeEntityById(type, id) {
  const values = type === 'loan' ? getLoanEntities() : getInvestmentEntities();
  return values.find((item) => String(item?.id || '') === String(id || '')) || null;
}

function financeEntityContext(entity, type) {
  const fallback = type === 'loan' ? 'Займ' : 'Инвестиция';
  const terms = type === 'investment' ? normalizeInvestmentTerms(entity) : null;
  const participant = terms?.participantAccountId
    ? findPersonByAccountId(terms.participantAccountId)
    : null;
  return workspaceHeaderContext({
    title: entity?.name || fallback,
    v: {
      kind: 'settings',
      data: 'data-finance-entity-settings',
      aria: `Настройки ${entity?.name || fallback}`,
    },
    d: participant && typeof cashRuntimeOptions.onDirectChat === 'function'
      ? {
          kind: 'chat',
          data: 'data-finance-entity-chat',
          aria: `Чат · ${[participant.name, participant.surname].filter(Boolean).join(' ') || entity?.name || fallback}`,
        }
      : null,
  });
}

function financeEntityOperations(type, id) {
  const grouped = new Map();
  for (const entry of getFinanceEntityMovements(type, id)) {
    const operationId = String(entry?.operationId || '');
    if (!operationId) continue;
    if (entry?.operationKind === 'cancel' || entry?.operationStatus === 'cancelled' || entry?.economicType === 'REVERSAL') continue;
    const current = grouped.get(operationId) || { ...entry, operationId, total: 0, entries: [] };
    current.entries.push(entry);
    current.total += Number(entry?.total) || 0;
    grouped.set(operationId, current);
  }
  return [...grouped.values()]
    .sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')));
}

function renderFinanceEntityOperationRow(operation, type, entityId) {
  const label = operationName(operation);
  return v2ListEntry({
    title: label,
    subtitle: String(operation?.walletName || ''),
    rightTop: formatMoney(operation.total),
    rightBottom: operationMoment(operation),
    initial: '',
    interactive: true,
    data: `data-finance-entity-operation="${escapeHtml(operation.operationId)}" data-finance-entity-type="${escapeHtml(type)}" data-finance-entity-id="${escapeHtml(entityId)}"`,
    aria: `Открыть операцию ${label}`,
  });
}

function renderInvestmentEventRow(event, entityId) {
  const label = investmentEventTitle(event);
  return v2ListEntry({
    title: label,
    subtitle: String(event?.note || ''),
    rightTop: formatMoney(event?.amount),
    rightBottom: shortDate(event?.occurredDate || event?.occurredAt || '', ''),
    initial: '',
    interactive: true,
    data: `data-finance-entity-event="${escapeHtml(String(event?.id || ''))}" data-finance-entity-id="${escapeHtml(entityId)}"`,
    aria: `Открыть событие ${label}`,
  });
}

function investmentHistory(entity, operations = []) {
  return [
    ...operations.map((operation) => ({ ...operation, investmentEvent: false })),
    ...investmentEventRows(entity),
  ].sort((a, b) => String(b?.occurredAt || '').localeCompare(String(a?.occurredAt || '')));
}

function renderFinanceEntityHistoryRow(item, type, entityId) {
  return item?.investmentEvent
    ? renderInvestmentEventRow(item, entityId)
    : renderFinanceEntityOperationRow(item, type, entityId);
}

function renderFinanceEntityLayer(root, layer, type, id) {
  const entity = financeEntityById(type, id);
  if (!entity) {
    layer.v2Close?.();
    renderList(root);
    return;
  }
  const operations = financeEntityOperations(type, entity.id);
  const history = type === 'investment' ? investmentHistory(entity, operations) : operations;
  const historyContent = history.length
    ? v2ListEntries(history.map((item) => renderFinanceEntityHistoryRow(item, type, entity.id)))
    : emptyState('Операций пока нет', type === 'loan'
      ? 'Получение и возврат займа появятся здесь.'
      : 'Движения и оценка инвестиции появятся здесь.');

  layer.innerHTML = page([
    financeEntityContext(entity, type),
    type === 'investment' ? v2Section('Расчёт', investmentSummaryRows(entity)) : '',
    v2Section('История', historyContent),
  ]);

  layer.querySelector('[data-finance-entity-settings]')?.addEventListener('click', () => {
    openFinanceEntitySettings(root, layer, type, entity);
  });
  layer.querySelector('[data-finance-entity-chat]')?.addEventListener('click', () => {
    const terms = normalizeInvestmentTerms(entity);
    const participant = findPersonByAccountId(terms.participantAccountId);
    if (participant && typeof cashRuntimeOptions.onDirectChat === 'function') {
      cashRuntimeOptions.onDirectChat(participant.key);
    }
  });
  layer.querySelectorAll('[data-finance-entity-operation]').forEach((element) => {
    element.addEventListener('click', () => {
      openFinanceEntityOperation(root, layer, type, entity, element.dataset.financeEntityOperation);
    });
  });
  layer.querySelectorAll('[data-finance-entity-event]').forEach((element) => {
    element.addEventListener('click', () => {
      openInvestmentEvent(root, layer, entity, element.dataset.financeEntityEvent);
    });
  });
}

function openFinanceEntityZ2(root, type, id) {
  const entity = financeEntityById(type, id);
  if (!entity) return null;
  const layer = mountV2ZLayer(root, v2ZLayer(''), { stack: true });
  if (!layer) return null;
  renderFinanceEntityLayer(root, layer, type, entity.id);
  return layer;
}

function investmentRoleAllowed(role = '') {
  const key = role === 'self'
    ? 'finance.investment.self.access'
    : role === 'external'
      ? 'finance.investment.external.access'
      : 'finance.investment.raise.access';
  return canUseBookCapability(key);
}

function investmentTypeOptions() {
  return [
    { value: 'own-business', label: 'Своё дело' },
    { value: 'business-project', label: 'Бизнес / проект' },
    { value: 'equity', label: 'Доля' },
    { value: 'property', label: 'Недвижимость' },
    { value: 'securities', label: 'Ценные бумаги' },
    { value: 'other', label: 'Другое' },
  ];
}

function investmentParticipationOptions(role = '') {
  if (role === 'self') return [{ value: 'self', label: 'В своё дело' }];
  return [
    { value: 'returnable', label: 'Возвратная инвестиция' },
    { value: 'equity', label: 'Доля' },
    { value: 'profit-share', label: 'Процент от прибыли' },
    { value: 'revenue-share', label: 'Процент от выручки' },
    { value: 'fixed-return', label: 'Фиксированная доходность' },
    { value: 'joint', label: 'Совместный проект' },
    { value: 'other', label: 'Другое' },
  ];
}

function investmentParticipantOptions(currentAccountId = '') {
  const options = [{ value: '', label: 'Без связи' }];
  for (const person of getPeople()) {
    const accountId = String(person?.accounts?.[0] || '');
    if (!accountId) continue;
    const name = [person.name, person.surname].filter(Boolean).join(' ').trim() || 'Пользователь';
    const uei = String(person.uei || '').trim();
    options.push({ value: accountId, label: [name, uei].filter(Boolean).join(' · ') });
  }
  if (currentAccountId && !options.some((item) => item.value === currentAccountId)) {
    options.push({ value: currentAccountId, label: 'Связанный пользователь' });
  }
  return options;
}

function investmentDraft(entity = {}, draft = null) {
  const source = draft || {};
  const terms = normalizeInvestmentTerms(source.investmentTerms ? source : entity);
  return {
    name: String(source.name ?? entity.name ?? ''),
    investmentTerms: {
      ...terms,
      objectName: String(source.investmentTerms?.objectName ?? terms.objectName ?? ''),
      participantName: String(source.investmentTerms?.participantName ?? terms.participantName ?? ''),
    },
  };
}

function investmentTermsFromForm(form, entity) {
  const data = new FormData(form);
  const previous = normalizeInvestmentTerms(entity);
  const role = String(data.get('investmentRole') || previous.role || 'self');
  const participantAccountId = role === 'raise' ? String(data.get('participantAccountId') || '') : '';
  const participant = participantAccountId ? findPersonByAccountId(participantAccountId) : null;
  const participantName = participant
    ? [participant.name, participant.surname].filter(Boolean).join(' ').trim()
    : String(data.get('participantName') || '').trim();
  const sameParticipant = participantAccountId
    && participantAccountId === previous.participantAccountId;
  return {
    name: String(data.get('investmentName') || entity?.name || '').trim(),
    investmentTerms: {
      role,
      investmentType: String(data.get('investmentType') || 'business-project'),
      participationModel: role === 'self' ? 'self' : String(data.get('participationModel') || 'returnable'),
      objectName: String(data.get('objectName') || '').trim(),
      termMode: String(data.get('termMode') || 'none'),
      endDate: String(data.get('endDate') || ''),
      durationValue: Number(data.get('durationValue') || 1),
      durationUnit: String(data.get('durationUnit') || 'months'),
      targetAmount: Number(data.get('targetAmount') || 0),
      sharePercent: Number(data.get('sharePercent') || 0),
      returnPercent: Number(data.get('returnPercent') || 0),
      participantAccountId,
      participantName,
      participantStatus: participantAccountId
        ? (sameParticipant && previous.participantStatus === 'accepted' ? 'accepted' : 'pending')
        : '',
      participantRespondedAt: sameParticipant ? previous.participantRespondedAt : '',
    },
  };
}

function investmentSummaryRows(entity) {
  const terms = normalizeInvestmentTerms(entity);
  const state = calculateInvestmentState(entity, getFinanceEntityMovements('investment', entity.id));
  const rows = [];
  if (terms.role === 'raise') {
    rows.push(
      v2ListEntry({ title: 'Привлечено', rightTop: formatMoney(state.received) }),
      v2ListEntry({ title: 'Возвращено капитала', rightTop: formatMoney(state.capitalReturned) }),
      v2ListEntry({ title: 'Выплачено дохода', rightTop: formatMoney(state.incomePaid) }),
    );
    if (['returnable', 'fixed-return'].includes(terms.participationModel)) {
      rows.push(v2ListEntry({ title: 'К возврату капитала', rightTop: formatMoney(state.remainingObligation) }));
    }
    if (['profit-share', 'revenue-share', 'fixed-return'].includes(terms.participationModel)) {
      rows.push(
        v2ListEntry({ title: 'Доход инвестора по условиям', rightTop: formatMoney(state.entitledIncome) }),
        v2ListEntry({ title: 'К выплате дохода', rightTop: formatMoney(state.incomeDue) }),
      );
    }
    if (state.explicitValuation) {
      rows.push(v2ListEntry({ title: 'Оценка проекта', rightTop: formatMoney(state.currentValue) }));
    }
    if (state.shareValue != null) {
      rows.push(v2ListEntry({ title: 'Стоимость доли инвестора', rightTop: formatMoney(state.shareValue) }));
    }
  } else {
    rows.push(
      v2ListEntry({ title: 'Вложено', rightTop: formatMoney(state.contributed) }),
      v2ListEntry({ title: 'Возвращено капитала', rightTop: formatMoney(state.returnedCapital) }),
      v2ListEntry({ title: 'Получено дохода', rightTop: formatMoney(state.income) }),
    );
    if (terms.role === 'self') rows.push(v2ListEntry({ title: 'Экономия', rightTop: formatMoney(state.savings) }));
    rows.push(
      v2ListEntry({ title: 'Расходы', rightTop: formatMoney(state.expenses) }),
      v2ListEntry({ title: 'Текущая стоимость', rightTop: formatMoney(state.currentValue) }),
    );
    if (terms.role === 'external' && ['profit-share', 'revenue-share', 'fixed-return'].includes(terms.participationModel)) {
      rows.push(
        v2ListEntry({ title: 'Доход по условиям', rightTop: formatMoney(state.entitledIncome) }),
        v2ListEntry({ title: 'Осталось получить', rightTop: formatMoney(state.incomeDue) }),
      );
    }
    rows.push(
      v2ListEntry({ title: 'Результат', rightTop: formatMoney(state.result) }),
      v2ListEntry({ title: 'ROI', rightTop: formatPercent(state.roi) }),
      v2ListEntry({ title: 'Годовая доходность', rightTop: formatPercent(state.annualizedReturn) }),
      v2ListEntry({ title: 'Окуплено', rightTop: formatPercent(state.paybackRatio) }),
    );
    if (state.paybackDate) rows.push(v2ListEntry({ title: 'Точка окупаемости', rightTop: shortDate(state.paybackDate, '') }));
  }
  if (state.endDate) rows.push(v2ListEntry({ title: 'Срок', rightTop: shortDate(state.endDate, '') }));
  return v2ListEntries(rows);
}

function renderInvestmentTermsLayer(root, entityLayer, layer, sourceEntity, draft = null, { creating = false } = {}) {
  const current = investmentDraft(sourceEntity, draft);
  const terms = current.investmentTerms;
  const acceptedAgreement = !creating && terms.role === 'raise' && terms.participantStatus === 'accepted';
  const roles = allowedInvestmentRoles();
  if (!roles.some((item) => item.value === terms.role)) {
    roles.push({ value: terms.role, label: investmentRoleLabel(terms.role) });
  }
  const participationOptions = investmentParticipationOptions(terms.role);
  const participationModel = participationOptions.some((item) => item.value === terms.participationModel)
    ? terms.participationModel
    : participationOptions[0].value;
  const termOptions = [
    { value: 'none', label: 'Без срока' },
    { value: 'date', label: 'До даты' },
    { value: 'duration', label: 'На срок' },
  ];
  const participantOptions = investmentParticipantOptions(terms.participantAccountId);
  const previewEntity = {
    ...sourceEntity,
    name: current.name,
    investmentTerms: normalizeInvestmentTerms({
      investmentTerms: { ...terms, participationModel },
    }),
  };

  layer.innerHTML = page([
    workspaceHeaderContext({ title: 'Условия инвестиции' }),
    `<form class="compact-form" data-investment-terms-form novalidate>
      ${field({ label: 'Наименование', name: 'investmentName', value: current.name, required: true, placeholder: 'Наименование' })}
      ${creating && roles.length > 1
        ? select({ label: 'Моя роль', name: 'investmentRole', value: terms.role, options: roles })
        : `<input type="hidden" name="investmentRole" value="${escapeHtml(terms.role)}">`}
      ${creating ? '' : v2ListEntries([v2ListEntry({ title: 'Моя роль', rightTop: investmentRoleLabel(terms.role) })])}
      ${select({ label: 'Тип инвестиции', name: 'investmentType', value: terms.investmentType, options: investmentTypeOptions() })}
      ${field({ label: terms.role === 'self' ? 'Во что вкладываю' : 'Проект / объект', name: 'objectName', value: terms.objectName || '', placeholder: 'Необязательно' })}
      ${terms.role === 'raise' ? select({
        label: 'Инвестор',
        name: 'participantAccountId',
        value: terms.participantAccountId || '',
        options: participantOptions,
        searchable: participantOptions.length > 8,
      }) : ''}
      ${terms.role === 'raise' && !terms.participantAccountId ? field({
        label: 'Имя инвестора',
        name: 'participantName',
        value: terms.participantName || '',
        placeholder: 'Необязательно',
      }) : ''}
      ${terms.role !== 'self' ? select({
        label: 'Условия участия',
        name: 'participationModel',
        value: participationModel,
        options: participationOptions,
      }) : `<input type="hidden" name="participationModel" value="self">`}
      ${field({
        label: terms.role === 'raise' ? 'План привлечения' : 'План вложения',
        name: 'targetAmount',
        type: 'number',
        inputmode: 'decimal',
        value: terms.targetAmount || '',
        placeholder: '0',
        data: 'min="0" step="0.01"',
      })}
      ${participationModel === 'equity' ? field({
        label: 'Доля, %',
        name: 'sharePercent',
        type: 'number',
        inputmode: 'decimal',
        value: terms.sharePercent || '',
        data: 'min="0" max="100" step="0.01"',
      }) : ''}
      ${['profit-share', 'revenue-share', 'fixed-return'].includes(participationModel) ? field({
        label: participationModel === 'profit-share'
          ? 'Процент от прибыли'
          : participationModel === 'revenue-share'
            ? 'Процент от выручки'
            : 'Доходность, %',
        name: 'returnPercent',
        type: 'number',
        inputmode: 'decimal',
        value: terms.returnPercent || '',
        data: 'min="0" max="100" step="0.01"',
      }) : ''}
      ${select({ label: 'Срок', name: 'termMode', value: terms.termMode, options: termOptions })}
      ${terms.termMode === 'date' ? datePicker({
        label: 'Дата окончания',
        name: 'endDate',
        value: terms.endDate || '',
        required: true,
        allowClear: false,
      }) : ''}
      ${terms.termMode === 'duration' ? `${field({
        label: 'Срок',
        name: 'durationValue',
        type: 'number',
        inputmode: 'numeric',
        value: terms.durationValue,
        required: true,
        data: 'min="1" step="1"',
      })}${select({
        label: 'Единица срока',
        name: 'durationUnit',
        value: terms.durationUnit,
        options: [
          { value: 'months', label: 'Месяцев' },
          { value: 'years', label: 'Лет' },
        ],
      })}` : ''}
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-investment-terms-save', aria: 'Сохранить условия инвестиции' }))}
    </form>`,
    creating ? '' : v2Section('Расчёт', investmentSummaryRows(previewEntity)),
  ]);

  initDatePickers(layer);
  const form = layer.querySelector('[data-investment-terms-form]');
  if (!form) return;
  form.addEventListener('change', (event) => {
    const name = String(event.target?.name || '');
    if (!['investmentRole', 'investmentType', 'participantAccountId', 'participationModel', 'termMode', 'endDate', 'durationValue', 'durationUnit', 'targetAmount', 'sharePercent', 'returnPercent'].includes(name)) return;
    if (acceptedAgreement) {
      openNotice({ message: 'Условия уже приняты инвестором. Для новых условий нужно новое соглашение.' });
      renderInvestmentTermsLayer(root, entityLayer, layer, sourceEntity, null, { creating });
      return;
    }
    renderInvestmentTermsLayer(root, entityLayer, layer, sourceEntity, investmentTermsFromForm(form, sourceEntity), { creating });
  });
  layer.querySelector('[data-investment-terms-save]')?.addEventListener('click', () => form.requestSubmit());
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const nextDraft = acceptedAgreement
      ? {
          name: String(new FormData(form).get('investmentName') || sourceEntity?.name || '').trim(),
          investmentTerms: normalizeInvestmentTerms(sourceEntity),
        }
      : investmentTermsFromForm(form, sourceEntity);
    if (!nextDraft.name) {
      openNotice({ message: 'Укажите наименование инвестиции.' });
      return;
    }
    if (!investmentRoleAllowed(nextDraft.investmentTerms.role)) {
      openNotice({ message: 'Этот режим инвестиций недоступен.' });
      return;
    }
    if (nextDraft.investmentTerms.termMode === 'date' && !nextDraft.investmentTerms.endDate) {
      openNotice({ message: 'Укажите дату окончания.' });
      return;
    }
    const next = {
      ...sourceEntity,
      name: nextDraft.name,
      investmentTerms: normalizeInvestmentTerms({ investmentTerms: nextDraft.investmentTerms }),
      investmentEvents: Array.isArray(sourceEntity.investmentEvents) ? sourceEntity.investmentEvents : [],
      updatedAt: new Date().toISOString(),
    };
    saveInvestmentEntity(next);
    layer.v2Close?.();
    if (entityLayer?.isConnected) renderFinanceEntityLayer(root, entityLayer, 'investment', next.id);
    renderList(root);
  });
}

function openInvestmentTerms(root, entityLayer, entity, options = {}) {
  const host = entityLayer || root;
  const layer = mountV2ZLayer(host, v2ZLayer(''), { stack: true });
  if (!layer) return null;
  renderInvestmentTermsLayer(root, entityLayer, layer, entity, null, options);
  return layer;
}

function saveInvestmentEvent(entity, event = {}) {
  const next = {
    ...entity,
    investmentEvents: [
      ...(Array.isArray(entity.investmentEvents) ? entity.investmentEvents : []),
      {
        id: crypto.randomUUID(),
        type: String(event.type || ''),
        amount: Math.max(0, Number(event.amount) || 0),
        occurredDate: String(event.occurredDate || ''),
        note: String(event.note || '').trim(),
        createdAt: new Date().toISOString(),
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  saveInvestmentEntity(next);
  return next;
}

function investmentEventTitle(event = {}) {
  return ({
    valuation: 'Изменение оценки',
    saving: 'Экономия',
    reinvestment: 'Реинвестирование',
    'project-profit': 'Прибыль проекта',
    'project-revenue': 'Выручка проекта',
  })[String(event.type || '')] || 'Событие инвестиции';
}

function investmentEventRows(entity = {}) {
  return (Array.isArray(entity.investmentEvents) ? entity.investmentEvents : [])
    .filter((event) => event && !event.deletedAt)
    .map((event) => ({
      ...event,
      occurredAt: String(event.occurredDate || event.occurredAt || ''),
      total: Number(event.amount) || 0,
      investmentEvent: true,
    }));
}

function loanRateOptions() {
  return [
    { value: '0', label: 'Без процентов' },
    ...Array.from({ length: 100 }, (_, index) => ({
      value: String(index + 1),
      label: `${index + 1}%`,
    })),
  ];
}

function loanTermsDraft(entity = {}, draft = null) {
  const terms = normalizeLoanTerms(draft ? { loanTerms: draft.loanTerms } : entity);
  return {
    name: String(draft?.name ?? entity?.name ?? ''),
    loanTerms: {
      ...terms,
      lenderName: String(draft?.loanTerms?.lenderName ?? terms.lenderName ?? ''),
    },
  };
}

function loanTermsFromForm(form, entity) {
  const data = new FormData(form);
  return {
    name: String(data.get('loanName') || entity?.name || '').trim(),
    loanTerms: {
      lenderName: String(data.get('lenderName') || '').trim(),
      termMode: String(data.get('termMode') || 'none'),
      endDate: String(data.get('endDate') || ''),
      durationValue: Number(data.get('durationValue') || 1),
      durationUnit: String(data.get('durationUnit') || 'months'),
      interestRate: Number(data.get('interestRate') || 0),
      ratePeriod: String(data.get('ratePeriod') || 'annual'),
      repaymentMode: String(data.get('repaymentMode') || 'free'),
      monthlyMode: String(data.get('monthlyMode') || 'equal-payment'),
      firstPaymentDate: String(data.get('firstPaymentDate') || ''),
    },
  };
}

function loanCalculationRows(entity) {
  const movements = getFinanceEntityMovements('loan', entity.id);
  const state = calculateLoanState(entity, movements);
  const rows = [
    v2ListEntry({ title: 'Получено', rightTop: formatMoney(state.received) }),
    v2ListEntry({ title: 'Возвращено', rightTop: formatMoney(state.repaid) }),
    v2ListEntry({ title: 'Основной долг', rightTop: formatMoney(state.principal) }),
    v2ListEntry({ title: 'Начислено процентов', rightTop: formatMoney(state.accruedInterest) }),
    v2ListEntry({ title: 'К возврату', rightTop: formatMoney(state.totalDue) }),
  ];
  if (state.endDate) rows.push(v2ListEntry({ title: 'Срок', rightTop: shortDate(state.endDate, '') }));
  return { state, html: v2ListEntries(rows) };
}

function loanScheduleRows(entity) {
  const movements = getFinanceEntityMovements('loan', entity.id);
  const schedule = buildLoanSchedule(entity, movements);
  if (!schedule.length) return '';
  return v2ListEntries(schedule.map((item) => v2ListEntry({
    title: shortDate(item.date, ''),
    subtitle: `Основной долг ${formatMoney(item.principal)} · Проценты ${formatMoney(item.interest)}`,
    rightTop: formatMoney(item.total),
  })));
}

function renderLoanTermsLayer(root, entityLayer, layer, sourceEntity, draft = null) {
  const current = loanTermsDraft(sourceEntity, draft);
  const terms = current.loanTerms;
  const termOptions = [
    { value: 'none', label: 'Без срока' },
    { value: 'date', label: 'До даты' },
    { value: 'duration', label: 'На срок' },
  ];
  const repaymentOptions = terms.termMode === 'none'
    ? [
        { value: 'free', label: 'Свободно' },
        { value: 'monthly', label: 'Ежемесячно' },
      ]
    : [
        { value: 'free', label: 'Свободно' },
        { value: 'end', label: 'В конце срока' },
        { value: 'monthly', label: 'Ежемесячно' },
      ];
  const monthlyOptions = terms.termMode === 'none'
    ? [{ value: 'interest-only', label: 'Проценты ежемесячно' }]
    : [
        { value: 'equal-payment', label: 'Равными платежами' },
        { value: 'equal-principal', label: 'Равными частями основного долга' },
        { value: 'interest-only', label: 'Проценты ежемесячно, основной долг в конце' },
      ];
  const safeRepayment = repaymentOptions.some((item) => item.value === terms.repaymentMode)
    ? terms.repaymentMode
    : 'free';
  const safeMonthly = monthlyOptions.some((item) => item.value === terms.monthlyMode)
    ? terms.monthlyMode
    : monthlyOptions[0].value;
  const previewEntity = {
    ...sourceEntity,
    name: current.name,
    loanTerms: {
      ...terms,
      repaymentMode: safeRepayment,
      monthlyMode: safeMonthly,
    },
  };
  const calculation = loanCalculationRows(previewEntity);
  const schedule = loanScheduleRows(previewEntity);

  layer.innerHTML = page([
    workspaceHeaderContext({ title: 'Условия займа' }),
    `<form class="compact-form" data-loan-terms-form novalidate>
      ${field({ label: 'Наименование', name: 'loanName', value: current.name, required: true })}
      ${field({ label: 'У кого заняли', name: 'lenderName', value: terms.lenderName || '', placeholder: 'Необязательно' })}
      ${select({ label: 'Срок', name: 'termMode', value: terms.termMode, options: termOptions })}
      ${terms.termMode === 'date' ? datePicker({
        label: 'Дата возврата',
        name: 'endDate',
        value: terms.endDate || '',
        required: true,
        allowClear: false,
      }) : ''}
      ${terms.termMode === 'duration' ? `${field({
        label: 'Срок',
        name: 'durationValue',
        type: 'number',
        inputmode: 'numeric',
        value: terms.durationValue,
        required: true,
        data: 'min="1" step="1"',
      })}${select({
        label: 'Единица срока',
        name: 'durationUnit',
        value: terms.durationUnit,
        options: [
          { value: 'months', label: 'Месяцев' },
          { value: 'years', label: 'Лет' },
        ],
      })}` : ''}
      ${select({ label: 'Ставка', name: 'interestRate', value: String(terms.interestRate), options: loanRateOptions() })}
      ${terms.interestRate > 0 ? select({
        label: 'Период ставки',
        name: 'ratePeriod',
        value: terms.ratePeriod,
        options: [
          { value: 'monthly', label: 'В месяц' },
          { value: 'annual', label: 'В год' },
        ],
      }) : ''}
      ${select({ label: 'Порядок возврата', name: 'repaymentMode', value: safeRepayment, options: repaymentOptions })}
      ${safeRepayment === 'monthly' ? select({
        label: 'Расчёт платежа',
        name: 'monthlyMode',
        value: safeMonthly,
        options: monthlyOptions,
      }) : ''}
      ${safeRepayment === 'monthly' ? datePicker({
        label: 'Первый платёж',
        name: 'firstPaymentDate',
        value: terms.firstPaymentDate || '',
        required: false,
        allowClear: true,
      }) : ''}
      ${actionBlock(button('Сохранить', { type: 'button', data: 'data-loan-terms-save', aria: 'Сохранить условия займа' }))}
    </form>`,
    v2Section('Расчёт', calculation.html),
    schedule ? v2Section('График', schedule) : '',
  ]);

  initDatePickers(layer);
  const form = layer.querySelector('[data-loan-terms-form]');
  if (!form) return;

  form.addEventListener('change', (event) => {
    const name = String(event.target?.name || '');
    if (!['termMode', 'endDate', 'durationValue', 'durationUnit', 'interestRate', 'ratePeriod', 'repaymentMode', 'monthlyMode', 'firstPaymentDate'].includes(name)) return;
    renderLoanTermsLayer(root, entityLayer, layer, sourceEntity, loanTermsFromForm(form, sourceEntity));
  });

  layer.querySelector('[data-loan-terms-save]')?.addEventListener('click', () => {
    form.requestSubmit();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const nextDraft = loanTermsFromForm(form, sourceEntity);
    if (!nextDraft.name) {
      openNotice({ message: 'Укажите наименование займа.' });
      return;
    }
    if (nextDraft.loanTerms.termMode === 'date' && !nextDraft.loanTerms.endDate) {
      openNotice({ message: 'Укажите дату возврата.' });
      return;
    }
    const next = {
      ...sourceEntity,
      name: nextDraft.name,
      loanTerms: normalizeLoanTerms({ loanTerms: nextDraft.loanTerms }),
      updatedAt: new Date().toISOString(),
    };
    saveLoanEntity(next);
    layer.v2Close?.();
    renderFinanceEntityLayer(root, entityLayer, 'loan', next.id);
    renderList(root);
  });
}

function openLoanTerms(root, entityLayer, entity) {
  const layer = mountV2ZLayer(entityLayer, v2ZLayer(''), { stack: true });
  if (!layer) return null;
  renderLoanTermsLayer(root, entityLayer, layer, entity);
  return layer;
}

function openFinanceEntitySettings(root, entityLayer, type, entity) {
  const terms = type === 'investment' ? normalizeInvestmentTerms(entity) : null;
  const financeEntity = {
    type,
    id: entity.id,
    name: entity.name,
    role: terms?.role || '',
    participationModel: terms?.participationModel || '',
  };
  const saved = () => {
    renderFinanceEntityLayer(root, entityLayer, type, entity.id);
    renderList(root);
  };

  const actions = [];

  if (type === 'loan') {
    actions.push({
      id: 'terms',
      label: 'Условия займа',
      onSelect: () => openLoanTerms(root, entityLayer, entity),
    });
    actions.push({
      id: 'financial-operation',
      label: 'Финансовая операция',
      onSelect: () => openEntityFinanceOperation(entityLayer, type, {
        financeEntity,
        onSaved: saved,
      }),
    });
  } else if (investmentRoleAllowed(terms.role)) {
    actions.push({
      id: 'terms',
      label: 'Условия инвестиции',
      onSelect: () => openInvestmentTerms(root, entityLayer, entity),
    });
    actions.push({
      id: 'financial-operation',
      label: 'Финансовая операция',
      onSelect: () => openEntityFinanceOperation(entityLayer, type, {
        financeEntity,
        onInvestmentEventSaved: (event) => saveInvestmentEvent(
          financeEntityById('investment', entity.id) || entity,
          event,
        ),
        onSaved: saved,
      }),
    });
  }

  return openSharedProfileSettingsMenu({
    title: entity.name,
    actions,
  });
}

function openInvestmentEvent(root, entityLayer, entity, eventId) {
  const event = (Array.isArray(entity?.investmentEvents) ? entity.investmentEvents : [])
    .find((item) => String(item?.id || '') === String(eventId || '') && !item?.deletedAt);
  if (!event) return null;
  const layer = mountV2ZLayer(entityLayer, v2ZLayer(page([
    workspaceHeaderContext({
      title: investmentEventTitle(event),
      v: {
        kind: 'settings',
        data: 'data-investment-event-settings',
        aria: 'Настройки события инвестиции',
      },
    }),
    readOnlyReceipt({
      title: investmentEventTitle(event),
      date: shortDate(event.occurredDate || event.occurredAt || '', '—'),
      time: '',
      items: event.note ? [{ label: String(event.note), value: '' }] : [],
      totals: [{ label: '', value: formatMoney(event.amount), strong: true }],
    }),
  ])), { stack: true });
  if (!layer) return null;

  layer.querySelector('[data-investment-event-settings]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: investmentEventTitle(event),
      actions: [{
        id: 'delete-event',
        label: 'Удалить событие',
        variant: 'danger',
        onSelect: () => {
          const current = financeEntityById('investment', entity.id) || entity;
          saveInvestmentEntity({
            ...current,
            investmentEvents: (Array.isArray(current.investmentEvents) ? current.investmentEvents : [])
              .filter((item) => String(item?.id || '') !== String(event.id || '')),
            updatedAt: new Date().toISOString(),
          });
          layer.v2Close?.();
          renderFinanceEntityLayer(root, entityLayer, 'investment', entity.id);
          renderList(root);
        },
      }],
    });
  });
  return layer;
}

function openFinanceEntityOperation(root, entityLayer, type, entity, operationId) {
  const operation = financeEntityOperations(type, entity.id)
    .find((item) => String(item?.operationId || '') === String(operationId || ''));
  if (!operation) return null;
  const layer = mountV2ZLayer(entityLayer, v2ZLayer(page([
    operationContext(operation),
    operationReceipt(operation),
  ])), { stack: true });
  if (!layer) return null;
  layer.querySelector('[data-wallet-operation-settings]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title: operationName(operation),
      actions: [{
        id: 'delete-operation',
        label: 'Удалить операцию',
        variant: 'danger',
        onSelect: async () => {
          try {
            await cancelFinanceOperation(operation.operationId, {
              reason: 'incorrect-entry',
              occurredAt: new Date(),
            });
            layer.v2Close?.();
            renderFinanceEntityLayer(root, entityLayer, type, entity.id);
            renderList(root);
          } catch (error) {
            openNotice({ message: String(error?.message || 'Не удалось удалить операцию') });
          }
        },
      }],
    });
  });
  return layer;
}

function renderWalletLayer(root, layer, walletId) {
  const wallet = getWallets().find((item) => String(item.id) === String(walletId));
  if (!wallet) {
    layer.v2Close?.();
    renderList(root);
    return;
  }
  const operations = walletOperations(wallet.id);
  layer.innerHTML = page([
    walletContext(wallet),
    operations.length
      ? v2ListEntries(operations.map(renderOperationRow))
      : emptyState('Операций пока нет', 'Движения по этой кассе появятся здесь.'),
  ]);
  layer.querySelector('[data-wallet-settings]')?.addEventListener('click', () => {
    void openWalletSettings(root, layer, wallet);
  });
  layer.querySelectorAll('[data-wallet-operation]').forEach((element) => {
    element.addEventListener('click', () => openWalletOperation(root, layer, wallet, element.dataset.walletOperation));
  });
}

function openWalletZ2(root, walletId) {
  const wallet = getWallets().find((item) => String(item.id) === String(walletId));
  if (!wallet) return;
  const layer = mountV2ZLayer(root, v2ZLayer(''), { stack: true });
  if (!layer) return;
  renderWalletLayer(root, layer, wallet.id);
}

function confirmDeleteWallet(root, walletLayer, wallet) {
  if (Math.abs(getWalletBalance(wallet.id)) > 0.009) {
    openNotice({ message: 'Сначала переведите остаток из этой кассы.' });
    return;
  }
  openSharedProfileSettingsMenu({
    title: wallet.name,
    actions: [{
      id: 'confirm-delete',
      label: 'Удалить кассу',
      variant: 'danger',
      onSelect: () => {
        if (!deleteWalletData(wallet.id)) return;
        walletLayer.v2Close?.();
        renderList(root);
      },
    }],
  });
}

function confirmHardDeleteWallet(root, walletLayer, wallet) {
  openSharedProfileSettingsMenu({
    title: wallet.name,
    actions: [{
      id: 'confirm-hard-delete',
      label: 'Полное удаление',
      variant: 'danger',
      onSelect: async () => {
        try {
          await hardDeleteFinanceWallet(wallet.id);
          deleteWalletPermanently(wallet.id);
          walletLayer.v2Close?.();
          renderList(root);
        } catch (error) {
          openNotice({ message: String(error?.message || 'Не удалось полностью удалить кассу') });
        }
      },
    }],
  });
}

async function openWalletSettings(root, walletLayer, wallet) {
  const actions = [];

  if (!wallet.system) {
    actions.push({
      id: 'delete',
      label: 'Удалить кассу',
      variant: 'danger',
      onSelect: () => confirmDeleteWallet(root, walletLayer, wallet),
    });
    const isAdmin = await canPermanentlyDeleteFinanceData().catch(() => false);
    if (isAdmin && walletLayer.isConnected) {
      actions.push({
        id: 'hard-delete',
        label: 'Полное удаление',
        variant: 'danger',
        onSelect: () => confirmHardDeleteWallet(root, walletLayer, wallet),
      });
    }
  }

  if (!walletLayer.isConnected) return null;
  if (!actions.length) return null;
  return openSharedProfileSettingsMenu({
    title: wallet.name,
    actions,
  });
}

function operationReceipt(operation) {
  const when = shortDateTimeParts(operation?.occurredAt || '');
  const fullName = [operation?.person?.name, operation?.person?.surname]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
  return readOnlyReceipt({
    title: operationName(operation),
    date: when.date || '—',
    time: when.time || '—',
    items: [
      { label: String(operation?.workplace || '').trim(), value: '' },
      { label: String(operation?.person?.uei || '').trim(), value: '' },
      { label: fullName, value: '' },
    ].filter((item) => item.label || item.value),
    totals: [
      { label: '', value: formatMoney(operation?.total), strong: true },
    ],
  });
}

function openWalletOperation(root, walletLayer, wallet, operationId) {
  const operation = walletOperations(wallet.id)
    .find((item) => String(item.operationId) === String(operationId));
  if (!operation) return;
  const layer = mountV2ZLayer(walletLayer, v2ZLayer(page([
    operationContext(operation),
    operationReceipt(operation),
  ])), { stack: true });
  if (!layer) return;
  layer.querySelector('[data-wallet-operation-settings]')?.addEventListener('click', () => {
    openOperationSettings(root, walletLayer, layer, wallet, operation);
  });
}

function openOperationSettings(root, walletLayer, operationLayer, wallet, operation) {
  return openSharedProfileSettingsMenu({
    title: operationName(operation),
    actions: [{
      id: 'delete-operation',
      label: 'Удалить операцию',
      variant: 'danger',
      onSelect: async () => {
        try {
          await cancelFinanceOperation(operation.operationId, {
            reason: 'incorrect-entry',
            occurredAt: new Date(),
          });
          operationLayer.v2Close?.();
          renderWalletLayer(root, walletLayer, wallet.id);
        } catch (error) {
          openNotice({ message: String(error?.message || 'Не удалось удалить операцию') });
        }
      },
    }],
  });
}

export function renderWallets(root, options = {}) {
  cashRuntimeOptions = options && typeof options === 'object' ? options : {};
  renderList(root);
}

export { renderWallets as render };
