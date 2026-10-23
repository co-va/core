import {
  actionBlock,
  button,
  datePicker,
  emptyState,
  field,
  formValidationMessage,
  infoUI,
  initDatePickers,
  modal,
  mountModal,
  mountV2ZLayer,
  openNotice,
  openSharedProfileSettingsMenu,
  select,
  shortDateTime,
  shortDateTimeParts,
  v2ListEntries,
  v2ListEntry,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { readOnlyReceipt } from '../../../ui/receipt/index.js';
import { canUseBookCapability } from '../../access.js';
import { getFinanceOperation } from '../data.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { cancelFinanceOperation, correctFinanceOperation, hardDeleteFinanceOperation } from '../service.js';
import { getLedgerEntries } from '../read.js';
import { renderFinanceArticles } from './articles.js';
import { renderIncomeExpenseOperation } from './income-expense.js';
import { SPECIAL_FINANCE_ACTIONS, renderSpecialFinanceOperation } from './special-operations.js';

function formatMoney(value = 0, { signed = false } = {}) {
  const amount = Number(value) || 0;
  const absolute = Math.abs(amount).toLocaleString('ru-RU').replaceAll('\u00a0', ' ');
  if (!signed || Math.abs(amount) < 0.009) return `${absolute} ₽`;
  return `${amount < 0 ? '−' : '+'}${absolute} ₽`;
}

function operationMoment(item) {
  const raw = item?.occurredAt || item?.refundedAt || item?.paidAt || '';
  const fallback = `${item?.date || ''} ${item?.time || ''}`.trim();
  return shortDateTime(raw, fallback);
}

function recordedMoment(item) {
  const raw = item?.recordedAt || '';
  return raw ? shortDateTime(raw, '') : '';
}

function operationName(item) {
  const kind = String(item?.operationKind || '');
  const type = String(item?.economicType || '');
  let label = 'Движение';
  if (kind === 'payment') label = 'Оплата услуги';
  else if (kind === 'cancel') label = 'Отмена операции';
  else if (kind === 'refund') label = 'Возврат';
  else if (kind === 'manual-income') label = 'Доход';
  else if (kind === 'manual-expense') label = 'Расход';
  else if (kind === 'loan-received') label = 'Получен займ';
  else if (kind === 'loan-repayment') label = 'Возврат займа';
  else if (kind === 'investment-received') label = 'Получена инвестиция';
  else if (kind === 'investment-return') label = 'Возврат инвестиций';
  else if (kind === 'transfer') label = 'Перевод';
  else if (type === 'SERVICE_REVENUE') label = 'Оплата услуги';
  else if (type === 'TIPS') label = 'Чаевые';
  else if (type === 'SERVICE_REFUND') label = 'Возврат услуги';
  else if (type === 'TIPS_REFUND') label = 'Возврат чаевых';
  else if (type === 'REVERSAL') label = 'Отмена операции';
  else if (type === 'LOAN_RECEIVED') label = 'Получен займ';
  else if (type === 'LOAN_REPAYMENT') label = 'Возврат займа';
  else if (type === 'INVESTMENT_RECEIVED') label = 'Получена инвестиция';
  else if (type === 'INVESTMENT_RETURN') label = 'Возврат инвестиций';
  else if (type === 'TRANSFER') label = 'Перевод';
  else if (item?.direction === 'IN') label = 'Доход';
  else if (item?.direction === 'OUT') label = 'Расход';
  return item?.operationStatus === 'cancelled' ? `${label} · Отменена` : label;
}

function operationAmount(item) {
  const amount = Math.max(0, Number(item?.amount) || Math.abs(Number(item?.total) || 0));
  return item?.direction === 'OUT' ? -amount : amount;
}

function walletText(item) {
  return item?.walletName || item?.walletId || '';
}

function personText(item) {
  return [item?.person?.name, item?.person?.surname].filter(Boolean).join(' ').trim();
}

function operationGroupsFromLedger(movements = []) {
  const groups = new Map();
  (Array.isArray(movements) ? movements : []).forEach((item) => {
    const id = String(item?.operationId || '').trim();
    if (!id || item?.operationKind === 'cancel') return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(item);
  });
  return [...groups.values()];
}

function operationTotal(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const declared = Math.max(0, Number(rows[0]?.operationTotal) || 0);
  if (declared > 0) return declared;
  if (rows[0]?.operationKind === 'transfer') {
    return Math.max(0, ...rows.map((item) => Math.max(0, Number(item?.amount) || 0)));
  }
  return rows.reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0);
}

