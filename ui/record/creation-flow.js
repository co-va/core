import { button } from '../buttons/index.js';
import { modal, mountModal } from '../modals/index.js';
import { actionBlock } from '../page/page.js';
import { timeSlots } from '../time/index.js';
import { setV2ZHeaderRows } from '../v2/z-layout.js';

const STEP_TITLES = {
  workplace: 'Выбор пространства',
  procedures: 'Выбор процедур',
  date: 'Выбор даты',
  time: 'Выбор времени',
  person: 'Выбор клиента',
  confirmation: 'Подтверждение записи',
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

function flowMarkup() {
  return `<div class="record-creation-flow" data-record-creation-flow>
    <div class="modal-title record-creation-flow__title">
      <div data-record-creation-step-header></div>
      <h2 data-record-creation-title>Запись</h2>
    </div>
    <div class="record-creation-flow__body" data-record-creation-body></div>
    <div class="record-creation-flow__action" data-record-creation-action></div>
  </div>`;
}

export function openRecordCreationOwner({
  onCancel = () => {},
  surfaceRoot = null,
  bodyRoot = null,
} = {}) {
  const inline = Boolean(surfaceRoot && bodyRoot);
  let layer = null;
  let savedHeader = null;
  let savedBody = null;
  let inlineHeaderHost = null;
  let inlineDismissControl = null;
  let inlineDismissHandler = null;
  const previousInlineBack = inline ? surfaceRoot?.v2Back : null;

  if (inline) {
    inlineHeaderHost = surfaceRoot.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-header-content]') || null;
    if (!inlineHeaderHost) return null;
    savedHeader = document.createDocumentFragment();
    while (inlineHeaderHost.firstChild) savedHeader.append(inlineHeaderHost.firstChild);
    savedBody = document.createDocumentFragment();
    while (bodyRoot.firstChild) savedBody.append(bodyRoot.firstChild);
    bodyRoot.innerHTML = flowMarkup();
    layer = bodyRoot;
  } else {
    layer = mountModal(document.body, modal(flowMarkup(), {
      variant: 'q',
      surface: 'app',
      title: 'Запись',
      className: 'record-creation-q',
    }));
  }
  if (!layer) return null;

  let committed = false;
  let closed = false;
  let backHandler = null;
  const originalClose = !inline
    ? (layer.v2Close?.bind(layer) || (() => layer.remove()))
    : null;

  const invokeBack = () => {
    if (typeof backHandler !== 'function') return false;
    return backHandler() !== false;
  };

  const restoreInline = () => {
    if (!inline || closed) return;
    closed = true;
    if (inlineDismissControl && inlineDismissHandler) inlineDismissControl.removeEventListener('click', inlineDismissHandler, true);
    if (surfaceRoot?.v2Back === invokeBack) surfaceRoot.v2Back = previousInlineBack || null;
    inlineHeaderHost.replaceChildren(savedHeader);
    bodyRoot.replaceChildren(savedBody);
  };

  const cancelInline = () => {
    if (!inline || closed) return;
    restoreInline();
    if (!committed) onCancel?.();
  };

  const handleBackControl = (event) => {
    if (!invokeBack()) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    return true;
  };

  if (inline) {
    surfaceRoot.v2Back = invokeBack;
    inlineDismissControl = surfaceRoot.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-dismiss]') || null;
    inlineDismissHandler = (event) => {
      if (handleBackControl(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelInline();
    };
    inlineDismissControl?.addEventListener('click', inlineDismissHandler, true);
  } else {
    layer.v2Back = invokeBack;
    layer.querySelector('[data-modal-close]')?.addEventListener('click', handleBackControl, true);
    layer.v2Close = () => {
      if (!layer.isConnected) return;
      const cancelled = !committed;
      originalClose();
      if (cancelled) onCancel?.();
    };
  }

  const headerHost = inline ? null : layer.querySelector('[data-v2-q-header-content]');
  const titleHost = layer.querySelector('[data-record-creation-title]');
  const titleWrap = titleHost?.closest('.record-creation-flow__title') || null;
  const bodyHost = layer.querySelector('[data-record-creation-body]');
  const actionHost = layer.querySelector('[data-record-creation-action]');
  const inlineStepHeaderHost = inline ? layer.querySelector('[data-record-creation-step-header]') : null;
  if (headerHost) {
    headerHost.innerHTML = '<div data-record-creation-shell-header></div><div data-record-creation-step-header></div>';
  }
  const shellHeaderHost = headerHost?.querySelector('[data-record-creation-shell-header]') || null;
  const stepHeaderHost = inlineStepHeaderHost || headerHost?.querySelector('[data-record-creation-step-header]') || headerHost;

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
    if (stepHeaderHost) stepHeaderHost.innerHTML = String(header || '');
    const resolvedTitle = title === false ? '' : resolveRecordCreationTitle(step, title);
    titleHost.textContent = resolvedTitle;
    if (titleWrap) titleWrap.hidden = !resolvedTitle && !String(header || '').trim();
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
      header: stepHeaderHost,
      body: bodyHost,
      action: action?.label ? actionHost.querySelector(`[${action.data || 'data-record-creation-primary'}]`) : null,
    };
  };

  return {
    layer,
    render,
    setShellHeader(content = '') {
      if (inline) {
        const rows = setV2ZHeaderRows(surfaceRoot, [String(content || '')]);
        return rows[0] || null;
      }
      if (!shellHeaderHost) return null;
      shellHeaderHost.innerHTML = String(content || '');
      return shellHeaderHost;
    },
    setBackHandler(handler = null) {
      backHandler = typeof handler === 'function' ? handler : null;
    },
    commit() {
      committed = true;
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('va-tools:record-creation-committed'));
      if (inline) restoreInline();
      else layer.v2Close?.();
    },
    close() {
      if (inline) cancelInline();
      else layer.v2Close?.();
    },
    isOpen() {
      return inline ? !closed && Boolean(bodyRoot.isConnected) : Boolean(layer.isConnected);
    },
  };
}
