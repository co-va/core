import { button } from '../buttons/index.js';
import { modal, mountModal } from '../modals/index.js';
import { actionBlock } from '../page/page.js';
import { timeSlots } from '../time/index.js';

const STEP_TITLES = {
  workplace: 'Выбор пространства',
  procedures: 'Выбор процедур',
  date: 'Выбор даты',
  time: 'Выбор времени',
  person: 'Выбор клиента',
  confirmation: 'Подтверждение записи',
  'break-start': 'Выбор времени С',
  'break-end': 'Выбор времени До',
  'break-confirmation': 'Подтверждение перерыва',
};

const TITLE_ALIASES = new Map([
  ['Выбор времени начала', 'Выбор времени С'],
  ['Выбор времени до скольки', 'Выбор времени До'],
]);

export function recordCreationStepTitle(step = '') {
  return STEP_TITLES[String(step || '')] || 'Запись';
}

function resolveRecordCreationTitle(step = '', title = '') {
  const explicit = String(title || '');
  if (TITLE_ALIASES.has(explicit)) return TITLE_ALIASES.get(explicit);
  return explicit || recordCreationStepTitle(step);
}

export function recordCreationTimeRows(items = [], {
  data = 'data-record-creation-time',
  empty = 'Времени нет.',
  selected = '',
} = {}) {
  const values = (Array.isArray(items) ? items : [])
    .map((item) => typeof item === 'object' ? { ...item } : { value: String(item || ''), label: String(item || '') })
    .map((item) => ({
      ...item,
      value: String(item.value ?? item.from ?? item.label ?? ''),
      label: String(item.label ?? item.value ?? item.from ?? ''),
    }))
    .filter((item) => item.value);
  if (!values.length) return `<div class="muted">${String(empty || 'Времени нет.')}</div>`;

  return timeSlots({
    values,
    selected,
    data,
    ariaLabel: 'Выбор времени',
  });
}

export function openRecordCreationOwner({ onCancel = () => {} } = {}) {
  const layer = mountModal(document.body, modal(
    `<div class="record-creation-flow" data-record-creation-flow>
      <div class="modal-title record-creation-flow__title"><h2 data-record-creation-title>Запись</h2></div>
      <div class="record-creation-flow__body" data-record-creation-body></div>
      <div class="record-creation-flow__action" data-record-creation-action></div>
    </div>`,
    {
      variant: 'q',
      surface: 'app',
      title: 'Запись',
      className: 'record-creation-q',
    },
  ));
  if (!layer) return null;

  let committed = false;
  const originalClose = layer.v2Close?.bind(layer) || (() => layer.remove());
  layer.v2Close = () => {
    if (!layer.isConnected) return;
    const cancelled = !committed;
    originalClose();
    if (cancelled) onCancel?.();
  };

  const headerHost = layer.querySelector('[data-v2-q-header-content]');
  const titleHost = layer.querySelector('[data-record-creation-title]');
  const bodyHost = layer.querySelector('[data-record-creation-body]');
  const actionHost = layer.querySelector('[data-record-creation-action]');

  const render = ({
    step = '',
    title = '',
    header = '',
    body = '',
    secondaryActions = [],
    action = null,
  } = {}) => {
    if (!bodyHost || !actionHost || !titleHost) return null;
    layer.dataset.recordCreationStep = String(step || '');
    if (headerHost) headerHost.innerHTML = String(header || '');
    titleHost.textContent = resolveRecordCreationTitle(step, title);
    bodyHost.innerHTML = body;
    const secondary = (Array.isArray(secondaryActions) ? secondaryActions : [])
      .filter((item) => item?.label)
      .map((item) => button(item.label, {
        data: item.data || '',
        disabled: Boolean(item.disabled),
        variant: item.variant || 'secondary',
      }))
      .join('');
    const primary = action?.label
      ? button(action.label, {
          data: action.data || 'data-record-creation-primary',
          disabled: Boolean(action.disabled),
          variant: action.variant || 'primary',
        })
      : '';
    actionHost.innerHTML = secondary || primary
      ? actionBlock(`${secondary}${primary}`)
      : '';
    return {
      layer,
      header: headerHost,
      body: bodyHost,
      action: action?.label ? actionHost.querySelector(`[${action.data || 'data-record-creation-primary'}]`) : null,
    };
  };

  return {
    layer,
    render,
    commit() {
      committed = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('va-tools:record-creation-committed'));
      layer.v2Close?.();
    },
    close() {
      layer.v2Close?.();
    },
    isOpen() {
      return Boolean(layer.isConnected);
    },
  };
}
