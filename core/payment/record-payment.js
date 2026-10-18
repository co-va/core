import {
  actionBlock,
  button,
  datePicker,
  field,
  initDatePickers,
  initPaymentForm,
  initPaymentMethods,
  modal,
  mountModal,
  openNotice,
  paymentForm,
  paymentMethods,
  select,
  shortDate,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import {
  calculateSettlement,
  cancelPaymentOperation,
  correctFinanceOperation,
  getRecordPaymentState,
  getRefundsForPayment,
  getWallets,
  hardDeleteFinanceOperation,
  recordPaymentIncome,
  recordRefundExpense,
  refreshFinanceState,
  resolveRecordSettlement,
  saveSettlementSnapshot,
} from '../finance/index.js';
import { listPersonDeposits } from '../loyalty/deposit/data.js';
import { loadPersonalAccount } from '../loyalty/personal-account/data.js';
import { getWorkplaces } from '../workplace-time.js';
import { normalizeWorkplaceTimeZone, zonedDateTimeParts, zonedDateTimeToDate } from '../time/index.js';
import { getAllPeople } from '../people/data.js';
import { personDisplay } from '../people/presentation.js';
import { getRecord } from '../record/index.js';
import { getProfile } from '../profile/data.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;

function personForRecord(record) {
  const source = record?.person || {};
  const people = getAllPeople();
  return people.find((item) => String(item?.key ?? '') === String(source?.key ?? ''))
    || people.find((item) => String(item?.id ?? '') === String(source?.id ?? ''))
    || source;
}

function settlementForRecord(record) {
  return resolveRecordSettlement(record);
}

function paymentStateForRecord(record) {
  return getRecordPaymentState(record);
}

async function saveSettlementCorrection(record, settlement) {
  const current = getRecord(record?.id) || record;
  const state = paymentStateForRecord(current);
  if (Number(settlement?.planTotal || 0) + 0.009 < Number(state?.paidTotal || 0)) {
    openNotice({ message: 'Расчёт нельзя уменьшить ниже уже оплаченной суммы. Сначала выполните возврат или отмените ошибочную оплату.' });
    return null;
  }
  try {
    const saved = await saveSettlementSnapshot({ source: { type: 'record', id: current.id }, settlement });
    return saved ? current : null;
  } catch (error) {
    await refreshFinanceState().catch(() => null);
    openNotice({ message: String(error?.message || 'Не удалось сохранить расчёт') });
    return null;
  }
}

function workplaceForId(id) {
  return getWorkplaces().find((item) => String(item?.key ?? item?.id ?? '') === String(id || '')) || null;
}

function workplaceName(id) {
  const workplace = workplaceForId(id);
  return workplace?.name || workplace?.title || 'Рабочее пространство';
}

function paymentWorkplaceTimeZone(paymentOrRecord = null) {
  const sourceRecordId = String(paymentOrRecord?.source?.type || '') === 'record'
    ? String(paymentOrRecord?.source?.id || '')
    : String(paymentOrRecord?.id || '');
  const record = sourceRecordId ? (getRecord(sourceRecordId) || paymentOrRecord) : paymentOrRecord;
  const workplace = workplaceForId(record?.workplaceId);
  return normalizeWorkplaceTimeZone(workplace?.timeZone || '');
}

function occurredAtForDate(dateValue, paymentOrRecord = null, reference = new Date()) {
  const source = reference instanceof Date ? reference : new Date(reference);
  const safe = Number.isFinite(source.getTime()) ? source : new Date();
  if (!dateValue) return safe;
  const parts = zonedDateTimeParts(safe, paymentWorkplaceTimeZone(paymentOrRecord));
  const time = /^\d{2}:\d{2}$/.test(parts.time || '') ? parts.time : '12:00';
  return zonedDateTimeToDate(`${dateValue}T${time}`, paymentWorkplaceTimeZone(paymentOrRecord));
}

function paymentDateValue(paymentOrRecord = null, reference = null) {
  const value = reference || paymentOrRecord?.occurredAt || paymentOrRecord?.paidAt || '';
  if (!value) return '';
  return zonedDateTimeParts(value, paymentWorkplaceTimeZone(paymentOrRecord)).date || '';
}

function recordPaymentOccurredAt(record, dateValue = '') {
  const date = String(dateValue || record?.date || '').slice(0, 10);
  const time = String(record?.to || record?.from || '').slice(0, 5);
  if (date && /^\d{2}:\d{2}$/.test(time)) {
    return zonedDateTimeToDate(`${date}T${time}`, paymentWorkplaceTimeZone(record));
  }
  return occurredAtForDate(dateValue, record);
}

function recordPerson(record) {
  const current = personForRecord(record);
  const display = personDisplay(current);
  return {
    key: String(current?.key || current?.id || ''),
    uei: display.uei || '',
    name: display.name || '',
  };
}

function paymentMoment(record) {
  const date = String(record?.date || '').slice(0, 10);
  return {
    date: date ? shortDate(new Date(`${date}T12:00:00`)) : '',
    time: `${String(record?.from || '')} - ${String(record?.to || '')}`,
  };
}

function paymentFromRecord(record) {
  const moment = paymentMoment(record);
  return {
    source: { type: 'record', id: record?.id || '' },
    workplace: workplaceName(record?.workplaceId),
    person: recordPerson(record),
    date: moment.date,
    time: moment.time,
    settlement: settlementForRecord(record),
  };
}

function paymentAllocations(payment) {
  if (Array.isArray(payment?.allocations) && payment.allocations.length) return payment.allocations.map((item) => ({ ...item }));
  if (payment?.walletId) return [{ walletId: payment.walletId, walletName: payment.walletName || '', amount: Number(payment.total || 0) }];
  return [];
}

function paymentDepositAllocations(payment) {
  return Array.isArray(payment?.depositAllocations) ? payment.depositAllocations.map((item) => ({ ...item })) : [];
}

function paymentOwnerA() {
  const profile = getProfile();
  const initials = [profile?.name, profile?.surname]
    .filter(Boolean)
    .map((value) => String(value).trim().charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return {
    kind: 'avatar',
    label: 'Оплата',
    image: String(profile?.photo || ''),
    imagePosition: `${Number(profile?.photoCropX ?? 50)}% ${Number(profile?.photoCropY ?? 50)}%`,
    initials,
    disabled: true,
    aria: 'Оплата',
  };
}

function recordChatKeys(record) {
  return [...new Set((Array.isArray(record?.group?.participants) ? record.group.participants : [])
    .map((person) => String(person?.key || person?.id || '').trim())
    .filter(Boolean))];
}

function paymentChatContext(record) {
  const groupPersonKeys = recordChatKeys(record);
  return {
    d: { kind: 'chat', data: 'data-record-payment-chat', aria: groupPersonKeys.length > 1 ? 'Чат группы' : 'Чат' },
    hideD: false,
  };
}

function paymentLayerContext(record) {
  return workspaceHeaderContext({ title: 'Оплата', a: paymentOwnerA(), ...paymentChatContext(record) });
}

function blankPaymentContext(record, title = 'Оплата') {
  return workspaceHeaderContext({ title, a: paymentOwnerA(), ...paymentChatContext(record) });
}

function bindPaymentChat(layer, record) {
  layer.querySelector('[data-record-payment-chat]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('book:record-chat-request', {
      detail: { personKey: String(record?.person?.key || ''), personKeys: recordChatKeys(record) },
    }));
  });
}

