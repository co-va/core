import { workspaceHeaderContext } from '../header/index.js';
import { mountV2ZLayer, v2ZLayer } from '../v2/index.js';
import { v2QFrame, v2ZBodySections } from '../v2/z-layout.js';
import { modal, mountModal } from '../modals/index.js';
import { bindCalendarHeaderHost } from '../calendar/index.js';
import { entityVisualCard } from '../cards/entity-card-constructor.js';
import { miniCard } from '../cards/mini-card.js';
import { v2ListEntry, v2ListEntries } from '../lists/list-entry.js';
import { v2HorizontalRail } from '../v2/index.js';
import { timeSlots } from '../time/index.js';
import { button } from '../buttons/index.js';
import { actionBlock } from '../page/page.js';

function recordSurface() {
  return document.querySelector('[data-v2-workspace-surface]')
    || document.querySelector('[data-v2-app]')
    || document.body;
}

function escapeRecordText(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[char]));
}

function normalizedChatKeys(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function isRecordEditClass(className = '') {
  return String(className || '').split(/\s+/).includes('record-edit-z');
}

function closeRecordEditQ() {
  [...document.querySelectorAll('[data-v2-q="true"]')].reverse().forEach((layer) => {
    if (!layer.querySelector?.('.record-edit-z')) return;
    if (typeof layer.v2Close === 'function') layer.v2Close();
    else layer.remove();
  });
}

function recordHeaderContext({
  title = 'Запись',
  settings = false,
  showA = true,
  chatPersonKey = '',
  chatPersonKeys = [],
  aImage = '',
  aImagePosition = '',
  aInitials = '',
} = {}) {
  const groupPersonKeys = normalizedChatKeys(chatPersonKeys);
  return {
    groupPersonKeys,
    html: workspaceHeaderContext({
      title,
      hideD: false,
      a: {
        kind: 'avatar',
        label: 'Запись',
        image: aImage,
        imagePosition: aImagePosition,
        initials: aInitials,
        ...(showA && settings ? {
          settingsTag: true,
          data: 'data-record-owner-settings',
          aria: 'Настройки записи',
        } : {
          disabled: true,
          aria: 'Запись',
        }),
      },
      d: {
        kind: 'chat',
        data: 'data-record-owner-chat',
        aria: groupPersonKeys.length > 1 ? 'Чат группы' : 'Чат',
      },
    }),
    chatPersonKey: String(chatPersonKey || ''),
  };
}

function bindRecordChat(layer, { chatPersonKey = '', groupPersonKeys = [] } = {}) {
  layer?.querySelector('[data-record-owner-chat]')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('book:record-chat-request', {
      detail: {
        personKey: String(chatPersonKey || ''),
        personKeys: normalizedChatKeys(groupPersonKeys),
      },
    }));
  });
}

function promoteRecordHeaderControls(layerRoot, host) {
  queueMicrotask(() => {
    const header = layerRoot?.querySelector?.(':scope > [data-v2-z-header] > [data-v2-z-header-content]');
    if (!header || !host?.isConnected) return;

    const controls = [];
    const modeControl = host.querySelector('[aria-label="Режим записи"]');
    if (modeControl) controls.push(modeControl);

    const searchInput = host.querySelector('[data-record-person-search]');
    const searchControl = searchInput?.closest?.('.ui-search-field') || null;
    if (searchControl) controls.push(searchControl);

    if (!controls.length) return;

    header.replaceChildren();
    controls.forEach((control, index) => {
      control.dataset.v2ZHeaderControl = '';
      control.style.margin = '0';
      const row = document.createElement('div');
      row.dataset.v2ZHeaderRow = String(index);
      row.style.minWidth = '0';
      row.append(control);
      header.append(row);
    });

    if (searchControl) host.querySelector('.ui-search-divider')?.remove();
  });
}

export function recordWorkplaceCards(items = [], {
  data = 'data-record-workplace',
} = {}) {
  const cards = (Array.isArray(items) ? items : []).map((item = {}) => {
    const key = String(item.key ?? item.id ?? '');
    const name = String(item.name || item.title || 'Рабочее пространство');
    return entityVisualCard({
      appearance: item.appearance || item.cardAppearance || {},
      fields: Array.isArray(item.fields) ? item.fields : [],
      image: String(item.photo || item.image || ''),
      imagePosition: String(item.imagePosition || '50% 50%'),
      interactive: true,
      data: `${data}="${escapeRecordText(key)}"`,
      aria: `Выбрать рабочее пространство ${name}`,
    });
  });
  return cards.length
    ? v2HorizontalRail(cards.join(''), { className: 'v2-profile-workplaces' })
    : '';
}

