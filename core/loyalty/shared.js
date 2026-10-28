import {
  datePicker,
  entityVisualCard,
  escapeHtml,
  field,
  initDatePickers,
  modal,
  mountModal,
  openEntityCardAppearanceQ,
  openSharedProfileSettingsMenu,
  select,
  twoColumnLayout,
  v2ListEntries,
  v2ListEntry,
  workspaceHeaderContext,
} from '../../ui/ui.js';
import { compactCheck } from '../../ui/selection/check-list.js';
import { settingsPanel } from '../../ui/settings/index.js';
import { flushBusinessPersistence } from '../business-persistence.js';
import { getCardAppearanceTemplate, saveCardAppearanceTemplate } from '../card-appearance-templates.js';
import { getAllPeople } from '../people/data.js';
import { personDisplay } from '../people/presentation.js';
import { getProfile } from '../profile/data.js';
import {
  loyaltyCardAppearance,
  loyaltyCardFields,
  loyaltyCardLabel,
  loyaltyCardPhoto,
  loyaltyCardPhotoPosition,
  loyaltyCardScope,
} from './card-presentation.js';

export const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;
export const text = (value) => String(value ?? '').trim();
export const uid = (prefix = 'loyalty') => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function notifyLoyaltyContext() {
  window.dispatchEvent(new CustomEvent('book:v2-context-changed'));
}

function crop(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 50;
}

export function loyaltyHeader(title, { settings = false, c = null, settingsData = 'data-loyalty-e-settings' } = {}) {
  const profile = getProfile();
  const name = [profile?.name, profile?.surname].filter(Boolean).join(' ').trim() || 'Профиль';
  return workspaceHeaderContext({
    title,
    a: {
      kind: 'avatar',
      image: String(profile?.photo || ''),
      imagePosition: `${crop(profile?.photoCropX)}% ${crop(profile?.photoCropY)}%`,
      initials: name.slice(0, 1).toUpperCase() || '?',
    },
    v: settings ? {
      data: settingsData,
      aria: `Настройки ${title}`,
    } : null,
    c,
  });
}

export function loyaltyVisualCard(type, fields, { data = '', aria = '', interactive = true } = {}) {
  return entityVisualCard({
    appearance: loyaltyCardAppearance(type),
    fields,
    image: loyaltyCardPhoto(type),
    imagePosition: loyaltyCardPhotoPosition(type),
    interactive,
    data,
    aria,
  });
}

export function openLoyaltyAppearanceQ(root, {
  type,
  fields = loyaltyCardFields({ title: loyaltyCardLabel(type), subtitle: loyaltyCardLabel(type), status: 'Активна' }),
  onSaved = () => {},
} = {}) {
  const scope = loyaltyCardScope(type);
  const label = loyaltyCardLabel(type);
  const resolveFields = typeof fields === 'function' ? fields : () => fields;
  return openEntityCardAppearanceQ(root, {
    title: 'Вид',
    typeLabel: 'Тип карты',
    typeOptions: [{ value: scope, label }],
    initialType: scope,
    targetOptions: () => [],
    allowPhoto: true,
    resolve: () => ({
      appearance: loyaltyCardAppearance(type),
      fields: resolveFields(),
      photo: loyaltyCardPhoto(type),
      photoPosition: loyaltyCardPhotoPosition(type),
    }),
    save: async ({ appearance, photo, editor }) => {
      const current = getCardAppearanceTemplate(scope);
      saveCardAppearanceTemplate(scope, {
        appearance,
        photo,
        photoPosition: editor?.photoPosition || current?.photoPosition || loyaltyCardPhotoPosition(type),
      });
      await flushBusinessPersistence();
    },
    onSaved,
  });
}

export function bindViewSettings(root, title, { type, fields, onSaved = () => {} } = {}) {
  root?.querySelector?.('[data-loyalty-e-settings]')?.addEventListener('click', () => {
    openSharedProfileSettingsMenu({
      title,
      actions: [{
        id: 'appearance',
        label: 'Вид',
        onSelect: () => openLoyaltyAppearanceQ(root, { type, fields, onSaved }),
      }],
    });
  });
}

