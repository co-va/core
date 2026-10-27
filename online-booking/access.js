import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import { API_BASE } from '../core/environment.js';
import { formatPhone } from '../core/phone/index.js';
import { button, iconButton } from '../ui/buttons/index.js';
import { initCalendar } from '../ui/calendar/index.js';
import { documentTile, documentTiles, openDocumentViewer } from '../ui/documents/index.js';
import { durationText } from '../ui/duration/index.js';
import { field, formValidationMessage, phoneField } from '../ui/inputs/index.js';
import { v2ListEntry, v2ListEntries } from '../ui/lists/list-entry.js';
import { modal, mountModal, openNotice } from '../ui/modals/index.js';
import { actionBlock } from '../ui/page/page.js';
import { recordCreationTimeRows } from '../ui/record/creation-flow.js';
import { recordProcedureList } from '../ui/record/runtime.js';
import { emptyState } from '../ui/states/index.js';
import { escapeHtml } from '../ui/utils/escape-html.js';
import {
  bookingProcedurePrice,
  getBookingProcedures,
  getBookingSlots,
  getBookingTimeRows,
  getBookingWorkingDates,
  requiredBookingDocuments,
} from './model.js';

const MODE_SELF = 'self';
const MODE_OTHER = 'other';
const MODE_JOINT = 'joint';
const DRAFT_VERSION = 1;
const DRAFT_TTL = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function priceText(price = {}) {
  return `${price.variable ? 'от ' : ''}${money(price.minimum)}`;
}

