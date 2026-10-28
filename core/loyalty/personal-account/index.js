import {
  button,
  datePicker,
  details,
  emptyState,
  entityCardStack,
  escapeHtml,
  field,
  formValidationMessage,
  initDatePickers,
  miniCard,
  miniCardRail,
  modal,
  mountModal,
  page,
  select,
  shortDateTime,
  v2ListEntries,
  v2ListEntry,
  v2Section,
} from '../../../ui/ui.js';
import { getWallets } from '../../finance/index.js';
import {
  availablePeople,
  bindViewSettings,
  formObject,
  loyaltyCardFields,
  loyaltyHeader,
  loyaltyVisualCard,
  money,
  notifyLoyaltyContext,
  openLoyaltySettingsMenu,
  personLabel,
} from '../shared.js';
import {
  fundPersonalAccount,
  loadPersonalAccount,
  loadPersonalAccounts,
  settlePersonalAccountDebt,
  updatePersonalAccountSettings,
  withdrawPersonalAccount,
} from './data.js';

function personKey(person = {}) {
  return String(person?.key || person?.id || '').trim();
}

function accountPerson(account = {}, people = []) {
  const keys = new Set([
    String(account?.personKey || ''),
    ...(Array.isArray(account?.memberKeys) ? account.memberKeys.map((value) => String(value || '')) : []),
  ].filter(Boolean));
  return people.find((person) => keys.has(personKey(person))) || { key: String(account?.personKey || ''), name: 'Без имени' };
}

function movementTitle(item = {}) {
  const kind = String(item?.kind || '');
  if (kind === 'funding') return 'Пополнение';
  if (kind === 'withdrawal') return 'Возврат денег';
  if (kind === 'payment') return 'Оплата';
  if (kind === 'refund') return 'Возврат оплаты';
  return String(item?.direction || '').toUpperCase() === 'IN' ? 'Пополнение' : 'Списание';
}

function movementSource(item = {}) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  if (data?.note) return String(data.note);
  if (data?.reason) return String(data.reason);
  if (item?.sourceType === 'record') return 'Запись';
  if (item?.sourceType === 'sale') return 'Продажа';
  if (item?.sourceType === 'order') return 'Заказ';
  return 'Операция';
}

function walletOptions() {
  return [
    { value: '', label: 'Выберите кошелёк' },
    ...getWallets().map((wallet) => ({ value: String(wallet?.id || ''), label: String(wallet?.name || '') })),
  ];
}

function selectedWallet(walletId = '') {
  return getWallets().find((wallet) => String(wallet?.id || '') === String(walletId || '')) || null;
}

export function personalAccountCardFields({ person = null, title = '', balance = 0, debt = 0 } = {}) {
  const resolvedBalance = Math.max(0, Number(balance) || 0);
  const resolvedDebt = Math.max(0, Number(debt) || 0);
  return loyaltyCardFields({
    title: title || personLabel(person || {}),
    subtitle: 'Личный счёт',
    status: resolvedDebt > 0.009 ? 'Есть задолженность' : resolvedBalance > 0.009 ? 'Есть остаток' : 'Нулевой остаток',
    metaLeft: resolvedDebt > 0.009 ? 'Задолженность' : 'Денежный остаток',
    metaRight: money(resolvedDebt > 0.009 ? resolvedDebt : resolvedBalance),
  });
}

export function personalAccountVisualCard({
  person = null,
  title = '',
  balance = 0,
  debt = 0,
  data = '',
  aria = '',
  interactive = true,
} = {}) {
  return loyaltyVisualCard('personal-account', personalAccountCardFields({ person, title, balance, debt }), {
    data,
    aria,
    interactive,
  });
}

function movementHistory(account = {}) {
  return Array.isArray(account?.movements) ? account.movements : [];
}

function historyRail(account = {}) {
  const items = movementHistory(account);
  if (!items.length) return emptyState('Истории пока нет', 'Движения появятся после использования Личного счёта.');
  return miniCardRail(items.map((item, index) => {
    const incoming = String(item?.direction || '').toUpperCase() === 'IN';
    return miniCard({
      title: movementTitle(item),
      value: `${incoming ? '+' : '−'}${money(item?.amount)}`,
      subtitle: shortDateTime(item?.occurredAt, '—'),
      rows: [
        { label: 'Источник', value: movementSource(item) },
        { label: 'Остаток', value: money(item?.balanceAfter) },
      ],
      interactive: true,
      data: `data-personal-account-history-entry="${index}"`,
      aria: `Открыть ${movementTitle(item).toLowerCase()}`,
    });
  }));
}

