import {
  actionBlock,
  button,
  datePicker,
  field,
  formValidationMessage,
  initDatePickers,
  openNotice,
  searchableSelect,
  select,
  textareaField,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { getFinanceArticles } from '../data.js';
import { getWallets } from '../cash/data.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { getLedgerEntries } from '../read.js';
import { correctFinanceOperation, recordManualFinanceOperation } from '../service.js';

function articleOptions(direction) {
  return getFinanceArticles()
    .filter((item) => item.direction === direction && item.economicType !== 'GROUP')
    .map((item) => ({ value: item.articleId, label: item.name }));
}

function walletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function manualLineOptions(direction) {
  const kind = direction === 'IN' ? 'manual-income' : 'manual-expense';
  return [...new Set(getLedgerEntries()
    .filter((item) => item?.operationKind === kind)
    .map((item) => String(item?.lineName || '').trim())
    .filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ru'))
    .map((value) => ({ value, label: value }));
}

function detailRow(values = {}, direction = 'IN') {
  return `<div class="array-row" data-finance-manual-line>
    ${searchableSelect({
      label: 'Позиция',
      name: 'lineName',
      value: values.name ?? values.lineName ?? '',
      options: manualLineOptions(direction),
      placeholder: 'Введите или выберите',
    })}
    ${field({
      label: 'Количество',
      name: 'lineQuantity',
      type: 'number',
      inputmode: 'decimal',
      value: values.quantity ?? 1,
      data: 'min="0" step="0.01"',
    })}
    ${field({
      label: 'Цена',
      name: 'linePrice',
      type: 'number',
      inputmode: 'decimal',
      value: values.unitPrice ?? '',
      placeholder: '0',
      data: 'min="0" step="0.01"',
    })}
    <button type="button" class="remove-button" data-finance-manual-line-remove aria-label="Удалить строку">×</button>
  </div>`;
}

function modeMarkup(mode, { amount = '', lines = [], direction = 'IN' } = {}) {
  if (mode === 'detail') {
    const rows = (Array.isArray(lines) && lines.length ? lines : [{}])
      .map((item) => detailRow(item, direction))
      .join('');
    return `<div class="array-group" data-finance-manual-detail>
      <span class="array-label">Позиции</span>
      <div data-finance-manual-lines>${rows}</div>
      ${button('+ Добавить позицию', { type: 'button', variant: 'secondary', data: 'data-finance-manual-line-add' })}
    </div>`;
  }
  return field({
    label: 'Сумма',
    name: 'amount',
    type: 'number',
    inputmode: 'decimal',
    value: amount,
    required: true,
    placeholder: '0',
    data: 'min="0" step="0.01"',
  });
}

function syncMode(root, direction) {
  const mode = String(root.querySelector('input[name="entryMode"]')?.value || 'simple');
  const host = root.querySelector('[data-finance-manual-mode]');
  if (!host) return;
  host.innerHTML = modeMarkup(mode, { direction });
}

function collectLines(root) {
  return [...root.querySelectorAll('[data-finance-manual-line]')].map((row) => ({
    name: String(row.querySelector('[name="lineName"]')?.value || '').trim(),
    quantity: Number(row.querySelector('[name="lineQuantity"]')?.value || 0),
    unitPrice: Number(row.querySelector('[name="linePrice"]')?.value || 0),
  })).filter((row) => row.name && row.quantity > 0 && row.unitPrice > 0);
}

async function saveManual(root, direction, onSaved, operation = null) {
  const form = root.querySelector('[data-finance-manual-form]');
  if (!form) return;
  const validation = formValidationMessage(form);
  if (validation) {
    openNotice({ message: validation });
    return;
  }
  const data = new FormData(form);
  const mode = String(data.get('entryMode') || 'simple');
  const walletId = String(data.get('walletId') || '');
  const wallet = getWallets().find((item) => item.id === walletId);
  const occurredAt = financeOccurredAtForDate(
    String(data.get('occurredDate') || ''),
    operation?.occurredAt || new Date(),
  );
  const payload = {
    direction,
    articleId: String(data.get('articleId') || ''),
    walletId,
    walletName: wallet?.name || '',
    amount: mode === 'simple' ? Number(data.get('amount') || 0) : null,
    lines: mode === 'detail' ? collectLines(root) : [],
    note: String(data.get('note') || '').trim(),
    occurredAt,
  };
  if (!payload.occurredAt) {
    openNotice({ message: 'Укажите фактическую дату операции.' });
    return;
  }
  if (mode === 'detail' && !payload.lines.length) {
    openNotice({ message: 'Добавьте хотя бы одну позицию с названием, количеством и ценой.' });
    return;
  }
  try {
    if (operation?.operationId) await correctFinanceOperation(operation.operationId, payload);
    else await recordManualFinanceOperation(payload);
    onSaved?.();
  } catch (error) {
    openNotice({ message: String(error?.message || 'Не удалось сохранить операцию') });
  }
}

export function renderIncomeExpenseOperation(root, direction, { onSaved = null, operation = null } = {}) {
  const isIncome = direction === 'IN';
  const articles = articleOptions(direction);
  const wallets = walletOptions();
  if (!articles.length) {
    openNotice({ message: 'Сначала добавьте конечную статью для этого типа операции.' });
    return false;
  }
  if (!wallets.length) {
    openNotice({ message: 'Сначала добавьте кошелёк.' });
    return false;
  }

  const existing = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const lines = Array.isArray(existing.lines) ? existing.lines : [];
  const detailed = lines.length > 1 || Boolean(String(lines[0]?.lineName || '').trim());
  const mode = detailed ? 'detail' : 'simple';
  const articleId = String(existing.articleId || lines[0]?.articleId || articles[0]?.value || '');
  const walletId = String(existing.walletId || wallets[0]?.value || '');
  const simpleAmount = Number(existing.total || lines[0]?.total || lines[0]?.unitPrice || 0) || '';

  root.innerHTML = `${workspaceHeaderContext({
    title: operation ? `Корректировка · ${isIncome ? 'Доход' : 'Расход'}` : (isIncome ? 'Доход' : 'Расход'),
  })}
    <form class="compact-form" data-finance-manual-form novalidate>
      ${select({ label: 'Статья', name: 'articleId', value: articleId, options: articles, searchable: true })}
      ${select({ label: 'Кошелёк', name: 'walletId', value: walletId, options: wallets })}
      ${select({ label: 'Ввод', name: 'entryMode', value: mode, options: [{ value: 'simple', label: 'Сумма' }, { value: 'detail', label: 'Детально' }] })}
      ${datePicker({ label: 'Фактическая дата', name: 'occurredDate', value: financeLocalDateValue(operation?.occurredAt || new Date()), required: true, allowClear: false })}
      <div data-finance-manual-mode>${modeMarkup(mode, { amount: simpleAmount, lines, direction })}</div>
      ${textareaField({ label: 'Примечание', name: 'note', value: existing.note || '', rows: 3, placeholder: 'Необязательно' })}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-manual-save',
      aria: isIncome ? 'Сохранить доход' : 'Сохранить расход',
    }))}`;

  initDatePickers(root);

  root.addEventListener('change', (event) => {
    if (event.target?.matches?.('input[name="entryMode"]')) syncMode(root, direction);
  });
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-finance-manual-line-add]')) {
      root.querySelector('[data-finance-manual-lines]')?.insertAdjacentHTML('beforeend', detailRow({}, direction));
      return;
    }
    const remove = event.target.closest?.('[data-finance-manual-line-remove]');
    if (remove) {
      const rows = root.querySelectorAll('[data-finance-manual-line]');
      if (rows.length > 1) remove.closest('[data-finance-manual-line]')?.remove();
    }
  });
  root.querySelector('[data-finance-manual-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    void saveManual(root, direction, onSaved, operation);
  });
  root.querySelector('[data-finance-manual-save]')?.addEventListener('click', () => {
    root.querySelector('[data-finance-manual-form]')?.requestSubmit();
  });
  return true;
}