export function openLoyaltySettingsMenu({
  title = 'Настройки',
  checked = true,
  onToggle = null,
  actions = [],
} = {}) {
  const actionItems = (Array.isArray(actions) ? actions : []).filter((item) => item?.id && item?.label);
  const showToggle = typeof onToggle === 'function';
  const body = `<div class="form-grid" data-loyalty-settings-menu>
    ${showToggle ? compactCheck({ label: 'Показать', checked, data: 'data-loyalty-visibility', aria: 'Показать' }) : ''}
    ${settingsPanel(actionItems.map((item) => ({
      label: item.label,
      variant: item.variant || 'outline',
      data: `data-loyalty-settings-action="${escapeHtml(item.id)}"`,
      disabled: Boolean(item.disabled),
    })))}
  </div>`;
  const menu = mountModal(document.body, modal(body, {
    variant: 'x',
    surface: 'app',
    title,
    className: 'modal--profile-settings-sheet',
    xRole: 'action',
  }));
  if (!menu) return null;

  const visibility = menu.querySelector('[data-loyalty-visibility]');
  visibility?.addEventListener('change', async () => {
    const requested = Boolean(visibility.checked);
    visibility.disabled = true;
    try {
      const resolved = await onToggle?.(requested);
      if (typeof resolved === 'boolean') visibility.checked = resolved;
    } catch {
      visibility.checked = !requested;
    } finally {
      visibility.disabled = false;
    }
  });

  actionItems.forEach((item) => {
    if (item.disabled) return;
    menu.querySelector(`[data-loyalty-settings-action="${CSS.escape(String(item.id))}"]`)?.addEventListener('click', () => {
      menu.v2Close?.();
      void item.onSelect?.();
    });
  });
  return menu;
}

export function openLoyaltyProgramSettings({
  title = 'Программа',
  status = 'active',
  visible = true,
  onVisibility = null,
  correctLabel = 'Корректировать',
  onCorrect = () => {},
  onToggle = () => {},
  onFinish = () => {},
  onDelete = () => {},
} = {}) {
  const ended = status === 'ended' || status === 'closed';
  const actions = [
    { id: 'correct', label: correctLabel, onSelect: onCorrect },
  ];
  if (!ended) {
    actions.push({
      id: 'toggle',
      label: status === 'paused' ? 'Возобновить' : 'Приостановить',
      onSelect: onToggle,
    });
    actions.push({ id: 'finish', label: 'Завершить', onSelect: onFinish });
  }
  actions.push({ id: 'delete', label: 'Удалить', variant: 'danger', onSelect: onDelete });
  return openLoyaltySettingsMenu({
    title,
    checked: visible,
    onToggle: onVisibility,
    actions,
  });
}

export function normalizeOptionalUei(value = '') {
  return Array.from(String(value || '').toUpperCase())
    .filter((char) => /[A-ZА-ЯЁ0-9]/.test(char))
    .slice(0, 4)
    .join('');
}

export function optionalUeiField({ name = 'uei', value = '' } = {}) {
  return field({
    label: 'UEI',
    name,
    value: normalizeOptionalUei(value),
    maxlength: 4,
    autocomplete: 'off',
  });
}

export function initOptionalUeiField(root, name = 'uei') {
  const input = root?.querySelector?.(`[name="${CSS.escape(name)}"]`);
  if (!input || input.dataset.loyaltyUeiReady === 'true') return;
  input.dataset.loyaltyUeiReady = 'true';
  input.addEventListener('input', () => {
    input.value = normalizeOptionalUei(input.value);
  });
}

const TERM_UNIT_OPTIONS = [
  { value: 'days', label: 'Дней' },
  { value: 'months', label: 'Месяцев' },
  { value: 'years', label: 'Лет' },
];