function mountPaymentQ(record, {
  title = 'Оплата',
  modalTitle = title,
  context = '',
  className = '',
  hostData = 'data-record-payment-q-host',
} = {}) {
  const layer = mountModal(document.body, modal(
    `${context || blankPaymentContext(record, title)}<div class="record-screen record-screen--state-view" ${hostData}></div>`,
    { variant: 'q', surface: 'app', title: modalTitle, className },
  ));
  if (!layer) return null;
  bindPaymentChat(layer, record);
  return layer;
}

function paymentItems(settlement) {
  return (Array.isArray(settlement?.items) ? settlement.items : []).map((item) => ({
    sourceType: item.sourceType || 'procedure',
    id: item.sourceId,
    name: item.name,
    cost: item.price,
    correctedPrice: item.correctedPrice,
    correctionMode: item.correctionMode,
    correctionPercent: item.correctionPercent,
    correctionMoney: item.correctionMoney,
    pricePercent: item.pricePercent,
    pricePercentMoney: item.pricePercentMoney,
  }));
}

async function depositsForRecord(record, payment = null) {
  const person = personForRecord(record);
  const key = String(person?.key || person?.id || '');
  if (!key) return [];
  const deposits = await listPersonDeposits(key).catch(() => []);
  const current = paymentDepositAllocations(payment);
  if (!current.length) return deposits;
  const used = new Map(current.map((item) => [String(item.depositId || ''), Number(item.amount || 0)]));
  return deposits.map((item) => ({
    ...item,
    balance: Number(item.balance || 0) + Number(used.get(String(item.depositId || '')) || 0),
  }));
}

