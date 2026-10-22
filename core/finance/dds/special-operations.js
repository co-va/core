import {
  actionBlock,
  button,
  datePicker,
  field,
  formValidationMessage,
  initDatePickers,
  openNotice,
  select,
  textareaField,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { getWallets } from '../cash/data.js';
import { getInvestmentEntities, getLoanEntities } from '../cash/entities.js';
import { financeLocalDateValue, financeOccurredAtForDate } from '../date.js';
import { correctFinanceOperation, recordSpecialFinanceOperation } from '../service.js';

export const SPECIAL_FINANCE_ACTIONS = [
  { id: 'loan-received', kind: 'loan-received', group: 'loan', entityType: 'loan', entityLabel: 'Займ', walletLabel: 'Кошелёк получения', label: 'Получение займа', title: 'Получение займа' },
  { id: 'loan-repayment', kind: 'loan-repayment', group: 'loan', entityType: 'loan', entityLabel: 'Займ', walletLabel: 'Кошелёк списания', label: 'Возврат займа', title: 'Возврат займа' },
  { id: 'investment-received', kind: 'investment-received', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк получения', label: 'Получение инвестиции', title: 'Получение инвестиции', roles: ['raise'] },
  { id: 'investment-return', kind: 'investment-return', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк списания', label: 'Возврат капитала', title: 'Возврат капитала', roles: ['raise'] },
  { id: 'investment-income-payment', kind: 'investment-income-payment', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк списания', label: 'Выплата дохода', title: 'Выплата дохода инвестору', roles: ['raise'] },
  { id: 'investment-contribution', kind: 'investment-contribution', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк списания', label: 'Вложение', title: 'Вложение', roles: ['self', 'external'] },
  { id: 'investment-capital-return', kind: 'investment-capital-return', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк получения', label: 'Возврат капитала', title: 'Возврат капитала', roles: ['self', 'external'] },
  { id: 'investment-income', kind: 'investment-income', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк получения', label: 'Доход', title: 'Доход инвестиции', roles: ['self', 'external'] },
  { id: 'investment-expense', kind: 'investment-expense', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', walletLabel: 'Кошелёк списания', label: 'Расход', title: 'Расход инвестиции', roles: ['self', 'external'] },
  { id: 'investment-saving', kind: 'investment-saving', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', label: 'Экономия', title: 'Экономия', roles: ['self'], nonCash: true, eventType: 'saving' },
  { id: 'investment-project-profit', kind: 'investment-project-profit', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', label: 'Прибыль проекта', title: 'Прибыль проекта', roles: ['raise', 'external'], models: ['profit-share'], nonCash: true, eventType: 'project-profit' },
  { id: 'investment-project-revenue', kind: 'investment-project-revenue', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', label: 'Выручка проекта', title: 'Выручка проекта', roles: ['raise', 'external'], models: ['revenue-share'], nonCash: true, eventType: 'project-revenue' },
  { id: 'investment-reinvestment', kind: 'investment-reinvestment', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', label: 'Реинвестирование', title: 'Реинвестирование', roles: ['self', 'external', 'raise'], nonCash: true, eventType: 'reinvestment' },
  { id: 'investment-valuation', kind: 'investment-valuation', group: 'investment', entityType: 'investment', entityLabel: 'Инвестиция', label: 'Изменение оценки', title: 'Изменение оценки', roles: ['self', 'external', 'raise'], nonCash: true, eventType: 'valuation' },
  { id: 'transfer', kind: 'transfer', group: 'transfer', label: 'Перевод между кошельками', title: 'Перевод между кошельками', transfer: true },
];

function walletOptions() {
  return getWallets().map((item) => ({ value: item.id, label: item.name }));
}

function walletName(id) {
  return getWallets().find((item) => item.id === id)?.name || '';
}

function financeEntities(type) {
  return type === 'loan' ? getLoanEntities() : getInvestmentEntities();
}

function financeEntityOptions(type) {
  return financeEntities(type).map((item) => ({ value: item.id, label: item.name }));
}

function financeEntityName(type, id) {
  return financeEntities(type).find((item) => String(item.id) === String(id))?.name || '';
}

function actionById(actionId) {
  return SPECIAL_FINANCE_ACTIONS.find((item) => item.id === actionId) || null;
}

function draftFromForm(form) {
  const data = new FormData(form);
  return {
    financeEntityId: String(data.get('financeEntityId') || ''),
    walletId: String(data.get('walletId') || ''),
    fromWalletId: String(data.get('fromWalletId') || ''),
    toWalletId: String(data.get('toWalletId') || ''),
    total: String(data.get('amount') || ''),
    occurredDate: String(data.get('occurredDate') || ''),
    note: String(data.get('note') || ''),
  };
}

function renderOperationForm(root, action, {
  onSaved = null,
  operation = null,
  financeEntity = null,
  actionChoices = [],
  draft = null,
  onActionChange = null,
  onInvestmentEventSaved = null,
} = {}) {
  if (!action) return false;
  const wallets = walletOptions();
  if (!action.nonCash && !wallets.length) {
    openNotice({ message: 'Сначала добавьте кошелёк.' });
    return false;
  }

  const operationData = operation?.data && typeof operation.data === 'object' ? operation.data : {};
  const existing = draft && typeof draft === 'object' ? { ...operationData, ...draft } : operationData;
  const lockedEntity = !action.transfer && financeEntity
    && String(financeEntity?.type || '') === String(action.entityType || '')
    && String(financeEntity?.id || '').trim()
    ? {
        type: String(financeEntity.type),
        id: String(financeEntity.id),
        name: String(financeEntity.name || ''),
      }
    : null;
  const entityOptions = action.transfer || lockedEntity || action.nonCash ? [] : financeEntityOptions(action.entityType);
  if (!action.transfer && !action.nonCash && !lockedEntity && !entityOptions.length) {
    openNotice({ message: action.entityType === 'loan' ? 'Сначала добавьте займ.' : 'Сначала добавьте инвестицию.' });
    return false;
  }

  const actionSelect = actionChoices.length > 1
    ? select({
        label: 'Операция',
        name: 'financeEntityAction',
        value: action.id,
        options: actionChoices.map((item) => ({ value: item.id, label: item.label })),
      })
    : '';

  const walletFields = action.nonCash
    ? ''
    : action.transfer
      ? `${select({ label: 'Из кошелька', name: 'fromWalletId', value: existing.fromWalletId || wallets[0]?.value || '', options: wallets })}${select({ label: 'В кошелёк', name: 'toWalletId', value: existing.toWalletId || wallets[1]?.value || wallets[0]?.value || '', options: wallets })}`
      : `${lockedEntity ? '' : select({
          label: action.entityLabel,
          name: 'financeEntityId',
          value: existing.financeEntityId || entityOptions[0]?.value || '',
          options: entityOptions,
        })}${select({
          label: action.walletLabel,
          name: 'walletId',
          value: existing.walletId || wallets[0]?.value || '',
          options: wallets,
        })}`;

  const occurredDate = String(existing.occurredDate || '').trim()
    || financeLocalDateValue(operation?.occurredAt || new Date());

  root.innerHTML = `${workspaceHeaderContext({
    title: operation ? `Корректировка · ${action.title}` : (actionChoices.length > 1 ? 'Финансовая операция' : action.title),
  })}
    <form class="compact-form" data-finance-special-form novalidate>
      ${actionSelect}
      ${walletFields}
      ${field({ label: 'Сумма', name: 'amount', type: 'number', inputmode: 'decimal', value: existing.total || '', required: true, placeholder: '0', data: 'min="0" step="0.01"' })}
      ${datePicker({ label: 'Фактическая дата', name: 'occurredDate', value: occurredDate, required: true, allowClear: false })}
      ${textareaField({ label: 'Примечание', name: 'note', value: existing.note || '', rows: 3, placeholder: 'Необязательно' })}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-special-save',
      aria: `Сохранить операцию ${action.title}`,
    }))}`;

  initDatePickers(root);

  const form = root.querySelector('[data-finance-special-form]');
  form?.querySelector('input[name="financeEntityAction"]')?.addEventListener('change', (event) => {
    onActionChange?.(String(event.currentTarget.value || ''), draftFromForm(form));
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const data = new FormData(form);
    const payload = {
      kind: action.kind,
      amount: Number(data.get('amount') || 0),
      note: String(data.get('note') || '').trim(),
      occurredAt: financeOccurredAtForDate(
        String(data.get('occurredDate') || ''),
        operation?.occurredAt || new Date(),
      ),
    };

    if (!payload.occurredAt) {
      openNotice({ message: 'Укажите фактическую дату операции.' });
      return;
    }

    if (action.transfer) {
      payload.fromWalletId = String(data.get('fromWalletId') || '');
      payload.fromWalletName = walletName(payload.fromWalletId);
      payload.toWalletId = String(data.get('toWalletId') || '');
      payload.toWalletName = walletName(payload.toWalletId);
    } else {
      payload.financeEntityType = action.entityType;
      payload.financeEntityId = lockedEntity?.id || String(data.get('financeEntityId') || '');
      payload.financeEntityName = lockedEntity?.name || financeEntityName(action.entityType, payload.financeEntityId);
      payload.walletId = String(data.get('walletId') || '');
      payload.walletName = walletName(payload.walletId);
    }

    try {
      if (action.nonCash) {
        if (!lockedEntity || typeof onInvestmentEventSaved !== 'function') {
          throw new Error('Событие инвестиции недоступно');
        }
        await onInvestmentEventSaved({
          type: action.eventType,
          amount: payload.amount,
          occurredDate: String(data.get('occurredDate') || ''),
          note: payload.note,
        });
      } else if (operation?.operationId) {
        await correctFinanceOperation(operation.operationId, payload);
      } else {
        await recordSpecialFinanceOperation(payload);
      }
      onSaved?.();
    } catch (error) {
      openNotice({ message: String(error?.message || 'Не удалось сохранить операцию') });
    }
  });

  root.querySelector('[data-finance-special-save]')?.addEventListener('click', () => {
    form?.requestSubmit();
  });
  return true;
}

export function renderSpecialFinanceOperation(root, actionId, options = {}) {
  return renderOperationForm(root, actionById(actionId), options);
}

export function financeEntityOperationChoices(type, financeEntity = null) {
  const role = String(financeEntity?.role || '');
  const participationModel = String(financeEntity?.participationModel || '');
  return SPECIAL_FINANCE_ACTIONS.filter((item) => {
    if (item.entityType !== type) return false;
    if (type !== 'investment') return true;
    if (Array.isArray(item.roles) && !item.roles.includes(role || 'raise')) return false;
    if (Array.isArray(item.models) && !item.models.includes(participationModel)) return false;
    return true;
  });
}

export function renderFinanceEntityOperation(root, type, {
  onSaved = null,
  financeEntity = null,
  onInvestmentEventSaved = null,
} = {}) {
  const actionChoices = financeEntityOperationChoices(type, financeEntity);
  if (!actionChoices.length) return false;
  let currentActionId = actionChoices[0].id;
  let draft = null;

  const render = () => renderOperationForm(root, actionById(currentActionId), {
    onSaved,
    financeEntity,
    actionChoices,
    draft,
    onInvestmentEventSaved,
    onActionChange: (nextActionId, nextDraft) => {
      if (!actionChoices.some((item) => item.id === nextActionId)) return;
      currentActionId = nextActionId;
      draft = nextDraft;
      render();
    },
  });

  return render();
}