function formatBookingPhone(value) {
  const phone = text(value);
  return phone ? formatPhone(phone) || phone : '';
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || match[2]}`;
}

function normalizeStep(value = {}) {
  const kind = text(value?.kind || value);
  const allowed = new Set(['workplace', 'mode', 'data', 'services', 'date', 'time', 'consents', 'preview', 'exit', 'success']);
  return {
    kind: allowed.has(kind) ? kind : 'workplace',
    index: Math.max(0, Math.floor(Number(value?.index) || 0)),
  };
}

function cloneStep(value) {
  return normalizeStep(value);
}

function sameStep(left, right) {
  const a = normalizeStep(left);
  const b = normalizeStep(right);
  return a.kind === b.kind && a.index === b.index;
}

async function jsonRequest(path, options = {}, fallback = 'Не удалось выполнить действие') {
  const headers = new Headers(options.headers || {});
  if (options.body != null && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(text(payload?.message) || fallback);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function draftState() {
  return history.state && typeof history.state === 'object' ? history.state : {};
}

function draftSnapshot(state, exited = state.exited) {
  return {
    version: DRAFT_VERSION,
    savedAt: Date.now(),
    tenantId: state.tenantId,
    lockedWorkplaceKey: state.lockedWorkplaceKey,
    workplaceKey: state.workplaceKey,
    mode: state.mode,
    booker: { ...state.booker },
    participants: state.participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      phone: participant.phone,
      email: participant.email,
      procedureIds: [...participant.procedureIds],
    })),
    date: state.date,
    from: state.from,
    to: state.to,
    consents: { ...state.consents },
    current: cloneStep(state.current),
    resumeStep: cloneStep(state.resumeStep || state.current),
    history: state.history.map(cloneStep),
    exited: Boolean(exited),
  };
}

function persistDraft(state, exited = state.exited) {
  history.replaceState({ ...draftState(), covaBookingDraft: draftSnapshot(state, exited) }, '', location.href);
}

function clearDraft() {
  const next = { ...draftState() };
  delete next.covaBookingDraft;
  history.replaceState(next, '', location.href);
}

function restoreDraft(state) {
  const draft = draftState().covaBookingDraft;
  if (!draft || Number(draft.version) !== DRAFT_VERSION) return false;
  if (text(draft.tenantId) !== state.tenantId || text(draft.lockedWorkplaceKey) !== state.lockedWorkplaceKey) return false;
  if (Date.now() - Number(draft.savedAt || 0) > DRAFT_TTL) {
    clearDraft();
    return false;
  }
  state.workplaceKey = text(draft.workplaceKey);
  state.mode = [MODE_SELF, MODE_OTHER, MODE_JOINT].includes(text(draft.mode)) ? text(draft.mode) : '';
  state.booker = {
    name: text(draft.booker?.name),
    phone: text(draft.booker?.phone),
    email: text(draft.booker?.email),
  };
  state.participants = (Array.isArray(draft.participants) ? draft.participants : []).map((participant, index) => ({
    id: text(participant?.id) || `participant-${index + 1}`,
    name: text(participant?.name),
    phone: text(participant?.phone),
    email: text(participant?.email),
    procedureIds: [...new Set((Array.isArray(participant?.procedureIds) ? participant.procedureIds : []).map(text).filter(Boolean))],
  }));
  state.participantSequence = state.participants.length + 1;
  state.date = text(draft.date).slice(0, 10);
  state.from = text(draft.from);
  state.to = text(draft.to);
  state.consents = draft.consents && typeof draft.consents === 'object' ? { ...draft.consents } : {};
  state.current = normalizeStep(draft.current);
  state.resumeStep = normalizeStep(draft.resumeStep || draft.current);
  state.history = (Array.isArray(draft.history) ? draft.history : []).map(normalizeStep);
  state.exited = Boolean(draft.exited);
  return true;
}

async function refreshContext(state) {
  const params = new URLSearchParams();
  if (state.lockedWorkplaceKey) params.set('workplace', state.lockedWorkplaceKey);
  const suffix = params.toString() ? `?${params}` : '';
  state.context = await jsonRequest(
    `/online-booking/${encodeURIComponent(state.tenantId)}/context${suffix}`,
    {},
    'Не удалось загрузить запись',
  );
  state.settings = normalizeBookingSettings(state.context?.settings);
}

function newParticipant(state, seed = {}) {
  state.participantSequence += 1;
  return {
    id: text(seed.id) || `participant-${state.participantSequence}`,
    name: text(seed.name),
    phone: text(seed.phone),
    email: text(seed.email),
    procedureIds: [...new Set((Array.isArray(seed.procedureIds) ? seed.procedureIds : []).map(text).filter(Boolean))],
  };
}

function resetAfterServices(state) {
  state.date = '';
  state.from = '';
  state.to = '';
}

function resetAfterDate(state) {
  state.from = '';
  state.to = '';
}

function setMode(state, mode) {
  const next = [MODE_SELF, MODE_OTHER, MODE_JOINT].includes(mode) ? mode : MODE_SELF;
  if (state.mode === next && state.participants.length) return;
  const previous = state.participants;
  state.mode = next;
  if (next === MODE_SELF) {
    state.participants = [newParticipant(state, {
      id: 'booker',
      ...state.booker,
      procedureIds: previous[0]?.procedureIds?.length ? previous[0].procedureIds : state.repeatProcedureIds,
    })];
  } else if (next === MODE_OTHER) {
    const other = previous.find((item) => item.id !== 'booker') || previous[0] || {};
    state.participants = [newParticipant(state, {
      ...other,
      id: 'recipient-1',
      procedureIds: other.procedureIds?.length ? other.procedureIds : state.repeatProcedureIds,
    })];
  } else {
    const bookerServices = previous.find((item) => item.id === 'booker')?.procedureIds || state.repeatProcedureIds;
    const extras = previous.filter((item) => item.id !== 'booker');
    state.participants = [
      newParticipant(state, { id: 'booker', ...state.booker, procedureIds: bookerServices }),
      ...(extras.length ? extras.map((item) => newParticipant(state, item)) : [newParticipant(state)]),
    ];
  }
  resetAfterServices(state);
}

function totalDuration(state) {
  const catalog = new Map(getBookingProcedures(state.context, state.workplaceKey)
    .map((procedure) => [text(procedure?.id), procedure]));
  return state.participants.reduce((sum, participant) => sum + participant.procedureIds.reduce((inner, id) => (
    inner + Math.max(0, Number(catalog.get(text(id))?.duration || 0))
  ), 0), 0);
}

function selectedProcedures(state, participant) {
  const catalog = new Map(getBookingProcedures(state.context, state.workplaceKey)
    .map((procedure) => [text(procedure?.id), procedure]));
  return participant.procedureIds.map((id) => catalog.get(text(id))).filter(Boolean);
}

function proceduresPrice(state, procedures = []) {
  return procedures.reduce((summary, procedure) => {
    const price = bookingProcedurePrice(procedure, state.workplaceKey);
    summary.minimum += price.minimum;
    summary.variable = summary.variable || price.variable;
    return summary;
  }, { minimum: 0, variable: false });
}

function participantPrice(state, participant) {
  return proceduresPrice(state, selectedProcedures(state, participant));
}

function totalPrice(state) {
  return state.participants.reduce((summary, participant) => {
    const price = participantPrice(state, participant);
    summary.minimum += price.minimum;
    summary.variable = summary.variable || price.variable;
    return summary;
  }, { minimum: 0, variable: false });
}

function legalPhoneKey(value) {
  return text(value).replace(/\D/g, '');
}

function startLegalLookup(state, { force = false } = {}) {
  const phone = text(state.booker.phone);
  const phoneKey = legalPhoneKey(phone);
  if (!phoneKey) return Promise.resolve({});

  if (state.legalPhone !== phoneKey) {
    const hadPhone = Boolean(state.legalPhone);
    state.legalPhone = phoneKey;
    state.legalState = {};
    state.legalResolved = false;
    state.legalLookup = null;
    state.legalError = '';
    if (hadPhone) state.consents = {};
  } else if (!force && state.legalResolved) {
    return Promise.resolve(state.legalState);
  } else if (!force && state.legalLookup) {
    return state.legalLookup;
  }

  const token = ++state.legalLookupToken;
  state.legalResolved = false;
  state.legalError = '';
  const lookup = jsonRequest(
    `/online-booking/${encodeURIComponent(state.tenantId)}/booking-state`,
    {
      method: 'POST',
      body: JSON.stringify({ name: state.booker.name, phone, email: state.booker.email }),
    },
    'Не удалось проверить действующие согласия',
  );
  state.legalLookup = lookup;
  return lookup.then((result) => {
    if (token !== state.legalLookupToken) return result;
    state.legalLookup = null;
    state.legalResolved = true;
    state.legalError = '';
    state.legalState = result && typeof result === 'object' ? result : {};
    if (state.current.kind === 'consents') renderCurrent(state);
    return result;
  }).catch((error) => {
    if (token === state.legalLookupToken) {
      state.legalLookup = null;
      state.legalResolved = false;
      state.legalState = {};
      state.legalError = text(error?.message) || 'Не удалось проверить действующие согласия.';
      if (state.current.kind === 'consents') renderCurrent(state);
    }
    return {};
  });
}

function activeConsentIds(state) {
  const rows = Array.isArray(state.legalState?.consents) ? state.legalState.consents : [];
  return new Set(rows.filter((row) => row?.active).map((row) => text(row?.documentId)).filter(Boolean));
}

function flowHost(state) {
  return state.layer?.querySelector('[data-booking-flow]') || null;
}

function renderFrame(state, { title = 'Запись', body = '', action = '', back = true } = {}) {
  const host = flowHost(state);
  if (!host) return null;
  host.innerHTML = `<div class="booking-flow">
    <header class="booking-flow__header${back ? '' : ' booking-flow__header--first'}">
      ${back ? iconButton('←', { className: 'booking-flow__back', data: 'data-booking-back', aria: 'Назад' }) : ''}
      <h2>${escapeHtml(title)}</h2>
    </header>
    <div class="booking-flow__body">${body}</div>
    ${action ? `<div class="booking-flow__footer">${action}</div>` : ''}
  </div>`;
  host.querySelector('[data-booking-back]')?.addEventListener('click', () => goBack(state));
  return host;
}

function go(state, step, { push = true } = {}) {
  const next = normalizeStep(step);
  if (push && state.current && !sameStep(state.current, next)) state.history.push(cloneStep(state.current));
  state.current = next;
  state.exited = false;
  persistDraft(state, false);
  renderCurrent(state);
}

function goBack(state) {
  const previous = state.history.pop();
  if (!previous) return;
  state.current = previous;
  state.exited = false;
  persistDraft(state, false);
  renderCurrent(state);
}

function showExit(state) {
  if (state.current.kind === 'success') {
    state.hardClose?.();
    return;
  }
  if (state.current.kind === 'exit') return;
  state.resumeStep = cloneStep(state.current);
  state.current = { kind: 'exit', index: 0 };
  state.exited = true;
  persistDraft(state, true);
  renderCurrent(state);
}

function workplaceHasSchedule(state, workplaceKey) {
  return getBookingWorkingDates(state.context, workplaceKey).length > 0;
}

function renderWorkplace(state) {
  const workplaces = Array.isArray(state.context?.workplaces) ? state.context.workplaces : [];
  const rows = workplaces.map((workplace) => {
    const workplaceKey = text(workplace?.key);
    const available = workplaceHasSchedule(state, workplaceKey);
    return v2ListEntry({
      title: text(workplace?.name) || 'Рабочее пространство',
      subtitle: [text(workplace?.city), text(workplace?.address)].filter(Boolean).join(', '),
      interactive: available,
      selected: workplaceKey === state.workplaceKey,
      data: available ? `data-booking-workplace="${escapeHtml(workplaceKey)}"` : '',
      aria: available ? `Выбрать рабочее пространство ${text(workplace?.name)}` : '',
    });
  });
  const host = renderFrame(state, {
    title: 'Рабочее пространство',
    body: v2ListEntries(rows),
    back: state.history.length > 0,
  });
  host?.querySelectorAll('[data-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
    state.workplaceKey = text(node.dataset.bookingWorkplace);
    resetAfterServices(state);
    persistDraft(state);
    go(state, { kind: 'mode' });
  }));
}

function renderMode(state) {
  const options = [
    { value: MODE_SELF, label: 'Записаться' },
    { value: MODE_OTHER, label: 'Записать другого человека' },
    { value: MODE_JOINT, label: 'Совместная запись' },
  ];
  const rows = options.map((option) => v2ListEntry({
    title: option.label,
    interactive: true,
    selected: state.mode === option.value,
    data: `data-booking-mode="${option.value}"`,
    aria: option.label,
  }));
  const host = renderFrame(state, {
    title: 'Как оформить запись?',
    body: v2ListEntries(rows),
    back: state.history.length > 0,
  });
  host?.querySelectorAll('[data-booking-mode]').forEach((node) => node.addEventListener('click', () => {
    setMode(state, text(node.dataset.bookingMode));
    persistDraft(state);
    go(state, { kind: 'data' });
  }));
}

function participantFields(participant, index, { removable = false } = {}) {
  return `<section class="booking-participant" data-booking-participant="${index}">
    <div class="booking-participant__heading"><strong>Участник ${index + 1}</strong>${removable ? button('Удалить', { variant: 'secondary', data: `data-booking-remove-participant="${index}"` }) : ''}</div>
    ${field({ label: 'Имя', name: `participantName${index}`, value: participant.name, required: true, autocomplete: 'given-name' })}
    ${phoneField({ label: 'Телефон', name: `participantPhone${index}`, value: participant.phone, required: false })}
    ${field({ label: 'Email', name: `participantEmail${index}`, value: participant.email, type: 'email', required: false, autocomplete: 'email' })}
  </section>`;
}

function syncDataForm(state, form, { validate = false } = {}) {
  if (!form) return '';
  if (validate) {
    const error = formValidationMessage(form);
    if (error) return error;
  }
  const data = new FormData(form);
  state.booker = {
    name: text(data.get('bookerName')),
    phone: text(data.get('bookerPhone')),
    email: text(data.get('bookerEmail')),
  };
  if (state.mode === MODE_SELF) {
    const services = state.participants[0]?.procedureIds || [];
    state.participants = [newParticipant(state, { id: 'booker', ...state.booker, procedureIds: services })];
  } else if (state.mode === MODE_OTHER) {
    const current = state.participants[0] || newParticipant(state, { id: 'recipient-1' });
    state.participants = [newParticipant(state, {
      ...current,
      id: 'recipient-1',
      name: text(data.get('participantName0')),
      phone: text(data.get('participantPhone0')),
      email: text(data.get('participantEmail0')),
    })];
  } else {
    const current = state.participants;
    const extras = current.filter((item) => item.id !== 'booker');
    const bookerServices = current.find((item) => item.id === 'booker')?.procedureIds || [];
    state.participants = [newParticipant(state, { id: 'booker', ...state.booker, procedureIds: bookerServices })];
    extras.forEach((participant, index) => {
      state.participants.push(newParticipant(state, {
        ...participant,
        name: text(data.get(`participantName${index}`)),
        phone: text(data.get(`participantPhone${index}`)),
        email: text(data.get(`participantEmail${index}`)),
      }));
    });
  }
  return '';
}

function renderData(state, errorMessage = '') {
  const extras = state.mode === MODE_JOINT
    ? state.participants.filter((item) => item.id !== 'booker')
    : state.participants;
  const participantMarkup = state.mode === MODE_SELF
    ? ''
    : extras.map((participant, index) => participantFields(participant, index, {
      removable: state.mode === MODE_JOINT && extras.length > 1,
    })).join('');
  const add = state.mode === MODE_JOINT
    ? button('Добавить участника', { variant: 'secondary', data: 'data-booking-add-participant' })
    : '';
  const body = `<form data-booking-data-form>
    <section class="booking-participant booking-participant--booker">
      <div class="booking-participant__heading"><strong>Кто оформляет запись</strong></div>
      ${field({ label: 'Имя', name: 'bookerName', value: state.booker.name, required: true, autocomplete: 'given-name' })}
      ${phoneField({ label: 'Телефон', name: 'bookerPhone', value: state.booker.phone, required: true })}
      ${field({ label: 'Email', name: 'bookerEmail', value: state.booker.email, type: 'email', required: false, autocomplete: 'email' })}
    </section>
    ${participantMarkup}
    ${add}
    ${errorMessage ? `<p class="form-error" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
  </form>`;
  const host = renderFrame(state, {
    title: state.mode === MODE_SELF ? 'Ваши данные' : 'Данные участников',
    body,
    action: actionBlock(button('Далее', { data: 'data-booking-data-next' })),
    back: state.history.length > 0,
  });
  const form = host?.querySelector('[data-booking-data-form]');
  host?.querySelector('[data-booking-add-participant]')?.addEventListener('click', () => {
    syncDataForm(state, form);
    state.participants.push(newParticipant(state));
    persistDraft(state);
    renderData(state);
  });
  host?.querySelectorAll('[data-booking-remove-participant]').forEach((node) => node.addEventListener('click', () => {
    syncDataForm(state, form);
    const index = Math.max(0, Number(node.dataset.bookingRemoveParticipant) || 0);
    const booker = state.participants.find((item) => item.id === 'booker');
    const remaining = state.participants.filter((item) => item.id !== 'booker').filter((_, itemIndex) => itemIndex !== index);
    state.participants = [booker, ...remaining].filter(Boolean);
    persistDraft(state);
    renderData(state);
  }));
  host?.querySelector('[data-booking-data-next]')?.addEventListener('click', () => {
    const validationError = syncDataForm(state, form, { validate: true });
    const missingParticipantName = state.mode !== MODE_SELF && state.participants.some((participant) => !participant.name);
    if (validationError || missingParticipantName) {
      renderData(state, validationError || 'Укажите имя каждого участника.');
      return;
    }
    startLegalLookup(state);
    resetAfterServices(state);
    persistDraft(state);
    go(state, { kind: 'services', index: 0 });
  });
}