async function personalAccountForRecord(record, settlement, due) {
  const person = personForRecord(record);
  const key = String(person?.key || person?.id || '').trim();
  if (!key) return null;
  const account = await loadPersonalAccount(key).catch(() => null);
  if (!account) return null;
  const balance = Math.max(0, Number(account?.balance || 0));
  const spendLimitPercent = Math.max(0, Math.min(100, Number(account?.spendLimitPercent ?? 100) || 0));
  const alreadyUsed = (Array.isArray(account?.movements) ? account.movements : [])
    .filter((item) => String(item?.kind || '') === 'payment'
      && String(item?.direction || '').toUpperCase() === 'OUT'
      && String(item?.sourceType || '') === 'record'
      && String(item?.sourceId || '') === String(record?.id || ''))
    .reduce((sum, item) => sum + Math.max(0, Number(item?.amount || 0)), 0);
  const limit = Math.max(0, Number(settlement?.planTotal || 0)) * spendLimitPercent / 100;
  const availableAmount = Math.min(balance, Math.max(0, limit - alreadyUsed), Math.max(0, Number(due || 0)));
  return { ...account, personKey: key, balance, spendLimitPercent, availableAmount };
}

async function openPaymentAllocationLayer(parentLayer, record, settlement, onCompleted) {
  const current = getRecord(record?.id) || record;
  const state = paymentStateForRecord(current);
  const total = Math.max(0, Number(settlement?.planTotal || 0) - Number(state?.paidTotal || 0));
  const [deposits, personalAccount] = await Promise.all([
    depositsForRecord(current),
    personalAccountForRecord(current, settlement, total),
  ]);
  const layer = mountPaymentQ(current, {
    title: 'Оплата',
    modalTitle: 'Проведение оплаты',
    className: 'record-payment-allocation-q',
    hostData: 'data-record-payment-allocation-host',
  });
  if (!layer) return null;
  const host = layer.querySelector('[data-record-payment-allocation-host]');
  host.innerHTML = `
    ${readOnlyReceipt({ totals: [{ label: 'К оплате', value: money(total), strong: true }] })}
    <div class="form-grid">
      ${datePicker({ label: 'Дата оплаты', name: 'recordPaymentDate', value: '', showYear: false, modalVariant: 'bottom', modalClassName: 'modal--form-sheet', modalSurface: 'app', allowClear: true })}
      ${paymentMethods({ wallets: getWallets(), deposits, personalAccount, total, showAction: false, showTotal: false })}
    </div>
    <div class="modal-actions" data-record-payment-allocation-primary></div>`;
  initDatePickers(host);

  let allocationState = null;
  const primaryHost = host.querySelector('[data-record-payment-allocation-primary]');
  const syncPrimary = () => {
    if (!primaryHost) return;
    primaryHost.innerHTML = allocationState?.valid
      ? button('Оплатить', { data: 'data-record-payment-allocation-submit' })
      : '';
    primaryHost.querySelector('[data-record-payment-allocation-submit]')?.addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      submit.disabled = true;
      const dateValue = String(host.querySelector('input[name="recordPaymentDate"]')?.value || '');
      let completed = null;
      try {
        completed = await recordPaymentIncome({
          source: { type: 'record', id: current.id },
          workplace: workplaceName(current.workplaceId),
          person: recordPerson(current),
          settlement,
          allocations: allocationState.allocations,
          depositAllocations: allocationState.depositAllocations,
          personalAccountAmount: allocationState.personalAccountAmount,
          finalizeDebt: allocationState.remaining > 0.009,
          maxAmount: total,
          serviceAmount: allocationState.applied,
          tips: allocationState.tips,
          occurredAt: recordPaymentOccurredAt(current, dateValue),
        });
      } catch (error) {
        openNotice({ message: String(error?.message || 'Не удалось провести оплату') });
      }
      if (!completed) {
        if (submit.isConnected) submit.disabled = false;
        return;
      }
      layer.v2Close?.();
      onCompleted?.(completed);
    });
  };

  initPaymentMethods(host.querySelector('[data-payment-methods]'), {
    onChange: (next) => { allocationState = next; syncPrimary(); },
  });
  syncPrimary();
  return layer;
}