function settlementRows(item = {}) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const settlement = data?.settlement && typeof data.settlement === 'object' ? data.settlement : null;
  const items = Array.isArray(settlement?.items) ? settlement.items : [];
  return items.map((entry) => ({
    label: String(entry?.name || (String(entry?.sourceType || '') === 'product' ? 'Товар' : 'Процедура')),
    value: money(entry?.planAmount ?? entry?.correctedPrice ?? entry?.price),
  }));
}

function movementEventMarkup(item = {}) {
  const incoming = String(item?.direction || '').toUpperCase() === 'IN';
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const rows = [{ label: 'Дата', value: shortDateTime(item?.occurredAt, '—') }];
  const settlement = settlementRows(item);
  if (String(item?.kind || '') === 'payment' && settlement.length) {
    rows.push(...settlement);
    rows.push({ label: 'Итого', value: `−${money(item?.amount)}` });
  } else {
    rows.push({ label: 'Сумма', value: `${incoming ? '+' : '−'}${money(item?.amount)}` });
    const wallet = String(item?.walletName || data?.walletName || '').trim();
    if (wallet) rows.push({ label: 'Кошелёк', value: wallet });
    const source = movementSource(item);
    if (source && source !== 'Операция') rows.push({ label: 'Источник', value: source });
  }
  rows.push({ label: 'Остаток', value: money(item?.balanceAfter) });
  rows.push({ label: 'Дата формирования', value: shortDateTime(item?.recordedAt || item?.createdAt || item?.occurredAt, '—') });
  return details(rows);
}

function openMovementEventS(root, item = {}) {
  return mountModal(root, modal(movementEventMarkup(item), {
    variant: 's',
    surface: 'app',
    title: movementTitle(item),
  }));
}

function debtList(account = {}) {
  const items = Array.isArray(account?.debts) ? account.debts : [];
  if (!items.length) return emptyState('Задолженностей нет', 'Неоплаченные остатки появятся здесь отдельно от денег Личного счёта.');
  return v2ListEntries(items.map((item) => {
    const outstanding = Math.max(0, Number(item?.outstandingAmount || 0));
    return v2ListEntry({
      title: outstanding > 0.009 ? 'Задолженность' : 'Погашено',
      subtitle: shortDateTime(item?.occurredAt, '—'),
      rightTop: money(outstanding),
      rightBottom: outstanding > 0.009 ? 'Открыта' : 'Закрыта',
      interactive: outstanding > 0.009,
      data: outstanding > 0.009 ? `data-personal-account-debt="${escapeHtml(String(item?.id || ''))}"` : '',
      aria: outstanding > 0.009 ? 'Погасить задолженность' : 'Погашенная задолженность',
    });
  }));
}

function accountInfo(person = {}, account = {}) {
  return details([
    { label: 'Контакт', value: personLabel(person) },
    { label: 'Денежный остаток', value: money(account?.balance) },
    { label: 'Задолженность', value: money(account?.debtTotal) },
    { label: 'Можно оплатить со счёта', value: `${Math.max(0, Math.min(100, Number(account?.spendLimitPercent ?? 100) || 0))}%` },
    { label: 'Виден конечному пользователю', value: account?.visibleToEndUser === false ? 'Нет' : 'Да' },
  ]);
}