function procedureRows(state, participant) {
  return getBookingProcedures(state.context, state.workplaceKey).map((procedure) => ({
    ...procedure,
    durationText: durationText(procedure?.duration || 0),
    costText: priceText(bookingProcedurePrice(procedure, state.workplaceKey)),
    aria: `Выбрать услугу ${text(procedure?.name)}`,
  }));
}

function renderServices(state) {
  const index = Math.min(state.current.index, Math.max(0, state.participants.length - 1));
  state.current.index = index;
  const participant = state.participants[index];
  if (!participant) {
    go(state, { kind: 'data' }, { push: false });
    return;
  }
  const committed = new Set(participant.procedureIds);
  const selected = new Set(participant.procedureIds);

  const render = () => {
    const body = recordProcedureList(procedureRows(state, participant), {
      data: 'data-booking-procedure',
      selected: [...selected],
      empty: 'Услуги не настроены.',
    });
    const host = renderFrame(state, {
      title: `Выбор услуг — ${participant.name || 'Участник'}`,
      body,
      action: actionBlock(button('Далее', { data: 'data-booking-services-next', disabled: !selected.size })),
      back: state.history.length > 0,
    });
    host?.querySelectorAll('[data-booking-procedure]').forEach((node) => node.addEventListener('click', () => {
      const id = text(node.dataset.bookingProcedure);
      if (!id) return;
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render();
    }));
    host?.querySelector('[data-booking-services-next]')?.addEventListener('click', () => {
      if (!selected.size) return;
      const changed = selected.size !== committed.size || [...selected].some((id) => !committed.has(id));
      participant.procedureIds = [...selected];
      if (changed) resetAfterServices(state);
      persistDraft(state);
      const nextIndex = index + 1;
      if (nextIndex < state.participants.length) go(state, { kind: 'services', index: nextIndex });
      else go(state, { kind: 'date' });
    });
  };

  render();
}