export function recordProcedureList(items = [], {
  data = 'data-record-procedure',
  selected = [],
  empty = 'Процедур нет.',
} = {}) {
  const selectedSet = new Set((Array.isArray(selected) ? selected : []).map(String));
  const rows = (Array.isArray(items) ? items : []).map((item = {}) => {
    const id = String(item.id || '');
    const name = String(item.name || item.title || 'Процедура');
    return v2ListEntry({
      title: name,
      subtitle: String(item.durationText || item.secondary || ''),
      rightTop: String(item.costText || item.right || ''),
      interactive: true,
      selectable: true,
      selected: selectedSet.has(id),
      data: `${data}="${escapeRecordText(id)}"`,
      aria: item.aria || `Выбрать процедуру ${name}`,
    });
  });
  return rows.length
    ? v2ListEntries(rows)
    : `<div class="muted">${escapeRecordText(empty)}</div>`;
}

export function recordPersonList(items = [], {
  data = 'data-record-person',
  selected = '',
  empty = 'Люди не найдены.',
} = {}) {
  const selectedSet = new Set((Array.isArray(selected) ? selected : [selected]).map(String).filter(Boolean));
  const rows = (Array.isArray(items) ? items : []).map((item = {}) => {
    const key = String(item.key || item.id || '');
    return v2ListEntry({
      overline: item.uei || '',
      title: item.name || '',
      subtitle: item.phone || '',
      initial: '',
      className: 'list-entry--record-person',
      interactive: true,
      selected: selectedSet.has(key),
      data: `${data}="${escapeRecordText(key)}"`,
      aria: item.aria || `Выбрать ${item.name || ''}`,
    });
  });
  return rows.length ? v2ListEntries(rows) : `<div class="muted">${escapeRecordText(empty)}</div>`;
}

function timeValue(item) {
  return String(item && typeof item === 'object' ? (item.from ?? item.value ?? '') : item ?? '');
}

export function recordTimeRows(items = [], {
  data = 'data-record-time',
  empty = 'Нет свободного времени',
  accentEvery = 30,
} = {}) {
  const values = (Array.isArray(items) ? items : []).map(timeValue).filter(Boolean);
  if (!values.length) return `<div class="muted">${escapeRecordText(empty)}</div>`;
  return timeSlots({
    values: values.map((value) => {
      const minute = Number(value.split(':')[1] || 0);
      return {
        value,
        label: value,
        emphasized: Number(accentEvery) > 0 && minute % Number(accentEvery) === 0,
      };
    }),
    data,
    ariaLabel: 'Выбор времени',
    className: 'time-slots--record-vertical',
  });
}

export function recordConfirmationMiniCard({
  workplace = '',
  contactDiscount = '',
  date = '',
  period = '',
  identity = '',
  phone = '',
  duration = '',
  discountMoney = '',
  total = '',
  programControl = '',
  procedures = [],
} = {}) {
  const serviceRows = (Array.isArray(procedures) ? procedures : []).map((item = {}) => v2ListEntry({
    title: item.name || item.title || 'Процедура',
    subtitle: item.durationText || item.secondary || '',
    rightTop: item.right || item.costText || '',
    interactive: false,
    actionData: item.action?.data || '',
    actionAria: item.action?.aria || '',
    actionIcon: item.action?.label || '⚙',
  }));
  const services = serviceRows.length ? v2ListEntries(serviceRows) : '';

  const card = miniCard({
    className: 'record-confirmation-mini-card',
    lines: [
      { value: workplace, strong: true },
      { value: contactDiscount, align: 'right', strong: true },
      { value: date },
      { value: period, align: 'right' },
      { value: identity, strong: true },
      { value: phone },
      { value: duration, strong: true },
      { value: discountMoney, strong: true },
      { value: total, align: 'right', strong: true },
    ],
  });

  return `<div class="record-confirmation-view">${v2ZBodySections([
    { kind: 'content', content: `<div class="record-confirmation-view__card">${card}</div>` },
    ...(programControl ? [{ kind: 'content', content: `<div class="record-confirmation-view__program">${programControl}</div>` }] : []),
    { kind: 'content', content: `<div class="record-confirmation-view__procedures">${services}</div>` },
  ])}</div>`;
}

