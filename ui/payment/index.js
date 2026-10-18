import { button } from '../buttons/index.js';
import { miniCard } from '../cards/mini-card.js';
import { select } from '../selectors/index.js';
import { field } from '../inputs/index.js';
import { escapeHtml } from '../utils/escape-html.js';
import { v2ZBodySections } from '../v2/z-layout.js';
import { paymentMethodsMarkup, initPaymentMethodsAllocation } from './methods.js';

const numberValue = (value) => {
  const number = Number(String(value ?? '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(number) ? number : 0;
};

const moneyText = (value) => {
  const number = numberValue(value);
  return String(Math.round(number * 100) / 100);
};

const moneyDisplay = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Math.max(0, numberValue(value))).replaceAll('\u00a0', ' ')} ₽`;

const percentText = (value) => {
  const number = numberValue(value);
  if (!number) return '';
  return String(Math.round(number * 100) / 100);
};

const percentOptions = [
  { value: '', label: '—' },
  ...Array.from({ length: 100 }, (_, index) => ({ value: String(index + 1), label: `${index + 1}%` })),
];

function paymentSummary({ workplace = '', date = '', time = '', person = {}, total = 0 } = {}) {
  const identity = [person?.uei, person?.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  return `<div class="payment-summary-mini-card-wrap">${miniCard({
    className: 'payment-summary-mini-card',
    lines: [
      { value: workplace || '—', strong: true },
      { value: date || '—' },
      { value: time || '—', align: 'right' },
      { value: identity || '—', strong: true },
      { value: 'К оплате', strong: true },
      { value: moneyDisplay(total), align: 'right', strong: true },
    ],
  })}</div>`;
}

function paymentItemHeader(name = '') {
  const value = String(name || '');
  return `<div class="payment-item-head">
    <strong class="payment-item-head__name">${escapeHtml(value)}</strong>
    <button type="button" class="payment-item-head__remove" data-payment-remove aria-label="Удалить ${escapeHtml(value)}">×</button>
  </div>`;
}

function correctionPresentation(procedure = {}, price = 0) {
  const explicitMode = procedure?.correctionMode;
  if (explicitMode === 'percent') {
    const value = Math.max(0, Math.min(100, numberValue(procedure?.correctionPercent)));
    return { mode: value > 0 ? 'percent' : 'none', percent: value, money: 0 };
  }
  if (explicitMode === 'money') {
    const value = Math.max(0, Math.min(price, numberValue(procedure?.correctionMoney)));
    return { mode: value > 0 ? 'money' : 'none', percent: 0, money: value };
  }
  return { mode: 'none', percent: 0, money: 0 };
}

function paymentProcedureBlock(procedure, index) {
  const price = Math.max(0, numberValue(procedure?.cost));
  const pricePercent = Math.max(0, Math.min(100, numberValue(procedure?.pricePercent)));
  const correction = correctionPresentation(procedure, price);
  const itemName = procedure?.name || '';
  return `<div class="payment-item-section" data-payment-procedure="${index}" data-payment-source-type="${escapeHtml(procedure?.sourceType || 'procedure')}" data-payment-source-id="${escapeHtml(procedure?.id || '')}" data-payment-name="${escapeHtml(itemName)}" data-payment-correction-mode="${correction.mode}" data-payment-price-percent="${escapeHtml(percentText(pricePercent))}">
    ${paymentItemHeader(itemName)}
    <div class="payment-edit-grid">
      ${field({ label: 'Цена', value: moneyText(price), type: 'number', inputmode: 'decimal', min: 0, step: '0.01', data: 'data-payment-price' })}
      ${pricePercent > 0 ? field({ label: 'Условие', value: `${percentText(pricePercent)}%`, disabled: true, data: 'data-payment-price-condition' }) : ''}
      ${select({ label: 'Скидка %', value: correction.mode === 'percent' ? percentText(correction.percent) : '', options: percentOptions, className: 'ui-select--center', data: 'data-payment-correction-percent', aria: 'Скидка в процентах' })}
      ${field({ label: 'Скидка ₽', value: correction.mode === 'money' ? moneyText(correction.money) : '', type: 'number', inputmode: 'decimal', min: 0, step: '0.01', data: 'data-payment-correction-money' })}
    </div>
  </div>`;
}

export function paymentForm({
  workplace = '',
  date = '',
  time = '',
  person = {},
  procedures = [],
  total = 0,
  showActions = true,
} = {}) {
  const procedureBlocks = (Array.isArray(procedures) ? procedures : [])
    .map((procedure, index) => paymentProcedureBlock(procedure, index));
  const sections = [
    {
      kind: 'content',
      content: `<div data-payment-summary>${paymentSummary({ workplace, date, time, person, total })}</div>`,
    },
    ...procedureBlocks.map((content) => ({ kind: 'content', content })),
  ];

  return `<div data-payment-ui
    data-payment-workplace="${escapeHtml(workplace)}"
    data-payment-date="${escapeHtml(date)}"
    data-payment-time="${escapeHtml(time)}"
    data-payment-uei="${escapeHtml(person?.uei || '')}"
    data-payment-person-name="${escapeHtml(person?.name || '')}">
    <div data-payment-sections>${v2ZBodySections(sections)}</div>
    ${showActions ? `<div class="modal-actions" data-payment-actions>${button('Оплатить', { data: 'data-payment-action' })}</div>` : ''}
  </div>`;
}

export function paymentMethods({
  wallets = [],
  deposits = [],
  personalAccount = null,
  total = 0,
  showAction = true,
  showTotal = true,
  initialAllocations = [],
  initialDepositAllocations = [],
  initialPersonalAccountAmount = 0,
} = {}) {
  const walletData = escapeHtml(JSON.stringify(Array.isArray(wallets) ? wallets.map((wallet) => ({ id: String(wallet?.id || ''), name: String(wallet?.name || '') })) : []));
  const depositData = escapeHtml(JSON.stringify(Array.isArray(deposits) ? deposits.map((deposit) => ({
    depositId: String(deposit?.depositId || deposit?.id || ''),
    programName: String(deposit?.programName || deposit?.name || 'Депозит'),
    balance: Math.max(0, numberValue(deposit?.balance)),
  })) : []));
  const accountData = escapeHtml(JSON.stringify(personalAccount && typeof personalAccount === 'object' ? {
    personKey: String(personalAccount?.personKey || ''),
    balance: Math.max(0, numberValue(personalAccount?.balance)),
    availableAmount: Math.max(0, numberValue(personalAccount?.availableAmount ?? personalAccount?.balance)),
    spendLimitPercent: Math.max(0, Math.min(100, numberValue(personalAccount?.spendLimitPercent ?? 100))),
  } : null));
  return `<div data-payment-methods data-payment-total="${escapeHtml(moneyText(total))}" data-payment-wallets="${walletData}" data-payment-deposits="${depositData}" data-payment-personal-account="${accountData}">${paymentMethodsMarkup({
    wallets,
    deposits,
    personalAccount,
    total,
    showAction,
    showTotal,
    initialAllocations,
    initialDepositAllocations,
    initialPersonalAccountAmount,
  })}</div>`;
}

function rowValues(row) {
  const priceInput = row.querySelector('[data-payment-price]');
  const percentInput = row.querySelector('input[data-payment-correction-percent]');
  const moneyInput = row.querySelector('[data-payment-correction-money]');
  return {
    priceInput,
    percentInput,
    moneyInput,
    price: Math.max(0, numberValue(priceInput?.value)),
    percent: Math.max(0, numberValue(percentInput?.value)),
    money: Math.max(0, numberValue(moneyInput?.value)),
    pricePercent: Math.max(0, Math.min(100, numberValue(row.dataset.paymentPricePercent))),
  };
}

function setPercentDisplay(input, value) {
  if (!input) return;
  const percent = percentText(value);
  input.value = percent;
  const trigger = input.closest('.ui-select')?.querySelector('[data-ui-select-trigger] .ui-select__value');
  if (trigger) trigger.textContent = percent ? `${percent}%` : '—';
}

function settlementInputs(root) {
  return [...root.querySelectorAll('[data-payment-procedure]')].map((row) => {
    const values = rowValues(row);
    const mode = row.dataset.paymentCorrectionMode || 'none';
    return {
      sourceType: row.dataset.paymentSourceType || 'procedure',
      sourceId: row.dataset.paymentSourceId || '',
      name: row.dataset.paymentName || '',
      price: values.price,
      pricePercent: values.pricePercent,
      correctionMode: mode,
      correctionPercent: mode === 'percent' ? values.percent : '',
      correctionMoney: mode === 'money' ? values.money : '',
    };
  });
}

function applySettlement(root, settlement = null, { preserve = null, paidTotal = 0 } = {}) {
  const items = Array.isArray(settlement?.items) ? settlement.items : [];
  [...root.querySelectorAll('[data-payment-procedure]')].forEach((row, index) => {
    const item = items[index];
    if (!item) return;
    const pricePercent = Math.max(0, Math.min(100, numberValue(item.pricePercent)));
    const correction = correctionPresentation(item, Math.max(0, numberValue(item.price)));
    row.dataset.paymentPricePercent = percentText(pricePercent);
    row.dataset.paymentCorrectionMode = correction.mode;
    const { priceInput } = rowValues(row);
    const { percentInput, moneyInput } = rowValues(row);
    if (priceInput && priceInput !== preserve) priceInput.value = moneyText(item.price);
    if (percentInput !== preserve) setPercentDisplay(percentInput, correction.mode === 'percent' ? correction.percent : 0);
    if (moneyInput && moneyInput !== preserve) moneyInput.value = correction.mode === 'money' ? moneyText(correction.money) : '';
    const conditionInput = row.querySelector('[data-payment-price-condition]');
    if (conditionInput) conditionInput.value = pricePercent > 0 ? `${percentText(pricePercent)}%` : '';
  });
  const summary = root.querySelector('[data-payment-summary]');
  if (summary) {
    summary.innerHTML = paymentSummary({
      workplace: root.dataset.paymentWorkplace || '',
      date: root.dataset.paymentDate || '',
      time: root.dataset.paymentTime || '',
      person: {
        uei: root.dataset.paymentUei || '',
        name: root.dataset.paymentPersonName || '',
      },
      total: Math.max(0, numberValue(settlement?.planTotal) - Math.max(0, numberValue(paidTotal))),
    });
  }
}

function recalculate(root, calculate, { preserve = null, paidTotal = 0 } = {}) {
  if (typeof calculate !== 'function') return null;
  const settlement = calculate(settlementInputs(root));
  applySettlement(root, settlement, { preserve, paidTotal });
  return settlement;
}

export function initPaymentForm(root, {
  calculate = null,
  paidTotal = 0,
  onSave = () => {},
  onPay = () => {},
  onRemove = () => {},
  onChange = () => {},
} = {}) {
  if (!root) return null;
  const initialSettlement = recalculate(root, calculate, { paidTotal });
  let baseline = JSON.stringify(settlementInputs(root));
  let actionBusy = false;
  const actionButton = root.querySelector('[data-payment-action]');

  const syncAction = (state) => {
    if (!actionButton) return;
    const dirty = Boolean(state?.dirty);
    actionButton.textContent = dirty ? 'Сохранить' : 'Оплатить';
    actionButton.setAttribute('aria-label', dirty ? 'Сохранить' : 'Оплатить');
    actionButton.classList.toggle('ui-button--secondary', dirty);
    actionButton.hidden = !dirty && Math.max(0, numberValue(state?.total)) <= 0.009;
  };

  const currentState = (preserve = null) => {
    const settlement = recalculate(root, calculate, { preserve, paidTotal });
    const dirty = JSON.stringify(settlementInputs(root)) !== baseline;
    const result = {
      settlement,
      items: settlement?.items || [],
      total: Math.max(0, numberValue(settlement?.planTotal) - Math.max(0, numberValue(paidTotal))),
      dirty,
    };
    syncAction(result);
    onChange?.(result);
    return result;
  };

  root.querySelectorAll('[data-payment-procedure]').forEach((row) => {
    const { priceInput, percentInput, moneyInput } = rowValues(row);
    priceInput?.addEventListener('input', () => {
      currentState(priceInput);
    });
    percentInput?.addEventListener('change', () => {
      row.dataset.paymentCorrectionMode = percentInput.value ? 'percent' : 'none';
      if (percentInput.value && moneyInput) moneyInput.value = '';
      currentState(percentInput);
    });
    moneyInput?.addEventListener('input', () => {
      row.dataset.paymentCorrectionMode = moneyInput.value ? 'money' : 'none';
      if (moneyInput.value && percentInput) setPercentDisplay(percentInput, 0);
      currentState(moneyInput);
    });
  });

  root.querySelectorAll('[data-payment-remove]').forEach((remove) => remove.addEventListener('click', () => {
    const row = remove.closest('[data-payment-procedure]');
    if (!row) return;
    const removed = {
      sourceType: row.dataset.paymentSourceType || 'procedure',
      sourceId: row.dataset.paymentSourceId || '',
      name: row.dataset.paymentName || '',
    };
    row.remove();
    const result = currentState();
    onRemove?.({ ...removed, ...result });
  }));

  actionButton?.addEventListener('click', async () => {
    if (actionBusy) return;
    const result = currentState();
    if (!result.settlement) return;
    if (!result.dirty) {
      onPay?.(result);
      return;
    }

    actionBusy = true;
    actionButton.disabled = true;
    try {
      const saved = await onSave?.(result);
      if (!root.isConnected) return;
      if (saved == null || saved === false) {
        syncAction(currentState());
        return;
      }
      baseline = JSON.stringify(settlementInputs(root));
      currentState();
    } catch (error) {
      if (root.isConnected) syncAction(currentState());
    } finally {
      actionBusy = false;
      if (actionButton.isConnected) actionButton.disabled = false;
    }
  });

  const initialState = {
    settlement: initialSettlement,
    items: initialSettlement?.items || [],
    total: Math.max(0, numberValue(initialSettlement?.planTotal) - Math.max(0, numberValue(paidTotal))),
    dirty: false,
  };
  syncAction(initialState);
  onChange?.(initialState);

  return {
    read: () => currentState(),
    markSaved: () => {
      baseline = JSON.stringify(settlementInputs(root));
      return currentState();
    },
  };
}

export function initPaymentMethods(root, { onPay = () => {}, onChange = () => {} } = {}) {
  if (!root) return null;
  const total = Math.max(0, numberValue(root.dataset.paymentTotal));
  let wallets = [];
  let deposits = [];
  let personalAccount = null;
  try { wallets = JSON.parse(root.dataset.paymentWallets || '[]'); } catch { wallets = []; }
  try { deposits = JSON.parse(root.dataset.paymentDeposits || '[]'); } catch { deposits = []; }
  try { personalAccount = JSON.parse(root.dataset.paymentPersonalAccount || 'null'); } catch { personalAccount = null; }
  return initPaymentMethodsAllocation(root, { wallets, deposits, personalAccount, total, onPay, onChange });
}