function availableDates(state) {
  const duration = totalDuration(state);
  if (duration <= 0) return [];
  return getBookingWorkingDates(state.context, state.workplaceKey).filter((date) => getBookingSlots(state.context, {
    workplaceKey: state.workplaceKey,
    date,
    duration,
    step: state.settings.slotStep,
  }).length > 0);
}

function renderDate(state) {
  const dates = availableDates(state);
  const allowed = new Set(dates);
  if (state.date && !allowed.has(state.date)) {
    state.date = '';
    resetAfterDate(state);
  }
  const host = renderFrame(state, {
    title: 'Дата',
    body: dates.length ? '<div data-booking-calendar></div>' : emptyState('Нет доступных дат', 'Для выбранных услуг пока нет свободного времени.'),
    action: actionBlock(button('Далее', { data: 'data-booking-date-next', disabled: !state.date })),
    back: state.history.length > 0,
  });
  const calendarHost = host?.querySelector('[data-booking-calendar]');
  if (calendarHost) {
    initCalendar(calendarHost, {
      workingDates: dates,
      selectedValue: state.date,
      onDateSelect: (date) => {
        if (!allowed.has(date)) return;
        state.date = date;
        resetAfterDate(state);
        persistDraft(state);
        renderDate(state);
      },
    });
  }
  host?.querySelector('[data-booking-date-next]')?.addEventListener('click', () => {
    if (state.date) go(state, { kind: 'time' });
  });
}