export function loyaltyTermFields({
  prefix = 'term',
  label = 'Срок действия',
  mode = 'indefinite',
  allowDuration = true,
  allowRange = true,
  count = '',
  unit = 'months',
  startDate = '',
  endDate = '',
  startLabel = 'С',
  endLabel = 'До',
} = {}) {
  const options = [{ value: 'indefinite', label: 'Бессрочно' }];
  if (allowDuration) options.push({ value: 'duration', label: 'N дней / месяцев / лет' });
  if (allowRange) options.push({ value: 'range', label: 'Период' });
  const resolvedMode = options.some((item) => item.value === mode) ? mode : options[0].value;

  const duration = allowDuration ? `<div data-loyalty-term-panel="duration" hidden>${twoColumnLayout(
    field({ label: 'Количество', name: `${prefix}Count`, type: 'number', min: '1', step: '1', inputmode: 'numeric', value: count }),
    select({ label: 'Период', name: `${prefix}Unit`, value: unit, options: TERM_UNIT_OPTIONS }),
    { ariaLabel: `${label}: период` },
  )}</div>` : '';

  const range = allowRange ? `<div data-loyalty-term-panel="range" hidden>${twoColumnLayout(
    datePicker({ label: startLabel, name: `${prefix}StartDate`, value: startDate, showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: true }),
    datePicker({ label: endLabel, name: `${prefix}EndDate`, value: endDate, showYear: true, modalVariant: 'q', modalSurface: 'app', allowClear: true }),
    { ariaLabel: `${label}: даты` },
  )}</div>` : '';

  return `<div data-loyalty-term data-loyalty-term-prefix="${text(prefix)}">
    ${select({ label, name: `${prefix}Mode`, value: resolvedMode, options, data: 'data-loyalty-term-mode' })}
    ${duration}
    ${range}
  </div>`;
}

export function initLoyaltyTermFields(root) {
  if (!root) return;
  initDatePickers(root);
  root.querySelectorAll('[data-loyalty-term]').forEach((host) => {
    const prefix = text(host.dataset.loyaltyTermPrefix || 'term');
    const mode = host.querySelector(`[name="${CSS.escape(`${prefix}Mode`)}"]`);
    if (!mode) return;
    const sync = () => {
      host.querySelectorAll('[data-loyalty-term-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.loyaltyTermPanel !== mode.value;
      });
    };
    if (mode.dataset.loyaltyTermReady !== 'true') {
      mode.dataset.loyaltyTermReady = 'true';
      mode.addEventListener('change', sync);
    }
    sync();
  });
}

export function loyaltyTermData(values = {}, prefix = 'term') {
  const mode = text(values[`${prefix}Mode`] || 'indefinite');
  if (mode === 'duration') {
    const count = Math.max(1, Number(values[`${prefix}Count`] || 1));
    const unit = text(values[`${prefix}Unit`] || 'months');
    const unitLabel = unit === 'days' ? 'дн.' : unit === 'years' ? 'лет' : 'мес.';
    return { type: 'duration', count, unit, startDate: '', endDate: '', label: `${count} ${unitLabel}` };
  }
  if (mode === 'range') {
    const startDate = text(values[`${prefix}StartDate`]);
    const endDate = text(values[`${prefix}EndDate`]);
    const label = startDate && endDate ? `${startDate} — ${endDate}` : startDate ? `С ${startDate}` : endDate ? `До ${endDate}` : 'Период не задан';
    return { type: 'range', count: 0, unit: '', startDate, endDate, label };
  }
  return { type: 'indefinite', count: 0, unit: '', startDate: '', endDate: '', label: 'Бессрочно' };
}

export function formObject(form) {
  return Object.fromEntries([...new FormData(form).entries()].map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
}

export function people() {
  return getAllPeople();
}

export function personLabel(person = {}) {
  const display = personDisplay(person);
  return display.name || display.uei || 'Без имени';
}

export function personOption(person = {}) {
  const display = personDisplay(person);
  return {
    value: String(person?.key || person?.id || ''),
    label: [display.uei, display.name].filter(Boolean).join(' · ') || 'Без имени',
  };
}

export function resolvePerson(personKey = '') {
  const key = String(personKey || '');
  return people().find((item) => String(item?.key || item?.id || '') === key) || null;
}

export function rows(items = []) {
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.title || '',
    subtitle: item.subtitle || '',
    rightTop: item.rightTop || '',
    rightBottom: item.rightBottom || '',
    interactive: Boolean(item.interactive),
    initial: item.initial ?? '',
    image: item.image || '',
    data: item.data || '',
    aria: item.aria || '',
  })));
}

export function mockPerson(name, key) {
  return { key, name, uei: '' };
}

export function availablePeople(fallback = []) {
  const values = people();
  return values.length ? values : fallback;
}

export { loyaltyCardFields };