function operationDisplayAmount(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const total = operationTotal(rows);
  if (rows[0]?.operationKind === 'transfer') return formatMoney(total);
  const directions = new Set(rows.map((item) => String(item?.direction || '')).filter(Boolean));
  if (directions.size === 1 && directions.has('OUT')) return formatMoney(-total, { signed: true });
  if (directions.size === 1 && directions.has('IN')) return formatMoney(total, { signed: true });
  return formatMoney(total);
}

function operationListSubtitle(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const wallets = [...new Set(rows.map((item) => walletText(item)).filter(Boolean))];
  if (first?.operationKind === 'transfer') {
    const from = rows.find((item) => item?.direction === 'OUT');
    const to = rows.find((item) => item?.direction === 'IN');
    return [walletText(from), walletText(to)].filter(Boolean).join(' → ');
  }
  const articles = [...new Set(rows.map((item) => String(item?.articleName || '')).filter(Boolean))];
  return [
    articles.join(', '),
    personText(first),
    first?.workplace || '',
    wallets.join(' + '),
  ].filter(Boolean).join(' · ');
}

function operationListEntry(entries = []) {
  const first = entries[0] || {};
  const id = String(first?.operationId || '');
  return v2ListEntry({
    title: operationName(first),
    subtitle: operationListSubtitle(entries),
    rightTop: operationDisplayAmount(entries),
    rightBottom: operationMoment(first),
    interactive: Boolean(id),
    initial: '',
    data: id ? `data-finance-operation="${id}"` : '',
    aria: id ? `Открыть финансовую операцию ${operationName(first)}` : '',
  });
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function downloadDDS(movements) {
  const headers = ['Фактическая дата и время', 'Внесено в систему', 'Операция', 'Статья', 'Позиция', 'Человек', 'Рабочее место', 'Кошелёк', 'Сумма', 'Статус', 'Чаевые'];
  const rows = movements.map((item) => [
    operationMoment(item),
    recordedMoment(item),
    operationName(item).replace(' · Отменена', ''),
    item?.articleName || '',
    item?.lineName || '',
    personText(item),
    item?.workplace || '',
    walletText(item),
    operationAmount(item),
    item?.operationStatus === 'cancelled' ? 'Отменена' : 'Активна',
    item?.economicType === 'TIPS' || item?.economicType === 'TIPS_REFUND' ? Math.abs(operationAmount(item)) : 0,
  ]);
  const text = '\uFEFF' + [headers, ...rows].map((row) => row.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'ДДС.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

function paymentReceiptGroups(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const when = shortDateTimeParts(first?.occurredAt || '');
  const moment = [when.date, when.time].filter(Boolean).join(' - ');
  const settlementItems = Array.isArray(first?.settlementItems) ? first.settlementItems : [];
  const tips = rows
    .filter((item) => item?.economicType === 'TIPS')
    .reduce((sum, item) => sum + Math.max(0, Number(item?.amount) || 0), 0);

  const identity = [];
  const uei = String(first?.person?.uei || '').trim();
  const person = personText(first);
  if (uei) identity.push({ label: uei, value: '' });
  if (person) identity.push({ label: person, value: '' });
  settlementItems.forEach((item) => {
    identity.push({
      label: String(item?.name || 'Услуга'),
      value: formatMoney(Math.max(0, Number(item?.planAmount ?? item?.price) || 0)),
    });
  });
  if (tips > 0) identity.push({ label: 'Чаевые', value: formatMoney(tips) });

  const allocations = Array.isArray(first?.allocations) ? first.allocations.filter((item) => Number(item?.amount) > 0) : [];
  const payment = allocations.map((item) => ({
    label: String(item?.walletName || item?.walletId || 'Кошелёк'),
    value: allocations.length > 1 ? formatMoney(Math.max(0, Number(item?.amount) || 0)) : '',
  }));
  payment.push({
    label: 'Итого',
    value: formatMoney(operationTotal(rows)),
    strong: true,
  });

  return [
    [
      ...(first?.workplace ? [{ label: first.workplace, value: '' }] : []),
      ...(moment ? [{ label: moment, value: '' }] : []),
    ],
    identity,
    payment,
  ].filter((group) => group.length);
}

function operationReceiptItems(entries = []) {
  const rows = Array.isArray(entries) ? entries : [];
  const first = rows[0] || {};
  const items = [];

  const articles = [...new Set(rows.map((item) => String(item?.articleName || '')).filter(Boolean))];
  if (articles.length && first?.operationKind !== 'transfer') {
    items.push({ label: `Статья · ${articles.join(', ')}`, value: '' });
  }

  const person = personText(first);
  const uei = String(first?.person?.uei || '').trim();
  if (uei) items.push({ label: uei, value: '' });
  if (person) items.push({ label: person, value: '' });
  if (first?.workplace) items.push({ label: first.workplace, value: '' });

  const wallets = [...new Set(rows.map((item) => walletText(item)).filter(Boolean))];
  if (first?.operationKind === 'transfer') {
    const from = rows.find((item) => item?.direction === 'OUT');
    const to = rows.find((item) => item?.direction === 'IN');
    if (walletText(from)) items.push({ label: `Из кошелька · ${walletText(from)}`, value: '' });
    if (walletText(to)) items.push({ label: `В кошелёк · ${walletText(to)}`, value: '' });
  } else if (wallets.length === 1) {
    items.push({ label: wallets[0], value: '' });
  } else if (wallets.length > 1) {
    items.push({ label: wallets.join(' + '), value: '' });
  }

  if (first?.counterparty) items.push({ label: first.counterparty, value: '' });
  if (first?.note) items.push({ label: first.note, value: '' });

  const lines = first?.operationKind === 'transfer'
    ? []
    : rows
      .filter((item) => String(item?.lineName || '').trim())
      .map((item) => ({
        label: String(item.lineName),
        value: formatMoney(Math.max(0, Number(item?.amount) || 0)),
      }));

  items.push(...lines);
  return { items, lineCount: lines.length };
}

function openCancellationInfo(root) {
  return openNotice({
    title: 'Об отмене операции',
    message: 'Отмена сохраняет исходную операцию в истории и создаёт обратную операцию на выбранную фактическую дату.',
    surface: 'app',
  });
}

function openCancelOperation(root, operationLayer, entries) {
  const first = entries[0] || {};
  const content = `<div class="ui-list-toolbar"><div></div><div class="ui-list-toolbar__actions">${infoUI('', {
    aria: 'Что означает отмена операции',
    data: 'data-finance-cancel-info',
    actionOnly: true,
  })}</div></div>
    <div class="compact-form">
      ${datePicker({ label: 'Фактическая дата отмены', name: 'financeCancelOccurredDate', value: financeLocalDateValue(), required: true, allowClear: false })}
      ${button('Отменить', { variant: 'danger', data: 'data-finance-operation-cancel-confirm' })}
    </div>`;
  const cancelLayer = mountModal(document.body, modal(content, {
    title: 'Отменить операцию',
    variant: 'x',
    className: 'modal--form-sheet',
    surface: 'app',
  }));
  if (!cancelLayer) return;
  initDatePickers(cancelLayer);

  cancelLayer.querySelector('[data-finance-cancel-info] [data-info-trigger]')?.addEventListener('click', () => {
    openCancellationInfo(root);
  });
  cancelLayer.querySelector('[data-finance-operation-cancel-confirm]')?.addEventListener('click', async () => {
    const input = cancelLayer.querySelector('input[name="financeCancelOccurredDate"]');
    if (!input?.value) return;
    try {
      const cancelled = await cancelFinanceOperation(first.operationId, {
        reason: 'incorrect-entry',
        occurredAt: financeOccurredAtForDate(input.value, new Date()),
      });
      if (!cancelled) return;
      cancelLayer.v2Close?.();
      operationLayer.v2Close?.();
      renderDDS(root);
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось отменить операцию') });
    }
  });
}

function openDeleteOperation(root, operationLayer, entries) {
  const first = entries[0] || {};
  const content = `<div class="modal-title"><h2>Удалить операцию?</h2><p>Операция и связанные с ней финансовые записи будут удалены без возможности восстановления.</p></div>
    <div class="modal-actions">
      ${button('Отмена', { variant: 'secondary', data: 'data-finance-operation-delete-close' })}
      ${button('Удалить', { variant: 'critical', data: 'data-finance-operation-delete-confirm' })}
    </div>`;
  const confirmation = mountModal(document.body, modal(content, {
    title: 'Удалить операцию',
    variant: 'x',
    className: 'modal--form-sheet',
    surface: 'app',
  }));
  if (!confirmation) return;

  confirmation.querySelector('[data-finance-operation-delete-close]')?.addEventListener('click', () => confirmation.v2Close?.());
  confirmation.querySelector('[data-finance-operation-delete-confirm]')?.addEventListener('click', async () => {
    try {
      await hardDeleteFinanceOperation(first.operationId);
      confirmation.v2Close?.();
      operationLayer.v2Close?.();
      renderDDS(root);
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось удалить операцию') });
    }
  });
}

function correctionWalletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function reopenCorrectedOperation(root, operationLayer, correctionLayer, operationId) {
  correctionLayer?.v2Close?.();
  operationLayer?.v2Close?.();
  renderDDS(root);
  const movements = [...getLedgerEntries()].reverse();
  openFinanceOperation(root, movements, operationId);
}

function renderPaymentCorrection(root, operation, { onSaved = null } = {}) {
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const allocations = Array.isArray(data.allocations) ? data.allocations.slice(0, 2) : [];
  const wallets = correctionWalletOptions();
  const serviceAmount = Math.max(0, Number(data.serviceAmount) || 0);
  const rows = [0, 1].map((index) => {
    const allocation = allocations[index] || {};
    return `${select({
      label: `Кошелёк ${index + 1}`,
      name: `allocationWallet${index + 1}`,
      value: allocation.walletId || '',
      options: [{ value: '', label: '—' }, ...wallets],
    })}${field({
      label: `Сумма ${index + 1}`,
      name: `allocationAmount${index + 1}`,
      type: 'number',
      inputmode: 'decimal',
      value: allocation.amount || '',
      placeholder: '0',
      data: 'min="0" step="0.01"',
    })}`;
  }).join('');

  root.innerHTML = `${workspaceHeaderContext({
    title: 'Корректировка · Оплата услуги',
  })}
    <form class="compact-form" data-finance-payment-correction-form novalidate>
      <div class="payment-total"><span>Сумма услуг</span><strong>${formatMoney(serviceAmount)}</strong></div>
      ${rows}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-payment-correction-save',
      aria: 'Сохранить корректировку оплаты',
    }))}`;
  root.querySelector('[data-finance-payment-correction-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validation = formValidationMessage(formElement);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const form = new FormData(formElement);
    const walletRows = [1, 2].map((index) => {
      const walletId = String(form.get(`allocationWallet${index}`) || '');
      const amount = Math.max(0, Number(form.get(`allocationAmount${index}`) || 0));
      const wallet = getWallets().find((item) => String(item.id) === walletId);
      return { walletId, walletName: wallet?.name || '', amount };
    }).filter((item) => item.walletId && item.amount > 0);
    const allocated = walletRows.reduce((sum, item) => sum + item.amount, 0);
    if (!walletRows.length || allocated + 0.009 < serviceAmount) {
      openNotice({ message: 'Сумма по кошелькам не может быть меньше суммы услуг.' });
      return;
    }
    const occurredAt = operation?.occurredAt || '';
    try {
      await correctFinanceOperation(operation.operationId, {
        allocations: walletRows,
        serviceAmount,
        tips: Math.max(0, allocated - serviceAmount),
        occurredAt,
      });
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось скорректировать оплату') });
    }
  });
  root.querySelector('[data-finance-payment-correction-save]')?.addEventListener('click', () => {
    root.querySelector('[data-finance-payment-correction-form]')?.requestSubmit();
  });
  return true;
}

function renderRefundCorrection(root, operation, { onSaved = null } = {}) {
  const data = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const wallets = correctionWalletOptions();
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Корректировка · Возврат',
  })}
    <form class="compact-form" data-finance-refund-correction-form novalidate>
      ${field({
        label: 'Сумма',
        name: 'amount',
        type: 'number',
        inputmode: 'decimal',
        value: data.total || '',
        required: true,
        placeholder: '0',
        data: 'min="0" step="0.01"',
      })}
      ${select({
        label: 'Кошелёк',
        name: 'walletId',
        value: data.walletId || '',
        options: wallets,
      })}
      ${field({
        label: 'Причина',
        name: 'reason',
        value: data.reason || '',
        placeholder: 'Необязательно',
      })}
      ${datePicker({
        label: 'Фактическая дата',
        name: 'occurredDate',
        value: financeLocalDateValue(operation?.occurredAt || new Date()),
        required: true,
        allowClear: false,
      })}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-refund-correction-save',
      aria: 'Сохранить корректировку возврата',
    }))}`;
  initDatePickers(root);

  root.querySelector('[data-finance-refund-correction-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const validation = formValidationMessage(formElement);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const form = new FormData(formElement);
    const walletId = String(form.get('walletId') || '');
    const wallet = getWallets().find((item) => String(item.id) === walletId);
    try {
      await correctFinanceOperation(operation.operationId, {
        amount: Number(form.get('amount') || 0),
        walletId,
        walletName: wallet?.name || '',
        reason: String(form.get('reason') || '').trim(),
        occurredAt: financeOccurredAtForDate(String(form.get('occurredDate') || ''), operation?.occurredAt || new Date()),
      });
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось скорректировать возврат') });
    }
  });
  root.querySelector('[data-finance-refund-correction-save]')?.addEventListener('click', () => {
    root.querySelector('[data-finance-refund-correction-form]')?.requestSubmit();
  });
  return true;
}

function openOperationCorrection(root, operationLayer, entries) {
  const first = entries[0] || {};
  const operation = getFinanceOperation(first.operationId);
  if (!operation) {
    openNotice({ message: 'Операция не найдена.' });
    return;
  }
  const layer = mountV2ZLayer(operationLayer, v2ZLayer('', { className: 'finance-dds-correction-z' }), { stack: true });
  if (!layer) return;
  const onSaved = () => reopenCorrectedOperation(root, operationLayer, layer, operation.operationId);
  let rendered = false;
  if (operation.kind === 'manual-income') {
    rendered = renderIncomeExpenseOperation(layer, 'IN', { operation, onSaved });
  } else if (operation.kind === 'manual-expense') {
    rendered = renderIncomeExpenseOperation(layer, 'OUT', { operation, onSaved });
  } else if (SPECIAL_FINANCE_ACTIONS.some((item) => item.id === operation.kind)) {
    rendered = renderSpecialFinanceOperation(layer, operation.kind, { operation, onSaved });
  } else if (operation.kind === 'payment') {
    rendered = renderPaymentCorrection(layer, operation, { onSaved });
  } else if (operation.kind === 'refund') {
    rendered = renderRefundCorrection(layer, operation, { onSaved });
  }
  if (!rendered) {
    layer.v2Close?.();
    openNotice({ message: 'Для этой операции корректировка недоступна.' });
  }
}

function openOperationSettings(root, operationLayer, entries) {
  const first = entries[0] || {};
  const active = first?.operationStatus !== 'cancelled';
  return openSharedProfileSettingsMenu({
    title: 'Настройки операции',
    actions: [
      active ? {
        id: 'correct-operation',
        label: 'Корректировка',
        variant: 'outline',
        onSelect: () => openOperationCorrection(root, operationLayer, entries),
      } : null,
      active ? {
        id: 'cancel-operation',
        label: 'Отменить операцию',
        variant: 'danger',
        onSelect: () => openCancelOperation(root, operationLayer, entries),
      } : null,
      {
        id: 'delete-operation',
        label: 'Удалить операцию',
        variant: 'critical',
        onSelect: () => openDeleteOperation(root, operationLayer, entries),
      },
    ].filter(Boolean),
  });
}

function openFinanceOperation(root, movements, operationId) {
  const id = String(operationId || '');
  const entries = movements.filter((item) => String(item?.operationId || '') === id);
  if (!entries.length) return;
  const first = entries[0];
  const when = shortDateTimeParts(first?.occurredAt || '');
  const receiptContent = operationReceiptItems(entries);
  const isPayment = first?.operationKind === 'payment';
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-dds-receipt-z' }), { stack: true });
  if (!layer) return;

  layer.innerHTML = `${workspaceHeaderContext({
    title: operationName(first),
    v: {
      kind: 'settings',
      data: 'data-finance-operation-settings',
      aria: 'Настройки операции',
    },
  })}${readOnlyReceipt(isPayment ? {
    title: 'Оплата услуги',
    groups: paymentReceiptGroups(entries),
  } : {
    title: operationName(first).replace(' · Отменена', ''),
    date: when.date || '—',
    time: when.time || '—',
    items: receiptContent.items,
    totals: [{
      label: 'Итого',
      value: formatMoney(operationTotal(entries)),
      strong: true,
    }],
  })}`;

  layer.querySelector('[data-finance-operation-settings]')?.addEventListener('click', () => {
    openOperationSettings(root, layer, entries);
  });
}

function movementDay(item) {
  const raw = String(item?.occurredAt || item?.refundedAt || item?.paidAt || item?.date || '').trim();
  if (!raw) return '';
  return raw.slice(0, 10);
}

function exportKind(item) {
  const type = String(item?.economicType || '');
  if (type === 'TRANSFER') return 'transfer';
  if (type === 'LOAN_RECEIVED' || type === 'LOAN_REPAYMENT') return 'loan';
  if (type === 'INVESTMENT_RECEIVED' || type === 'INVESTMENT_RETURN') return 'investment';
  return item?.direction === 'OUT' ? 'expense' : 'income';
}

function filterExportMovements(movements, form) {
  const data = new FormData(form);
  const from = String(data.get('from') || '');
  const to = String(data.get('to') || '');
  const kind = String(data.get('kind') || '');
  const walletId = String(data.get('walletId') || '');
  const status = String(data.get('status') || '');
  return movements.filter((item) => {
    const day = movementDay(item);
    if (from && (!day || day < from)) return false;
    if (to && (!day || day > to)) return false;
    if (kind && exportKind(item) !== kind) return false;
    if (walletId && String(item?.walletId || '') !== walletId) return false;
    if (status === 'active' && item?.operationStatus === 'cancelled') return false;
    if (status === 'cancelled' && item?.operationStatus !== 'cancelled') return false;
    return true;
  });
}

function openDDSExport(root, movements) {
  const wallets = [...new Map(movements
    .filter((item) => item?.walletId)
    .map((item) => [String(item.walletId), { value: String(item.walletId), label: walletText(item) || String(item.walletId) }])).values()];
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-dds-export-z' }), { stack: true });
  if (!layer) return;
  layer.innerHTML = `${workspaceHeaderContext({
    title: 'Выгрузка ДДС',
  })}
    <form class="compact-form" data-finance-dds-export-form novalidate>
      ${datePicker({ label: 'С', name: 'from' })}
      ${datePicker({ label: 'До', name: 'to' })}
      ${select({
        label: 'Операции',
        name: 'kind',
        value: '',
        options: [
          { value: '', label: 'Все операции' },
          { value: 'income', label: 'Доходы' },
          { value: 'expense', label: 'Расходы' },
          { value: 'loan', label: 'Займы' },
          { value: 'investment', label: 'Инвестиции' },
          { value: 'transfer', label: 'Переводы' },
        ],
      })}
      ${select({
        label: 'Кошелёк',
        name: 'walletId',
        value: '',
        options: [{ value: '', label: 'Все кошельки' }, ...wallets],
      })}
      ${select({
        label: 'Статус',
        name: 'status',
        value: '',
        options: [
          { value: '', label: 'Все' },
          { value: 'active', label: 'Активные' },
          { value: 'cancelled', label: 'Отменённые' },
        ],
      })}
    </form>
    ${actionBlock(button('Выгрузить', {
      data: 'data-finance-dds-export-submit',
      aria: 'Выгрузить ДДС',
    }))}`;
  initDatePickers(layer);
  layer.querySelector('[data-finance-dds-export-submit]')?.addEventListener('click', () => {
    const form = layer.querySelector('[data-finance-dds-export-form]');
    if (!form) return;
    downloadDDS(filterExportMovements(movements, form));
    layer.v2Close?.();
  });
}

function openArticles(root) {
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-dds-articles-z' }), { stack: true });
  if (!layer) return;
  renderFinanceArticles(layer);
}

function availableDDSSettings() {
  const items = [{ id: 'excel', label: 'Эксель' }];
  if (canUseBookCapability('finance.articles.access')) items.push({ id: 'articles', label: 'Статьи' });
  return items;
}

function openDDSSettings(root, movements) {
  const items = availableDDSSettings();
  if (!items.length) return;
  const content = actionBlock(items.map((item) => button(item.label, {
    variant: 'secondary',
    data: `data-finance-dds-tool="${item.id}"`,
  })).join(''));
  const settings = mountModal(root, modal(content, {
    title: 'Настройки ДДС',
    variant: 'x',
    surface: 'app',
  }));
  if (!settings) return;
  settings.querySelectorAll('[data-finance-dds-tool]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = String(element.dataset.financeDdsTool || '');
      settings.v2Close?.();
      if (id === 'excel') openDDSExport(root, movements);
      else if (id === 'articles') openArticles(root);
    });
  });
}

function renderDDS(root) {
  const movements = [...getLedgerEntries()].reverse();
  const groupedOperations = operationGroupsFromLedger(movements);
  const operations = groupedOperations.length
    ? v2ListEntries(groupedOperations.map(operationListEntry))
    : emptyState('Все операции', 'Финансовых операций пока нет.');
  const settingsItems = availableDDSSettings();
  const headerContext = workspaceHeaderContext({
    title: 'Движения денежных средств',
    v: settingsItems.length ? {
      kind: 'settings',
      data: 'data-finance-dds-settings',
      aria: 'Настройки ДДС',
    } : null,
  });

  root.innerHTML = `${headerContext}${operations}`;
  root.querySelector('[data-finance-dds-settings]')?.addEventListener('click', () => openDDSSettings(root, movements));
  root.querySelectorAll('[data-finance-operation]').forEach((element) => {
    element.addEventListener('click', () => openFinanceOperation(root, movements, element.dataset.financeOperation));
  });
}

export { renderDDS };