async function openPaymentCorrection(parentLayer, record, payment, onSaved) {
  if (!payment?.id) return null;
  const serviceAmount = Math.max(0, Number(payment?.serviceAmount || 0));
  const initialAllocations = paymentAllocations(payment);
  const initialDepositAllocations = paymentDepositAllocations(payment);
  const deposits = await depositsForRecord(record, payment);
  const layer = mountPaymentQ(record, {
    title: 'Корректировка оплаты',
    className: 'record-payment-correction-q',
    hostData: 'data-record-payment-correction-host',
  });
  if (!layer) return null;
  const host = layer.querySelector('[data-record-payment-correction-host]');
  host.innerHTML = `
    ${readOnlyReceipt({ totals: [{ label: 'Оплата', value: money(payment.total), strong: true }] })}
    <div class="form-grid">
      ${datePicker({ label: 'Дата оплаты', name: 'recordPaymentCorrectionDate', value: paymentDateValue(payment), showYear: false, modalVariant: 'bottom', modalClassName: 'modal--form-sheet', modalSurface: 'app', allowClear: false })}
      ${paymentMethods({ wallets: getWallets(), deposits, total: serviceAmount, showAction: false, showTotal: false, initialAllocations, initialDepositAllocations })}
    </div>
    <div class="modal-actions" data-record-payment-correction-primary></div>`;
  initDatePickers(host);

  let allocationState = null;
  const primaryHost = host.querySelector('[data-record-payment-correction-primary]');
  const syncPrimary = () => {
    if (!primaryHost) return;
    primaryHost.innerHTML = allocationState?.valid
      ? button('Сохранить', { variant: 'secondary', data: 'data-record-payment-correction-submit' })
      : '';
    primaryHost.querySelector('[data-record-payment-correction-submit]')?.addEventListener('click', async (event) => {
      const submit = event.currentTarget;
      submit.disabled = true;
      const dateValue = String(host.querySelector('input[name="recordPaymentCorrectionDate"]')?.value || '');
      try {
        await correctFinanceOperation(payment.id, {
          allocations: allocationState.allocations,
          depositAllocations: allocationState.depositAllocations,
          serviceAmount: allocationState.applied,
          tips: allocationState.tips,
          occurredAt: occurredAtForDate(dateValue, record, payment.occurredAt || payment.paidAt || new Date()),
        });
        layer.v2Close?.();
        onSaved?.();
      } catch (error) {
        openNotice({ message: String(error?.message || 'Не удалось скорректировать оплату') });
        if (submit.isConnected) submit.disabled = false;
      }
    });
  };

  initPaymentMethods(host.querySelector('[data-payment-methods]'), {
    onChange: (next) => { allocationState = next; syncPrimary(); },
  });
  syncPrimary();
  return layer;
}