function renderTime(state) {
  const duration = totalDuration(state);
  const rows = getBookingTimeRows(state.context, {
    workplaceKey: state.workplaceKey,
    date: state.date,
    duration,
    step: state.settings.slotStep,
  });
  if (state.from && !rows.some((row) => text(row.from) === state.from && row.available !== false)) {
    state.from = '';
    state.to = '';
  }
  const body = recordCreationTimeRows(rows, {
    data: 'data-booking-time',
    selected: state.from,
    empty: 'Свободного времени нет.',
  });
  const host = renderFrame(state, {
    title: 'Время',
    body,
    action: actionBlock(button('Далее', { data: 'data-booking-time-next', disabled: !state.from })),
    back: state.history.length > 0,
  });
  host?.querySelectorAll('[data-booking-time]').forEach((node) => node.addEventListener('click', () => {
    const from = text(node.dataset.bookingTime || node.dataset.value);
    const row = rows.find((item) => text(item.from || item.value) === from);
    if (!row || row.available === false || row.disabled) return;
    state.from = text(row.from || row.value);
    state.to = text(row.to);
    persistDraft(state);
    renderTime(state);
  }));
  host?.querySelector('[data-booking-time-next]')?.addEventListener('click', () => {
    if (state.from) go(state, { kind: 'consents' });
  });
}