export function mountRecordZ({
  title = 'Запись',
  settings = false,
  showA = true,
  className = '',
  stack = true,
  onClose = null,
  chatPersonKey = '',
  chatPersonKeys = [],
  aImage = '',
  aImagePosition = '',
  aInitials = '',
} = {}) {
  if (isRecordEditClass(className) && title !== 'Выбор времени') {
    return mountRecordQ({
      title,
      settings,
      showA,
      className,
      onClose,
      chatPersonKey,
      chatPersonKeys,
      aImage,
      aImagePosition,
      aInitials,
    });
  }
  if (isRecordEditClass(className)) closeRecordEditQ();

  const context = recordHeaderContext({
    title,
    settings,
    showA,
    chatPersonKey,
    chatPersonKeys,
    aImage,
    aImagePosition,
    aInitials,
  });
  const classes = ['record-shared-z', className].filter(Boolean).join(' ');
  const layer = mountV2ZLayer(recordSurface(), v2ZLayer(
    `${context.html}<div data-record-owner-host></div>`,
    { className: classes },
  ), { stack, onClose });
  bindRecordChat(layer, context);
  return layer;
}

export function mountRecordQ({
  title = 'Запись',
  settings = false,
  showA = true,
  className = '',
  onClose = null,
  chatPersonKey = '',
  chatPersonKeys = [],
  aImage = '',
  aImagePosition = '',
  aInitials = '',
} = {}) {
  const context = recordHeaderContext({
    title,
    settings,
    showA,
    chatPersonKey,
    chatPersonKeys,
    aImage,
    aImagePosition,
    aInitials,
  });
  const classes = ['record-shared-q', className].filter(Boolean).join(' ');
  const layer = mountModal(document.body, modal(
    `${context.html}${v2QFrame('<div data-record-owner-host></div>')}`,
    { variant: 'q', surface: 'app', title, className: classes },
  ));
  if (!layer) return null;
  bindRecordChat(layer, context);

  const disposeCalendarHeaderHost = title === 'Выбор даты'
    ? bindCalendarHeaderHost(recordZHost(layer), recordQHeaderHost(layer))
    : () => {};

  const originalClose = layer.v2Close?.bind(layer);
  layer.v2Close = () => {
    if (!layer.isConnected) return;
    disposeCalendarHeaderHost();
    originalClose?.();
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
      onClose?.();
    });
  };
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
  return layer;
}

export function recordZHost(layerRoot) {
  return layerRoot?.querySelector('[data-record-owner-host]') || null;
}

export function recordQHeaderHost(layerRoot) {
  return layerRoot?.querySelector('[data-v2-q-header-content]') || null;
}

export function renderRecordZ(layerRoot, content = '') {
  const host = recordZHost(layerRoot);
  if (!host) return null;
  host.innerHTML = String(content || '');
  promoteRecordHeaderControls(layerRoot, host);
  return host;
}

export function setRecordPrimaryAction(layerRoot, {
  label = '',
  variant = '',
  onClick = null,
} = {}) {
  const host = recordZHost(layerRoot);
  if (!host) return;
  host.querySelector('[data-record-owner-primary-actions]')?.remove();
  if (!label || typeof onClick !== 'function') return;
  host.insertAdjacentHTML('beforeend', actionBlock(button(label, {
    data: 'data-record-owner-primary',
    aria: label,
    variant,
  })));
  const actions = host.querySelector('.modal-actions:last-of-type');
  if (actions) actions.dataset.recordOwnerPrimaryActions = '';
  host.querySelector('[data-record-owner-primary]')?.addEventListener('click', onClick);
}

export function bindRecordSettings(layerRoot, onOpen) {
  if (typeof onOpen !== 'function') return;
  layerRoot?.querySelector('[data-record-owner-settings]')?.addEventListener('click', onOpen);
}

export function closeRecordZStack(className = 'record-flow-z') {
  const selector = className
    ? `[data-v2-z-layer].${className}`
    : '[data-v2-z-layer].record-shared-z';
  [...document.querySelectorAll(selector)].reverse().forEach((layer) => layer.v2Close?.());
  if (className) {
    [...document.querySelectorAll('[data-v2-q="true"]')].reverse().forEach((layer) => {
      if (!layer.querySelector?.(`.${className}`)) return;
      layer.v2Close?.();
    });
  }
}