function openSettingsX(root, person, account, onSaved) {
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-settings-form>
    ${field({ label: 'Лимит оплаты, %', name: 'spendLimitPercent', type: 'number', min: '0', max: '100', step: '1', inputmode: 'decimal', value: account?.spendLimitPercent ?? 100, required: true })}
    ${button('Сохранить', { type: 'submit' })}
    <div class="form-error" data-personal-account-settings-error></div>
  </form>`, { title: 'Настройки Личного счёта', variant: 'x', surface: 'app' }));
  const form = layer?.querySelector?.('[data-personal-account-settings-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-settings-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    try {
      const saved = await updatePersonalAccountSettings(personKey(person), {
        spendLimitPercent: Number(values.spendLimitPercent),
        visibleToEndUser: account?.visibleToEndUser !== false,
      });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось сохранить настройки';
    }
  });
  return layer;
}

function openMoneyX(root, person, account, mode, onSaved) {
  const funding = mode === 'fund';
  const title = funding ? 'Пополнить Личный счёт' : 'Вернуть деньги';
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-money-form>
    ${field({ label: 'Сумма', name: 'amount', type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', value: '', required: true })}
    ${select({ label: funding ? 'Кошелёк приёма денег' : 'Кошелёк возврата', name: 'walletId', value: '', options: walletOptions() })}
    ${datePicker({ label: 'Дата операции', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${field({ label: funding ? 'Комментарий' : 'Причина', name: funding ? 'note' : 'reason', value: '' })}
    ${button(funding ? 'Пополнить' : 'Вернуть', { type: 'submit' })}
    <div class="form-error" data-personal-account-money-error></div>
  </form>`, { title, variant: 'x', surface: 'app' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-personal-account-money-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-money-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const wallet = selectedWallet(values.walletId);
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!wallet || amount <= 0) {
      if (errorNode) errorNode.textContent = 'Укажите сумму и кошелёк';
      return;
    }
    if (!funding && amount > Number(account?.balance || 0) + 0.009) {
      if (errorNode) errorNode.textContent = 'Сумма возврата превышает остаток Личного счёта';
      return;
    }
    try {
      const saved = funding
        ? await fundPersonalAccount(personKey(person), { amount, walletId: wallet.id, walletName: wallet.name, note: values.note, occurredAt: values.occurredAt })
        : await withdrawPersonalAccount(personKey(person), { amount, walletId: wallet.id, walletName: wallet.name, reason: values.reason, occurredAt: values.occurredAt });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось выполнить операцию';
    }
  });
  return layer;
}

function openDebtSettleX(root, debt, onSaved) {
  const outstanding = Math.max(0, Number(debt?.outstandingAmount || 0));
  const layer = mountModal(root, modal(`<form class="form-grid" data-personal-account-debt-form>
    ${field({ label: 'Задолженность', name: 'debtAmount', value: money(outstanding), disabled: true })}
    ${field({ label: 'Сумма оплаты', name: 'amount', type: 'number', min: '0.01', max: String(outstanding), step: '0.01', inputmode: 'decimal', value: outstanding, required: true })}
    ${select({ label: 'Кошелёк', name: 'walletId', value: '', options: walletOptions() })}
    ${datePicker({ label: 'Дата оплаты', name: 'occurredAt', value: new Date().toISOString().slice(0, 10), showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: false })}
    ${button('Погасить', { type: 'submit' })}
    <div class="form-error" data-personal-account-debt-error></div>
  </form>`, { title: 'Погасить задолженность', variant: 'x', surface: 'app' }));
  if (!layer) return null;
  initDatePickers(layer);
  const form = layer.querySelector('[data-personal-account-debt-form]');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorNode = layer.querySelector('[data-personal-account-debt-error]');
    const validationError = formValidationMessage(form);
    if (validationError) {
      if (errorNode) errorNode.textContent = validationError;
      return;
    }
    const values = formObject(form);
    const wallet = selectedWallet(values.walletId);
    const amount = Math.max(0, Number(String(values.amount || '0').replace(',', '.')) || 0);
    if (!wallet || amount <= 0 || amount > outstanding + 0.009) {
      if (errorNode) errorNode.textContent = 'Укажите корректную сумму и кошелёк';
      return;
    }
    try {
      const saved = await settlePersonalAccountDebt(debt?.id, {
        amount,
        walletId: wallet.id,
        walletName: wallet.name,
        occurredAt: values.occurredAt,
      });
      layer.v2Close?.();
      await onSaved?.(saved);
    } catch (error) {
      if (errorNode) errorNode.textContent = error instanceof Error ? error.message : 'Не удалось погасить задолженность';
    }
  });
  return layer;
}