function consentDocuments(state) {
  const active = activeConsentIds(state);
  return requiredBookingDocuments(state.context).filter((document) => !active.has(text(document?.id)));
}

function openConsentDocument(document = {}) {
  return openDocumentViewer({
    title: text(document?.title) || 'Документ',
    version: document?.version || 1,
    content: document?.content ?? document?.text ?? '',
  });
}

function renderConsents(state) {
  if (!state.legalResolved) {
    if (!state.legalLookup && !state.legalError) startLegalLookup(state);
    const hasError = Boolean(state.legalError);
    const host = renderFrame(state, {
      title: 'Согласия',
      body: hasError
        ? `<p class="form-error" role="alert">${escapeHtml(state.legalError)}</p>`
        : '<p class="booking-flow__legal-check">Проверяем действующие согласия…</p>',
      action: hasError ? actionBlock(button('Повторить', { data: 'data-booking-consents-retry' })) : '',
      back: state.history.length > 0,
    });
    host?.querySelector('[data-booking-consents-retry]')?.addEventListener('click', () => {
      startLegalLookup(state, { force: true });
      renderConsents(state);
    });
    return;
  }

  const documents = consentDocuments(state);
  if (!documents.length) {
    go(state, { kind: 'preview' }, { push: false });
    return;
  }

  const required = documents.filter((document) => document?.required && text(document?.id) !== 'messages-consent');
  const canContinue = required.every((document) => Boolean(state.consents[text(document?.id)]));
  const cards = documentTiles(documents.map((document) => {
    const id = text(document?.id);
    const marketing = id === 'messages-consent';
    return documentTile({
      title: marketing ? 'Согласие на получение рекламы' : text(document?.title) || 'Согласие на обработку персональных данных',
      version: document?.version || 1,
      openData: `data-booking-document="${escapeHtml(id)}"`,
      toggleData: `data-booking-consent="${escapeHtml(id)}"`,
      toggleChecked: Boolean(state.consents[id]),
      toggleAria: marketing ? 'Согласие на получение рекламы' : 'Согласие на обработку персональных данных',
    });
  }), { layout: 'stack' });
  const host = renderFrame(state, {
    title: 'Согласия',
    body: cards,
    action: actionBlock(button('Далее', { data: 'data-booking-consents-next', disabled: !canContinue })),
    back: state.history.length > 0,
  });
  host?.querySelectorAll('[data-booking-document]').forEach((node) => node.addEventListener('click', () => {
    const document = documents.find((item) => text(item?.id) === text(node.dataset.bookingDocument));
    if (document) openConsentDocument(document);
  }));
  host?.querySelectorAll('[data-booking-consent]').forEach((node) => node.addEventListener('click', () => {
    const id = text(node.dataset.bookingConsent);
    state.consents[id] = !state.consents[id];
    persistDraft(state);
    renderConsents(state);
  }));
  host?.querySelector('[data-booking-consents-next]')?.addEventListener('click', () => {
    if (canContinue) go(state, { kind: 'preview' });
  });
}