function openPaymentRefund(record, payment, onSaved) {
  if (!payment?.id) return null;
  const refunds = getRefundsForPayment(payment.id);
  const refunded = refunds.reduce((sum, item) => sum + Number(item?.total || 0), 0);
  const remaining = Math.max(0, Number(payment?.total || 0) - refunded);
  if (remaining <= 0.009) {
    openNotice({ title: 'Возврат', message: 'Эта оплата уже возвращена полностью.' });
    return null;
  }
  const wallets = getWallets();
  const allocations = paymentAllocations(payment);
  const defaultWalletId = allocations.length === 1 ? String(allocations[0]?.walletId || '') : '';
  const layer = mountModal(document.body, modal(
    `<div class="compact-form">
      ${field({ label: 'Сумма возврата', name: 'recordPaymentRefundAmount', type: 'number', value: remaining, min: 0, max: remaining, step: '0.01', inputmode: 'decimal' })}
      ${select({ label: 'Кошелёк', name: 'recordPaymentRefundWallet', value: defaultWalletId, options: [{ value: '', label: 'Выберите кошелёк' }, ...wallets.map((wallet) => ({ value: wallet.id, label: wallet.name }))], aria: 'Кошелёк возврата' })}
      ${datePicker({ label: 'Дата возврата', name: 'recordPaymentRefundDate', value: paymentDateValue(record, new Date()), showYear: false, modalVariant: 'bottom', modalClassName: 'modal--form-sheet', modalSurface: 'app', allowClear: false })}
      ${button('Вернуть', { variant: 'danger', data: 'data-record-payment-refund-confirm' })}
    </div>`,
    { variant: 'x', surface: 'app', title: 'Возврат', className: 'modal--form-sheet' },
  ));
  if (!layer) return null;
  initDatePickers(layer);
  const amountInput = layer.querySelector('input[name="recordPaymentRefundAmount"]');
  const walletInput = layer.querySelector('input[name="recordPaymentRefundWallet"]');
  const submit = layer.querySelector('[data-record-payment-refund-confirm]');
  const hasCash = paymentAllocations(payment).reduce((sum, item) => sum + Number(item.amount || 0), 0) > 0.009;
  const sync = () => {
    const amount = Math.max(0, Math.min(remaining, Number(String(amountInput?.value || '0').replace(',', '.')) || 0));
    if (submit) submit.disabled = amount <= 0 || (hasCash && !walletInput?.value);
  };
  amountInput?.addEventListener('input', sync);
  walletInput?.addEventListener('change', sync);
  submit?.addEventListener('click', async () => {
    const amount = Math.max(0, Math.min(remaining, Number(String(amountInput?.value || '0').replace(',', '.')) || 0));
    const wallet = wallets.find((item) => String(item?.id || '') === String(walletInput?.value || ''));
    const dateValue = String(layer.querySelector('input[name="recordPaymentRefundDate"]')?.value || '');
    if (!amount || !dateValue || (hasCash && !wallet)) return;
    try {
      const refund = await recordRefundExpense(payment.id, {
        amount,
        walletId: wallet?.id || '',
        walletName: wallet?.name || '',
        occurredAt: occurredAtForDate(dateValue, record),
      });
      if (!refund) return;
      layer.v2Close?.();
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось выполнить возврат') });
    }
  });
  sync();
  return layer;
}

function openPaymentCancellation(record, payment, onSaved) {
  if (!payment?.id) return null;
  const layer = mountModal(document.body, modal(
    `<div class="compact-form">
      ${datePicker({ label: 'Дата отмены', name: 'recordPaymentCancelDate', value: paymentDateValue(record, new Date()), showYear: false, modalVariant: 'bottom', modalClassName: 'modal--form-sheet', modalSurface: 'app', allowClear: false })}
      ${button('Отменить оплату', { variant: 'danger', data: 'data-record-payment-cancel-confirm' })}
    </div>`,
    { variant: 'x', surface: 'app', title: 'Отмена оплаты', className: 'modal--form-sheet' },
  ));
  if (!layer) return null;
  initDatePickers(layer);
  layer.querySelector('[data-record-payment-cancel-confirm]')?.addEventListener('click', async () => {
    const dateValue = String(layer.querySelector('input[name="recordPaymentCancelDate"]')?.value || '');
    try {
      await cancelPaymentOperation(payment.id, { reason: 'incorrect-entry', occurredAt: occurredAtForDate(dateValue, record) });
      layer.v2Close?.();
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось отменить оплату') });
    }
  });
  return layer;
}

function openPaymentDeletion(payment, onSaved) {
  if (!payment?.id) return null;
  const layer = mountModal(document.body, modal(
    `<div class="modal-title"><h2>Удалить оплату полностью?</h2><p>Данные этой оплаты будут удалены из финансовой истории без восстановления.</p></div>
    <div class="modal-actions">${button('Удалить оплату', { variant: 'critical', data: 'data-record-payment-delete-confirm' })}</div>`,
    { variant: 'x', surface: 'app', title: 'Удаление оплаты', className: 'modal--form-sheet' },
  ));
  layer?.querySelector('[data-record-payment-delete-confirm]')?.addEventListener('click', async () => {
    try {
      await hardDeleteFinanceOperation(payment.id);
      layer.v2Close?.();
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось удалить оплату') });
    }
  });
  return layer;
}

