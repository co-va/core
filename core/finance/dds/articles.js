import {
  actionBlock,
  button,
  emptyState,
  escapeHtml,
  field,
  formValidationMessage,
  list,
  mountV2ZLayer,
  openNotice,
  select,
  v2ZLayer,
  workspaceHeaderContext,
} from '../../../ui/ui.js';
import { getFinanceArticles } from '../data.js';
import { archiveFinanceArticle, createFinanceArticle, updateFinanceArticle } from '../service.js';

const ECONOMIC_OPTIONS = [
  { value: 'OPERATING_REVENUE', label: 'Операционный доход' },
  { value: 'PRODUCT_REVENUE', label: 'Продажа товаров' },
  { value: 'TIPS', label: 'Чаевые' },
  { value: 'LOAN_RECEIVED', label: 'Полученный займ' },
  { value: 'INVESTMENT_RECEIVED', label: 'Полученная инвестиция' },
  { value: 'OPERATING_EXPENSE', label: 'Операционный расход' },
  { value: 'TAX', label: 'Налог' },
  { value: 'REFUND', label: 'Возврат' },
  { value: 'LOAN_REPAYMENT', label: 'Возврат займа' },
  { value: 'INVESTMENT_RETURN', label: 'Возврат инвестиций' },
  { value: 'TRANSFER', label: 'Перевод' },
];

const DIRECTION_OPTIONS = [
  { value: 'IN', label: 'Доход' },
  { value: 'OUT', label: 'Расход' },
  { value: 'TRANSFER', label: 'Перевод' },
];

function treeRows(items = []) {
  const children = new Map();
  items.forEach((item) => {
    const key = String(item.parentArticleId || '');
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(item);
  });
  const result = [];
  const visit = (parentId = '', depth = 0, visited = new Set()) => {
    (children.get(parentId) || []).forEach((item) => {
      if (visited.has(item.articleId)) return;
      const nextVisited = new Set(visited);
      nextVisited.add(item.articleId);
      result.push({ ...item, depth });
      visit(item.articleId, depth + 1, nextVisited);
    });
  };
  visit('');
  items.filter((item) => !result.some((row) => row.articleId === item.articleId))
    .forEach((item) => result.push({ ...item, depth: 0 }));
  return result;
}

function directionLabel(value) {
  return DIRECTION_OPTIONS.find((item) => item.value === value)?.label || value;
}

function economicLabel(value) {
  if (value === 'GROUP') return 'Группа';
  return ECONOMIC_OPTIONS.find((item) => item.value === value)?.label || value;
}

function parentOptions(items, currentId = '') {
  return [
    { value: '', label: 'Корень' },
    ...treeRows(items)
      .filter((item) => item.articleId !== currentId)
      .map((item) => ({
        value: item.articleId,
        label: `${'— '.repeat(item.depth)}${item.name}`,
      })),
  ];
}

function row(item) {
  return {
    overline: `${directionLabel(item.direction)} · ${economicLabel(item.economicType)}`,
    title: `${'— '.repeat(item.depth)}${item.name}`,
    secondary: item.systemKey ? 'Системная статья' : '',
    right: '',
    interactive: true,
    data: `data-finance-article="${escapeHtml(item.articleId)}"`,
    aria: `Открыть статью ${item.name}`,
  };
}

function openForm(root, existing = null) {
  const items = getFinanceArticles();
  const isSystem = Boolean(existing?.systemKey);
  const direction = existing?.direction || 'OUT';
  const economicType = existing?.economicType === 'GROUP' ? 'OPERATING_EXPENSE' : (existing?.economicType || 'OPERATING_EXPENSE');
  const layer = mountV2ZLayer(root, v2ZLayer('', { className: 'finance-article-edit-z' }), { stack: true });
  if (!layer) return;

  layer.innerHTML = `${workspaceHeaderContext({
    title: existing ? 'Редактирование статьи' : 'Новая статья',
  })}
    <form class="compact-form" data-finance-article-form novalidate>
      ${field({ label: 'Название', name: 'articleName', value: existing?.name || '', required: true, placeholder: 'Например, Краска' })}
      ${select({ label: 'Родитель', name: 'parentArticleId', value: existing?.parentArticleId || '', options: parentOptions(items, existing?.articleId || '') })}
      ${select({ label: 'Тип', name: 'direction', value: direction, options: DIRECTION_OPTIONS })}
      ${select({ label: 'Экономический характер', name: 'economicType', value: economicType, options: ECONOMIC_OPTIONS })}
      ${existing && !isSystem ? button('Удалить', { type: 'button', variant: 'danger', data: 'data-delete-finance-article' }) : ''}
    </form>
    ${actionBlock(button('Сохранить', {
      data: 'data-finance-article-save',
      aria: 'Сохранить статью',
    }))}`;

  layer.querySelector('[data-finance-article-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const validation = formValidationMessage(form);
    if (validation) {
      openNotice({ message: validation });
      return;
    }
    const data = new FormData(form);
    const payload = {
      name: String(data.get('articleName') || '').trim(),
      parentArticleId: String(data.get('parentArticleId') || ''),
      direction: String(data.get('direction') || ''),
      economicType: String(data.get('economicType') || ''),
    };
    if (!payload.name) {
      openNotice({ message: 'Укажите название статьи.' });
      return;
    }
    if (existing) await updateFinanceArticle(existing.articleId, payload);
    else await createFinanceArticle(payload);
    layer.v2Close?.();
    renderList(root);
  });

  layer.querySelector('[data-finance-article-save]')?.addEventListener('click', () => {
    layer.querySelector('[data-finance-article-form]')?.requestSubmit();
  });

  layer.querySelector('[data-delete-finance-article]')?.addEventListener('click', async () => {
    await archiveFinanceArticle(existing.articleId);
    layer.v2Close?.();
    renderList(root);
  });
}

function renderList(root) {
  const items = getFinanceArticles();
  const rows = treeRows(items);
  root.innerHTML = `${workspaceHeaderContext({
    title: 'Статьи',
    c: {
      label: '+',
      data: 'data-add-finance-article',
      aria: 'Добавить статью',
    },
  })}${rows.length ? list({ items: rows.map(row) }) : emptyState('Статей пока нет', 'Добавьте первую статью кнопкой «+».')}`;

  root.querySelector('[data-add-finance-article]')?.addEventListener('click', () => openForm(root));
  root.querySelectorAll('[data-finance-article]').forEach((element) => {
    element.addEventListener('click', () => {
      const item = getFinanceArticles().find((candidate) => candidate.articleId === element.dataset.financeArticle);
      if (item) openForm(root, item);
    });
  });
}

export function renderFinanceArticles(root) {
  renderList(root);
}