function previewMarkup(state) {
  const participantBlocks = state.participants.map((participant) => {
    const procedures = selectedProcedures(state, participant);
    const phone = formatBookingPhone(participant.phone);
    const price = participantPrice(state, participant);
    return `<section class="booking-summary__participant">
      <strong>${escapeHtml(participant.name)}</strong>
      ${phone ? `<div>${escapeHtml(phone)}</div>` : ''}
      ${procedures.map((procedure) => `<div>${escapeHtml(text(procedure?.name))}</div>`).join('')}
      <div class="booking-summary__participant-cost">${escapeHtml(priceText(price))}</div>
    </section>`;
  }).join('');
  const total = state.participants.length > 1
    ? `<div><dt>Итого</dt><dd>${escapeHtml(priceText(totalPrice(state)))}</dd></div>`
    : '';
  const bookerPhone = formatBookingPhone(state.booker.phone);
  return `<div class="booking-summary">
    ${participantBlocks}
    <dl>
      <div><dt>Дата</dt><dd>${escapeHtml(formatDate(state.date))}</dd></div>
      <div><dt>Начало</dt><dd>${escapeHtml(state.from)}</dd></div>
      ${total}
    </dl>
    <section class="booking-summary__booker"><strong>${escapeHtml(state.booker.name)}</strong>${bookerPhone ? `<div>${escapeHtml(bookerPhone)}</div>` : ''}</section>
  </div>`;
}

function consentFacts(state) {
  const documents = requiredBookingDocuments(state.context);
  return documents.map((document) => ({
    documentId: text(document?.id),
    documentVersion: Math.max(1, Number(document?.version || 1)),
    accepted: Boolean(state.consents[text(document?.id)]),
  }));
}

async function confirmBooking(state, action) {
  if (!action || action.dataset.bookingBusy === 'true') return;
  action.dataset.bookingBusy = 'true';
  action.disabled = true;
  action.setAttribute('aria-busy', 'true');
  action.textContent = 'Записываем…';
  try {
    const result = await jsonRequest(
      `/online-booking/${encodeURIComponent(state.tenantId)}/confirm`,
      {
        method: 'POST',
        body: JSON.stringify({
          workplaceKey: state.workplaceKey,
          date: state.date,
          from: state.from,
          booker: state.booker,
          mode: state.mode,
          participants: state.participants.map((participant) => ({
            id: participant.id,
            name: participant.name,
            phone: participant.phone,
            email: participant.email,
            procedureIds: participant.procedureIds,
          })),
          consents: consentFacts(state),
        }),
      },
      'Не удалось подтвердить запись',
    );
    state.result = result;
    clearDraft();
    state.history = [];
    state.current = { kind: 'success', index: 0 };
    state.exited = false;
    renderCurrent(state);
  } catch (error) {
    const message = text(error?.message);
    if (Number(error?.status) === 409 && /соглас/i.test(message)) {
      await startLegalLookup(state, { force: true });
      state.current = { kind: 'consents', index: 0 };
      state.history = state.history.filter((step) => step.kind !== 'preview');
      state.exited = false;
      persistDraft(state, false);
      openNotice({ title: 'Нужно согласие', message: message || 'Подтвердите актуальное согласие.' });
      renderCurrent(state);
      return;
    }
    if (Number(error?.status) === 409) {
      await refreshContext(state).catch(() => {});
      state.from = '';
      state.to = '';
      state.current = { kind: 'time', index: 0 };
      state.history = state.history.filter((step) => !['time', 'consents', 'preview'].includes(step.kind));
      persistDraft(state);
      openNotice({ title: 'Время недоступно', message: message || 'Выбранное время уже занято. Выберите другое.' });
      renderCurrent(state);
      return;
    }
    openNotice({ title: 'Не удалось подтвердить запись', message: message || 'Попробуйте ещё раз.' });
    if (action?.isConnected) {
      delete action.dataset.bookingBusy;
      action.disabled = false;
      action.removeAttribute('aria-busy');
      action.textContent = 'Подтвердить запись';
    }
  }
}

function renderPreview(state) {
  const host = renderFrame(state, {
    title: 'Запись',
    body: previewMarkup(state),
    action: actionBlock(button('Подтвердить запись', { data: 'data-booking-confirm' })),
    back: state.history.length > 0,
  });
  host?.querySelector('[data-booking-confirm]')?.addEventListener('click', (event) => {
    void confirmBooking(state, event.currentTarget);
  });
}

function openApplication(state) {
  if (typeof state.onExitToAccount === 'function') {
    state.onExitToAccount({ tab: 'journal' });
    return;
  }
  location.assign('/');
}

function renderExit(state) {
  const host = renderFrame(state, {
    title: 'Запись не оформлена',
    body: '<p>Вы можете продолжить запись сейчас или вернуться к ней позже.</p>',
    action: actionBlock(`${button('Продолжить запись', { data: 'data-booking-resume' })}${button('Открыть приложение', { variant: 'secondary', data: 'data-booking-open-app' })}`),
    back: false,
  });
  host?.querySelector('[data-booking-resume]')?.addEventListener('click', () => {
    state.current = cloneStep(state.resumeStep || { kind: 'workplace' });
    state.exited = false;
    persistDraft(state, false);
    renderCurrent(state);
  });
  host?.querySelector('[data-booking-open-app]')?.addEventListener('click', () => openApplication(state));
}