function renderDetail(layer, root, person, account) {
  const host = layer.querySelector('[data-personal-account-q-host]') || layer;
  host.innerHTML = page([
    loyaltyHeader(personLabel(person), { settings: true, settingsData: 'data-personal-account-actions' }),
    accountInfo(person, account || {}),
    v2Section('Задолженности', debtList(account || {})),
    v2Section('История', historyRail(account || {})),
  ]);
  const refresh = async (saved = null) => {
    const next = saved?.personKey ? saved : await loadPersonalAccount(personKey(person));
    renderDetail(layer, root, person, next || {});
  };
  host.querySelector('[data-personal-account-actions]')?.addEventListener('click', () => {
    const actions = [
      { id: 'fund', label: 'Пополнить', onSelect: () => openMoneyX(root, person, account, 'fund', refresh) },
      { id: 'withdraw', label: 'Вернуть деньги', onSelect: () => openMoneyX(root, person, account, 'withdraw', refresh) },
      { id: 'settings', label: 'Настройки', onSelect: () => openSettingsX(root, person, account, refresh) },
    ];
    openLoyaltySettingsMenu({
      title: 'Личный счёт',
      checked: account?.visibleToEndUser !== false,
      onToggle: async (value) => {
        const saved = await updatePersonalAccountSettings(personKey(person), {
          spendLimitPercent: account?.spendLimitPercent ?? 100,
          visibleToEndUser: value,
        });
        await refresh(saved);
        return saved?.visibleToEndUser !== false;
      },
      actions,
    });
  });
  host.querySelectorAll('[data-personal-account-debt]').forEach((node) => {
    node.addEventListener('click', () => {
      const debt = (Array.isArray(account?.debts) ? account.debts : []).find((item) => String(item?.id || '') === String(node.dataset.personalAccountDebt || ''));
      if (debt) openDebtSettleX(root, debt, refresh);
    });
  });
  const movements = movementHistory(account);
  host.querySelectorAll('[data-personal-account-history-entry]').forEach((node) => {
    node.addEventListener('click', () => {
      const item = movements[Number(node.dataset.personalAccountHistoryEntry)];
      if (item) openMovementEventS(layer, item);
    });
  });
  notifyLoyaltyContext();
}

export async function openPersonalAccountForPerson(root, person = {}, snapshot = null) {
  const layer = mountModal(root, modal('<div data-personal-account-q-host></div>', {
    variant: 'q',
    surface: 'app',
    title: personLabel(person),
    className: 'loyalty-personal-account-q',
  }));
  if (!layer) return null;
  const account = snapshot || await loadPersonalAccount(personKey(person));
  renderDetail(layer, root, person, account || {});
  return layer;
}

export async function renderPersonalAccount(root) {
  const people = availablePeople([]);
  let accounts = [];
  try {
    accounts = await loadPersonalAccounts();
  } catch (error) {
    root.innerHTML = page([
      loyaltyHeader('Личный счёт', { settings: true }),
      emptyState('Не удалось загрузить Личные счета', String(error?.message || 'Повторите попытку.')),
    ]);
    notifyLoyaltyContext();
    return;
  }

  const values = accounts
    .filter((account) => Number(account?.balance || 0) > 0.009 || Number(account?.debtTotal || 0) > 0.009)
    .map((account) => ({ account, person: accountPerson(account, people) }));
  const cards = values.length
    ? entityCardStack(values.map(({ account, person }) => personalAccountVisualCard({
        person,
        balance: account.balance,
        debt: account.debtTotal,
        data: `data-personal-account-person="${personKey(person)}"`,
        aria: `Открыть Личный счёт ${personLabel(person)}`,
      })))
    : emptyState('Активных Личных счетов пока нет', 'Здесь появятся контакты с денежным остатком или задолженностью.');

  root.innerHTML = page([
    loyaltyHeader('Личный счёт', { settings: true }),
    cards,
  ]);

  bindViewSettings(root, 'Личный счёт', {
    type: 'personal-account',
    fields: () => {
      const first = values[0];
      return personalAccountCardFields({
        person: first?.person || people[0] || {},
        balance: first?.account?.balance || 0,
        debt: first?.account?.debtTotal || 0,
      });
    },
    onSaved: () => renderPersonalAccount(root),
  });
  root.querySelectorAll('[data-personal-account-person]').forEach((node) => {
    node.addEventListener('click', () => {
      const item = values.find(({ person }) => personKey(person) === String(node.dataset.personalAccountPerson || ''));
      if (item) openPersonalAccountForPerson(root, item.person, item.account);
    });
  });
  notifyLoyaltyContext();
}