function paymentActionsBody(state) {
  if (!state?.latestPayment) return '';
  return actionBlock([
    button('Корректировка оплаты', { variant: 'secondary', data: 'data-record-payment-correct' }),
    button('Возврат', { variant: 'danger', data: 'data-record-payment-refund' }),
    button('Отмена оплаты', { variant: 'danger', data: 'data-record-payment-cancel' }),
    button('Удаление оплаты', { variant: 'critical', data: 'data-record-payment-delete' }),
  ].join(''), { className: 'record-payment-actions' });
}

function bindPaymentBodyActions(host, layer, record, state, rerender) {
  const payment = state?.latestPayment || null;
  if (!payment) return;
  host.querySelector('[data-record-payment-correct]')?.addEventListener('click', () => openPaymentCorrection(layer, record, payment, rerender));
  host.querySelector('[data-record-payment-refund]')?.addEventListener('click', () => openPaymentRefund(record, payment, rerender));
  host.querySelector('[data-record-payment-cancel]')?.addEventListener('click', () => openPaymentCancellation(record, payment, rerender));
  host.querySelector('[data-record-payment-delete]')?.addEventListener('click', () => openPaymentDeletion(payment, rerender));
}

function renderPaymentLayer(layer, recordId) {
  const current = getRecord(recordId);
  if (!current) { layer.v2Close?.(); return; }
  const state = paymentStateForRecord(current);
  const payment = paymentFromRecord(current);
  const settlement = payment.settlement;
  const host = layer.querySelector('[data-record-payment-q-host]');
  if (!host) { layer.v2Close?.(); return; }
  host.innerHTML = `${paymentForm({
    workplace: payment.workplace,
    date: payment.date,
    time: payment.time,
    person: payment.person || {},
    procedures: paymentItems(settlement),
    total: state.remaining,
    showActions: false,
  })}<div class="modal-actions" data-record-payment-primary></div>${paymentActionsBody(state)}`;
  const rerender = () => {
    if (layer.isConnected) renderPaymentLayer(layer, current.id);
  };
  bindPaymentBodyActions(host, layer, current, state, rerender);
  let formState = { settlement, total: state.remaining, dirty: false };
  const primaryHost = host.querySelector('[data-record-payment-primary]');
  const renderPrimary = ({ label = '', variant = '', onClick = null } = {}) => {
    if (!primaryHost) return;
    primaryHost.innerHTML = label ? button(label, { variant, data: 'data-record-payment-primary-action' }) : '';
    const primary = primaryHost.querySelector('[data-record-payment-primary-action]');
    primary?.addEventListener('click', async () => {
      primary.disabled = true;
      try {
        await onClick?.();
      } finally {
        if (primary.isConnected) primary.disabled = false;
      }
    });
  };
  const syncPrimary = () => {
    if (formState.dirty) {
      renderPrimary({
        label: 'Сохранить',
        variant: 'secondary',
        onClick: async () => {
          const updated = await saveSettlementCorrection(current, formState.settlement);
          if (updated && layer.isConnected) renderPaymentLayer(layer, current.id);
        },
      });
      return;
    }
    if (state.hasPayments || state.remaining <= 0.009 || state.fullyPaid) {
      renderPrimary();
      return;
    }
    renderPrimary({
      label: 'Оплатить',
      onClick: () => openPaymentAllocationLayer(layer, current, formState.settlement, () => {
        if (layer.isConnected) renderPaymentLayer(layer, current.id);
      }),
    });
  };
  initPaymentForm(host.querySelector('[data-payment-ui]'), {
    calculate: (items) => calculateSettlement(items),
    paidTotal: state.paidTotal,
    onChange: (next) => { formState = next; syncPrimary(); },
  });
  syncPrimary();
}

export function openRecordPayment(record) {
  if (!record?.id) return null;
  const current = getRecord(record.id) || record;
  const layer = mountPaymentQ(current, {
    title: 'Оплата',
    context: paymentLayerContext(current),
    className: 'record-payment-q',
    hostData: 'data-record-payment-q-host',
  });
  if (!layer) return null;
  renderPaymentLayer(layer, current.id);
  return layer;
}