function renderSuccess(state) {
  const host = renderFrame(state, {
    title: 'Запись подтверждена',
    body: `${previewMarkup(state)}<p class="booking-flow__app-note">В приложении можно видеть свои записи и управлять ими.</p>`,
    action: actionBlock(button('Открыть приложение', { variant: 'secondary', data: 'data-booking-open-app' })),
    back: false,
  });
  host?.querySelector('[data-booking-open-app]')?.addEventListener('click', () => openApplication(state));
}

function renderCurrent(state) {
  if (!state.layer?.isConnected) return;
  if (state.current.kind === 'workplace') renderWorkplace(state);
  else if (state.current.kind === 'mode') renderMode(state);
  else if (state.current.kind === 'data') renderData(state);
  else if (state.current.kind === 'services') renderServices(state);
  else if (state.current.kind === 'date') renderDate(state);
  else if (state.current.kind === 'time') renderTime(state);
  else if (state.current.kind === 'consents') renderConsents(state);
  else if (state.current.kind === 'preview') renderPreview(state);
  else if (state.current.kind === 'exit') renderExit(state);
  else if (state.current.kind === 'success') renderSuccess(state);
}

function initialStep(state) {
  const workplaces = Array.isArray(state.context?.workplaces) ? state.context.workplaces : [];
  if (state.lockedWorkplaceKey) {
    state.workplaceKey = state.lockedWorkplaceKey;
    return { kind: 'mode', index: 0 };
  }
  if (workplaces.length === 1) {
    state.workplaceKey = text(workplaces[0]?.key);
    return { kind: 'mode', index: 0 };
  }
  return { kind: 'workplace', index: 0 };
}

export async function renderAccess(root, {
  tenantId = '',
  workplaceKey = '',
  procedureIds = [],
  onExitToAccount = null,
} = {}) {
  const state = {
    tenantId: text(tenantId),
    lockedWorkplaceKey: text(workplaceKey),
    repeatProcedureIds: [...new Set((Array.isArray(procedureIds) ? procedureIds : []).map(text).filter(Boolean))],
    context: {},
    settings: normalizeBookingSettings(),
    workplaceKey: '',
    mode: '',
    booker: { name: '', phone: '', email: '' },
    participants: [],
    participantSequence: 0,
    date: '',
    from: '',
    to: '',
    consents: {},
    legalState: {},
    legalResolved: false,
    legalLookup: null,
    legalLookupToken: 0,
    legalPhone: '',
    legalError: '',
    current: { kind: 'workplace', index: 0 },
    resumeStep: { kind: 'workplace', index: 0 },
    history: [],
    exited: false,
    result: null,
    layer: null,
    hardClose: null,
    onExitToAccount: typeof onExitToAccount === 'function' ? onExitToAccount : null,
  };

  if (!state.tenantId) {
    root.innerHTML = emptyState('Ссылка недействительна', 'В ссылке отсутствует идентификатор онлайн-записи.');
    return () => {};
  }

  root.innerHTML = '';
  try {
    await refreshContext(state);
  } catch (error) {
    root.innerHTML = emptyState('Запись недоступна', text(error?.message) || 'Не удалось открыть онлайн-запись.');
    return () => {};
  }

  const workplaces = Array.isArray(state.context?.workplaces) ? state.context.workplaces : [];
  if (!workplaces.length) {
    root.innerHTML = emptyState('Запись недоступна', 'Рабочие пространства не настроены.');
    return () => {};
  }

  const restored = restoreDraft(state);
  if (!restored) {
    state.current = initialStep(state);
    state.resumeStep = cloneStep(state.current);
    setMode(state, MODE_SELF);
    state.mode = '';
  } else if (state.booker.phone) {
    startLegalLookup(state);
  }

  const layer = mountModal(document.body, modal('<div data-booking-flow></div>', {
    variant: 'technical',
    surface: 'app',
    title: 'Запись',
    className: 'booking-technical-modal',
  }));
  if (!layer) {
    root.innerHTML = emptyState('Запись недоступна', 'Не удалось открыть интерфейс записи.');
    return () => {};
  }
  state.layer = layer;
  state.hardClose = layer.v2Close?.bind(layer) || (() => layer.remove());
  layer.v2Close = () => showExit(state);

  if (state.exited) state.current = { kind: 'exit', index: 0 };
  persistDraft(state, state.exited);
  renderCurrent(state);

  return () => {
    if (state.layer?.isConnected) state.hardClose?.();
  };
}
