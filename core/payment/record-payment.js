import {
  actionBlock,
  button,
  datePicker,
  field,
  initDatePickers,
  initPaymentMethods,
  modal,
  mountModal,
  openNotice,
  paymentMethods,
  select,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import {
  correctFinanceOperation,
  getRecordPaymentState,
  getRefundsForPayment,
  getWallets,
  hardDeleteFinanceOperation,
  recordPaymentIncome,
  recordRefundExpense,
  resolveRecordSettlement,
  saveSettlementSnapshot,
} from '../finance/index.js';
import { listPersonDeposits } from '../loyalty/deposit/data.js';
import { selectedRecordDepositId } from '../loyalty/record-program.js';
import { loadPersonalAccount } from '../loyalty/personal-account/data.js';
import { getWorkplaces } from '../workplace-time.js';
import { normalizeWorkplaceTimeZone, zonedDateTimeParts, zonedDateTimeToDate } from '../time/index.js';
import { getAllPeople } from '../people/data.js';
import { personDisplay } from '../people/presentation.js';
import { completeRecord, getRecord, refreshRecordsFromServer } from '../record/index.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getProfile } from '../profile/data.js';
import { readOnlyReceipt } from '../../ui/receipt/index.js';

const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;
const paymentInFlightRecords = new Set();

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

async function persistRecordCompletion(record) {
  const current = getRecord(record?.id) || record;
  const completed = completeRecord(current?.id);
  if (!completed) return null;
  await flushBusinessPersistence();
  await refreshRecordsFromServer();
  return getRecord(current.id) || completed;
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

function recordServiceOccurredAt(record) {
  const date = String(record?.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rawTime = String(record?.to || record?.from || '').slice(0, 5);
  const time = /^\d{2}:\d{2}$/.test(rawTime) ? rawTime : '12:00';
  return zonedDateTimeToDate(`${date}T${time}`, paymentWorkplaceTimeZone(record));
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
  className = '',
  hostData = 'data-record-payment-q-host',
} = {}) {
  const layer = mountModal(document.body, modal(
    `${blankPaymentContext(record, title)}<div class="record-screen record-screen--state-view" ${hostData}></div>`,
    { variant: 'q', surface: 'app', title, className },
  ));
  if (!layer) return null;
  bindPaymentChat(layer, record);
  return layer;
}

async function depositsForRecord(record, payment = null) {
  const selectedDepositId = selectedRecordDepositId(record);
  const current = paymentDepositAllocations(payment);
  const currentIds = new Set(current.map((item) => String(item?.depositId || '')).filter(Boolean));
  if (!selectedDepositId && !currentIds.size) return [];

  const person = personForRecord(record);
  const key = String(person?.key || person?.id || '');
  if (!key) return [];
  const deposits = await listPersonDeposits(key).catch(() => []);
  const allowedIds = new Set([...currentIds, ...(selectedDepositId ? [selectedDepositId] : [])]);
  const scoped = deposits.filter((item) => allowedIds.has(String(item?.depositId || item?.id || '')));
  if (!current.length) return scoped;
  const used = new Map(current.map((item) => [String(item.depositId || ''), Number(item.amount || 0)]));
  return scoped.map((item) => ({
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

async function openPaymentEntry(record, onCompleted = () => {}) {
  const current = getRecord(record?.id) || record;
  if (!current?.id) return null;
  const settlement = settlementForRecord(current);
  const state = paymentStateForRecord(current);
  const recordId = String(current.id);
  if (state.fullyPaid || paymentInFlightRecords.has(recordId)) return null;

  const total = Math.max(0, Number(settlement?.planTotal || 0) - Number(state?.paidTotal || 0));
  const gratuityOnly = total <= 0.009 && Number(settlement?.serviceTotal || 0) > 0.009;
  const [deposits, personalAccount] = gratuityOnly
    ? [[], null]
    : await Promise.all([
      depositsForRecord(current),
      personalAccountForRecord(current, settlement, total),
    ]);

  const layer = mountModal(document.body, modal(
    `<div class="compact-form record-payment-entry-x" data-record-payment-entry-host>
      ${readOnlyReceipt({ totals: [{ label: 'К оплате', value: money(total), strong: true }] })}
      ${paymentMethods({ wallets: getWallets(), deposits, personalAccount, total, showAction: false, showTotal: false })}
      ${actionBlock(button(gratuityOnly ? 'Завершить' : 'Оплатить', { data: 'data-record-payment-entry-submit', disabled: !gratuityOnly }))}
    </div>`,
    { variant: 'x', surface: 'app', title: 'Оплата', className: 'modal--form-sheet' },
  ));
  if (!layer) return null;

  const host = layer.querySelector('[data-record-payment-entry-host]');
  const submit = host?.querySelector('[data-record-payment-entry-submit]');
  let allocationState = null;

  const syncPrimary = () => {
    if (!submit) return;
    const hasMoney = Number(allocationState?.received || 0) > 0.009;
    const label = gratuityOnly && !hasMoney ? 'Завершить' : 'Оплатить';
    submit.textContent = label;
    submit.setAttribute('aria-label', label);
    submit.disabled = hasMoney ? !allocationState?.valid : !gratuityOnly;
  };

  submit?.addEventListener('click', async () => {
    const hasMoney = Number(allocationState?.received || 0) > 0.009;
    if (hasMoney && !allocationState?.valid) return;
    if (!hasMoney && !gratuityOnly) return;
    const latest = getRecord(recordId) || current;
    const latestState = paymentStateForRecord(latest);
    if (latestState.fullyPaid || paymentInFlightRecords.has(recordId)) {
      layer.v2Close?.();
      onCompleted?.();
      return;
    }

    submit.disabled = true;
    let completed = null;
    paymentInFlightRecords.add(recordId);
    try {
      if (!hasMoney) {
        const saved = await saveSettlementSnapshot({ source: { type: 'record', id: latest.id }, settlement });
        if (!saved) throw new Error('Не удалось сохранить расчёт');
        completed = await persistRecordCompletion(latest);
        if (!completed) throw new Error('Не удалось завершить запись');
      } else {
        const occurredAt = recordServiceOccurredAt(latest);
        if (!occurredAt) throw new Error('У записи отсутствует дата факта обслуживания.');
        // Finance occurredAt belongs to the service day. Server recordedAt/createdAt keeps the actual entry moment.
        completed = await recordPaymentIncome({
          source: { type: 'record', id: latest.id },
          workplace: workplaceName(latest.workplaceId),
          person: recordPerson(latest),
          settlement,
          allocations: allocationState.allocations,
          depositAllocations: allocationState.depositAllocations,
          personalAccountAmount: allocationState.personalAccountAmount,
          finalizeDebt: allocationState.remaining > 0.009,
          maxAmount: Math.max(0, Number(settlement?.planTotal || 0) - Number(latestState?.paidTotal || 0)),
          serviceAmount: allocationState.applied,
          tips: allocationState.tips,
          occurredAt,
        });
      }
    } catch (error) {
      openNotice({ message: String(error?.message || (hasMoney ? 'Не удалось провести оплату' : 'Не удалось завершить запись')) });
    } finally {
      paymentInFlightRecords.delete(recordId);
    }

    if (!completed) {
      if (submit.isConnected) syncPrimary();
      return;
    }
    layer.v2Close?.();
    onCompleted?.(completed);
  });

  initPaymentMethods(host?.querySelector('[data-payment-methods]'), {
    onChange: (next) => { allocationState = next; syncPrimary(); },
  });
  syncPrimary();
  return layer;
}

async function openPaymentCorrection(record, payment, onSaved) {
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
    button('Удаление оплаты', { variant: 'critical', data: 'data-record-payment-delete' }),
  ].join(''), { className: 'record-payment-actions' });
}

function bindPaymentBodyActions(host, record, state, onSaved) {
  const payment = state?.latestPayment || null;
  if (!payment) return;
  host.querySelector('[data-record-payment-correct]')?.addEventListener('click', () => openPaymentCorrection(record, payment, onSaved));
  host.querySelector('[data-record-payment-refund]')?.addEventListener('click', () => openPaymentRefund(record, payment, onSaved));
  host.querySelector('[data-record-payment-delete]')?.addEventListener('click', () => openPaymentDeletion(payment, onSaved));
}

export function openRecordPayment(record, { onCompleted = () => {} } = {}) {
  if (!record?.id) return null;
  return openPaymentEntry(record, onCompleted);
}

export function openRecordPaymentActions(record, { onSaved = () => {} } = {}) {
  if (!record?.id) return null;
  const current = getRecord(record.id) || record;
  const state = paymentStateForRecord(current);
  if (!state?.latestPayment) return null;
  const layer = mountModal(document.body, modal(
    paymentActionsBody(state),
    { variant: 'x', surface: 'app' },
  ));
  if (!layer) return null;
  bindPaymentBodyActions(layer, current, state, onSaved);
  [
    '[data-record-payment-correct]',
    '[data-record-payment-refund]',
    '[data-record-payment-delete]',
  ].forEach((selector) => layer.querySelector(selector)?.addEventListener('click', () => layer.v2Close?.()));
  return layer;
}