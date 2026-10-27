import { getAccount, getAccountToken } from '../core/account/index.js';
import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import { API_BASE } from '../core/environment.js';
import {
  button,
  durationText,
  field,
  formValidationMessage,
  initCalendar,
  openNotice,
  openRecordCreationOwner,
  phoneField,
  recordCreationTimeRows,
  recordProcedureList,
  v2ListEntry,
  v2ListEntries,
} from '../ui/ui.js';
import {
  bookingProcedureCost,
  getBookingProcedures,
  getBookingSlots,
  getBookingTimeRows,
  getBookingWorkingDates,
} from './model.js';

const MODE_SELF = 'self';
const MODE_OTHER = 'other';
const MODE_JOINT = 'joint';

function text(value) {
  return String(value ?? '').trim();
}

function accountName(account = {}) {
  return [account?.name, account?.surname].map(text).filter(Boolean).join(' ') || 'Пользователь';
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function newParticipant(id, source = {}) {
  return {
    id: text(id),
    name: text(source.name),
    phone: text(source.phone),
    email: text(source.email),
    procedureIds: Array.isArray(source.procedureIds) ? [...new Set(source.procedureIds.map(text).filter(Boolean))] : [],
  };
}

function selfParticipant(state, procedureIds = []) {
  return newParticipant('booker', {
    name: accountName(state.account),
    phone: state.account?.phone,
    email: state.account?.email,
    procedureIds,
  });
}

function relationshipTitle(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [profile.name, profile.surname].map(text).filter(Boolean).join(' ') || 'Профиль';
}

function relationshipSearchText(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [relationshipTitle(relationship), profile.profession, profile.phone]
    .map(text)
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru');
}

function workplaceRows(workplaces = [], selected = '') {
  return v2ListEntries(workplaces.map((workplace) => v2ListEntry({
    title: text(workplace?.name) || 'Рабочее пространство',
    subtitle: [workplace?.city, workplace?.address].map(text).filter(Boolean).join(', '),
    interactive: true,
    selected: text(workplace?.key) === text(selected),
    data: `data-account-booking-workplace="${text(workplace?.key)}"`,
    aria: `Выбрать рабочее пространство ${text(workplace?.name)}`,
  })));
}

function procedureMap(state) {
  return new Map(getBookingProcedures(state.context, state.workplaceKey)
    .map((procedure) => [text(procedure?.id), procedure]));
}

function participantDuration(state, participant) {
  const procedures = procedureMap(state);
  return participant.procedureIds.reduce((sum, id) => sum + Math.max(0, Number(procedures.get(id)?.duration) || 0), 0);
}

function totalDuration(state) {
  return state.participants.reduce((sum, participant) => sum + participantDuration(state, participant), 0);
}

function selectedProcedureNames(state, participant) {
  const procedures = procedureMap(state);
  return participant.procedureIds.map((id) => text(procedures.get(id)?.name)).filter(Boolean);
}

async function confirmAccountBooking(state) {
  const token = getAccountToken();
  const response = await fetch(`${API_BASE}/online-booking/${encodeURIComponent(state.tenantId)}/account/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      workplaceKey: state.workplaceKey,
      date: state.date,
      from: state.from,
      mode: state.mode,
      participants: state.participants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        phone: participant.phone,
        email: participant.email,
        procedureIds: participant.procedureIds,
      })),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(text(payload?.message) || 'Не удалось подтвердить запись.');
  return payload;
}

export async function openAccountBookingFlow({
  tenantId = '',
  workplaceKey = '',
  procedureIds = [],
  creationOwner = null,
  onCreated = async () => {},
} = {}) {
  const owner = creationOwner || openRecordCreationOwner();
  if (!owner) return null;

  const state = {
    tenantId: text(tenantId),
    workplaceKey: text(workplaceKey),
    preselectedProcedureIds: [...new Set((Array.isArray(procedureIds) ? procedureIds : []).map(text).filter(Boolean))],
    context: {},
    account: null,
    settings: normalizeBookingSettings(),
    mode: '',
    participants: [],
    date: '',
    from: '',
    to: '',
    sourceHadTenant: Boolean(text(tenantId)),
  };

  const renderView = ({ step, title, body, action = null, secondaryActions = [], back = null }) => {
    owner.setBackHandler?.(back ? () => {
      back();
      return true;
    } : null);
    return owner.render({ step, title, body, action, secondaryActions });
  };

  const closeOrProfessionals = () => {
    if (state.sourceHadTenant) owner.close();
    else void renderProfessionals();
  };

  const renderMode = () => {
    const rows = v2ListEntries([
      { value: MODE_SELF, label: 'Записать себя' },
      { value: MODE_OTHER, label: 'Записать другого человека' },
      { value: MODE_JOINT, label: 'Совместная запись' },
    ].map((option) => v2ListEntry({
      title: option.label,
      interactive: true,
      selected: state.mode === option.value,
      data: `data-account-booking-mode="${option.value}"`,
      aria: option.label,
    })));
    const view = renderView({
      step: 'person',
      title: 'Кого записываем',
      body: rows,
      back: state.context.workplaces?.length > 1 ? renderWorkplaces : closeOrProfessionals,
    });
    view?.body?.querySelectorAll('[data-account-booking-mode]').forEach((node) => node.addEventListener('click', () => {
      state.mode = text(node.dataset.accountBookingMode);
      const self = selfParticipant(state, state.preselectedProcedureIds);
      if (state.mode === MODE_SELF) state.participants = [self];
      else if (state.mode === MODE_OTHER) state.participants = [newParticipant('recipient-1', { procedureIds: state.preselectedProcedureIds })];
      else state.participants = [self, newParticipant('recipient-1')];
      if (state.mode === MODE_SELF) renderServices(0);
      else renderParticipantData();
    }));
  };

  const syncParticipantData = (form) => {
    if (!form) return '';
    const validation = formValidationMessage(form);
    if (validation) return validation;
    const data = new FormData(form);
    const extras = state.mode === MODE_JOINT ? state.participants.slice(1) : state.participants;
    extras.forEach((participant, index) => {
      participant.name = text(data.get(`participantName${index}`));
      participant.phone = text(data.get(`participantPhone${index}`));
      participant.email = text(data.get(`participantEmail${index}`));
    });
    return extras.some((participant) => !participant.name) ? 'Укажите имя каждого участника.' : '';
  };

  const renderParticipantData = (errorMessage = '') => {
    const extras = state.mode === MODE_JOINT ? state.participants.slice(1) : state.participants;
    const body = `<form data-account-booking-participants>
      ${extras.map((participant, index) => `<section class="booking-participant" data-account-booking-participant="${index}">
        <div class="booking-participant__heading"><strong>Участник ${index + 1}</strong>${state.mode === MODE_JOINT && extras.length > 1 ? button('Удалить', { variant: 'secondary', data: `data-account-booking-remove="${index}"` }) : ''}</div>
        ${field({ label: 'Имя', name: `participantName${index}`, value: participant.name, required: true, autocomplete: 'given-name' })}
        ${phoneField({ label: 'Телефон', name: `participantPhone${index}`, value: participant.phone, required: false })}
        ${field({ label: 'Email', name: `participantEmail${index}`, value: participant.email, type: 'email', required: false, autocomplete: 'email' })}
      </section>`).join('')}
      ${state.mode === MODE_JOINT ? button('Добавить участника', { variant: 'secondary', data: 'data-account-booking-add' }) : ''}
      ${errorMessage ? `<p class="form-error" role="alert">${text(errorMessage)}</p>` : ''}
    </form>`;
    const view = renderView({
      step: 'person',
      title: 'Данные участников',
      body,
      action: { label: 'Далее', data: 'data-account-booking-participants-next' },
      back: renderMode,
    });
    const form = view?.body?.querySelector('[data-account-booking-participants]');
    view?.body?.querySelector('[data-account-booking-add]')?.addEventListener('click', () => {
      syncParticipantData(form);
      state.participants.push(newParticipant(`recipient-${state.participants.length + 1}`));
      renderParticipantData();
    });
    view?.body?.querySelectorAll('[data-account-booking-remove]').forEach((node) => node.addEventListener('click', () => {
      syncParticipantData(form);
      const index = Math.max(0, Number(node.dataset.accountBookingRemove) || 0);
      const self = state.mode === MODE_JOINT ? state.participants[0] : null;
      const remaining = extras.filter((_, itemIndex) => itemIndex !== index);
      state.participants = self ? [self, ...remaining] : remaining;
      renderParticipantData();
    }));
    view?.layer?.querySelector('[data-account-booking-participants-next]')?.addEventListener('click', () => {
      const error = syncParticipantData(form);
      if (error) {
        renderParticipantData(error);
        return;
      }
      renderServices(0);
    });
  };

  const renderServices = (index = 0) => {
    const participant = state.participants[index];
    if (!participant) return;
    const procedures = getBookingProcedures(state.context, state.workplaceKey);
    const body = recordProcedureList(procedures.map((procedure) => ({
      id: text(procedure?.id),
      name: text(procedure?.name),
      durationText: durationText(procedure?.duration || 0),
      costText: bookingProcedureCost(procedure, state.workplaceKey) !== '' ? `${bookingProcedureCost(procedure, state.workplaceKey)} ₽` : '',
    })), {
      data: 'data-account-booking-procedure',
      selected: participant.procedureIds,
      empty: 'Услуги не настроены.',
    });
    const view = renderView({
      step: 'procedures',
      title: `Выбор услуг — ${participant.name || 'Участник'}`,
      body,
      action: { label: 'Далее', data: 'data-account-booking-services-next', disabled: !participant.procedureIds.length },
      back: index > 0 ? () => renderServices(index - 1) : (state.mode === MODE_SELF ? renderMode : renderParticipantData),
    });
    view?.body?.querySelectorAll('[data-account-booking-procedure]').forEach((node) => node.addEventListener('click', () => {
      const id = text(node.dataset.accountBookingProcedure);
      const selected = new Set(participant.procedureIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      participant.procedureIds = [...selected];
      state.date = '';
      state.from = '';
      state.to = '';
      renderServices(index);
    }));
    view?.layer?.querySelector('[data-account-booking-services-next]')?.addEventListener('click', () => {
      if (!participant.procedureIds.length) return;
      if (index + 1 < state.participants.length) renderServices(index + 1);
      else renderDates();
    });
  };

  const availableDates = () => {
    const duration = totalDuration(state);
    if (duration <= 0) return [];
    return getBookingWorkingDates(state.context, state.workplaceKey).filter((date) => getBookingSlots(state.context, {
      workplaceKey: state.workplaceKey,
      date,
      duration,
      step: state.settings.slotStep,
    }).length > 0);
  };

  const renderDates = () => {
    const dates = availableDates();
    const view = renderView({
      step: 'date',
      title: 'Выбор даты',
      body: dates.length ? '<div data-account-booking-calendar></div>' : '<div class="muted">Доступных дат нет.</div>',
      back: () => renderServices(Math.max(0, state.participants.length - 1)),
    });
    const calendar = view?.body?.querySelector('[data-account-booking-calendar]');
    if (!calendar) return;
    initCalendar(calendar, {
      workingDates: dates,
      selectedValue: state.date,
      onDateSelect: (date) => {
        if (!dates.includes(date)) return;
        state.date = date;
        state.from = '';
        state.to = '';
        renderTimes();
      },
    });
  };

  const renderTimes = () => {
    const duration = totalDuration(state);
    const rows = getBookingTimeRows(state.context, {
      workplaceKey: state.workplaceKey,
      date: state.date,
      duration,
      step: state.settings.slotStep,
    });
    const view = renderView({
      step: 'time',
      title: 'Выбор времени',
      body: recordCreationTimeRows(rows, {
        data: 'data-account-booking-time',
        selected: state.from,
        empty: 'Свободного времени нет.',
      }),
      back: renderDates,
    });
    view?.body?.querySelectorAll('[data-account-booking-time]').forEach((node) => node.addEventListener('click', () => {
      const from = text(node.dataset.accountBookingTime || node.dataset.value);
      const row = rows.find((item) => text(item?.from || item?.value) === from);
      if (!row || row.available === false || row.disabled) return;
      state.from = text(row.from || row.value);
      state.to = text(row.to);
      renderConfirmation();
    }));
  };

  const renderConfirmation = () => {
    const workplace = (Array.isArray(state.context.workplaces) ? state.context.workplaces : [])
      .find((item) => text(item?.key) === state.workplaceKey) || {};
    const participantRows = state.participants.map((participant) => v2ListEntry({
      title: participant.name || 'Участник',
      subtitle: selectedProcedureNames(state, participant).join(' · '),
      rightBottom: `${participantDuration(state, participant)} мин`,
    }));
    const summary = v2ListEntries([
      v2ListEntry({ title: text(workplace?.name) || 'Рабочее пространство', subtitle: `${state.date} · ${state.from}` }),
      ...participantRows,
    ]);
    const view = renderView({
      step: 'confirmation',
      title: 'Подтверждение записи',
      body: summary,
      action: { label: 'Подтвердить', data: 'data-account-booking-confirm' },
      back: renderTimes,
    });
    view?.layer?.querySelector('[data-account-booking-confirm]')?.addEventListener('click', async (event) => {
      const action = event.currentTarget;
      if (action.disabled) return;
      action.disabled = true;
      try {
        const result = await confirmAccountBooking(state);
        owner.commit();
        await onCreated(result);
      } catch (error) {
        action.disabled = false;
        openNotice({ title: 'Не удалось подтвердить запись', message: text(error?.message) || 'Не удалось подтвердить запись.' });
      }
    });
  };

  const renderWorkplaces = () => {
    const workplaces = Array.isArray(state.context.workplaces) ? state.context.workplaces : [];
    const view = renderView({
      step: 'workplace',
      title: 'Выбор пространства',
      body: workplaceRows(workplaces, state.workplaceKey),
      back: closeOrProfessionals,
    });
    view?.body?.querySelectorAll('[data-account-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
      state.workplaceKey = text(node.dataset.accountBookingWorkplace);
      state.preselectedProcedureIds = state.preselectedProcedureIds.filter((id) => getBookingProcedures(state.context, state.workplaceKey)
        .some((procedure) => text(procedure?.id) === id));
      renderMode();
    }));
  };

  const openTenant = async (id) => {
    state.tenantId = text(id);
    if (!state.tenantId || !owner.isOpen()) return;
    try {
      const [context, account] = await Promise.all([
        import('./model.js').then(() => getAccountBookingContext(state.tenantId)),
        getAccount(state.tenantId),
      ]);
      if (!owner.isOpen()) return;
      state.context = context;
      state.account = account;
      state.settings = normalizeBookingSettings(context?.settings);
      const workplaces = Array.isArray(context?.workplaces) ? context.workplaces : [];
      if (!workplaces.length) {
        openNotice({ title: 'Запись недоступна', message: 'Рабочие пространства не настроены.' });
        return;
      }
      const requested = text(state.workplaceKey);
      if (requested && workplaces.some((item) => text(item?.key) === requested)) {
        state.workplaceKey = requested;
        renderMode();
      } else if (workplaces.length === 1) {
        state.workplaceKey = text(workplaces[0]?.key);
        renderMode();
      } else {
        state.workplaceKey = '';
        renderWorkplaces();
      }
    } catch (error) {
      openNotice({ title: 'Запись недоступна', message: text(error?.message) || 'Не удалось открыть запись.' });
    }
  };

  const renderProfessionals = async () => {
    const view = renderView({
      step: 'person',
      title: 'Выбор специалиста',
      body: '<div data-account-booking-professionals><div class="muted">Загрузка…</div></div>',
      back: null,
    });
    const host = view?.body?.querySelector('[data-account-booking-professionals]');
    if (!host) return;
    try {
      const relationships = await getGlobalAccountBookingTargets();
      if (!owner.isOpen()) return;
      const rows = (Array.isArray(relationships) ? relationships : []).filter((relationship) => text(relationship?.tenantId));
      const renderList = (query = '') => {
        const needle = text(query).toLocaleLowerCase('ru');
        const filtered = rows.filter((relationship) => !needle || relationshipSearchText(relationship).includes(needle));
        host.innerHTML = `${field({ name: 'accountBookingProfessionalSearch', type: 'search', placeholder: 'Поиск по имени или профессии', autocomplete: 'off', data: 'data-account-booking-professional-search' })}${v2ListEntries(filtered.map((relationship) => v2ListEntry({
          title: relationshipTitle(relationship),
          subtitle: text(relationship?.context?.profile?.profession),
          interactive: true,
          data: `data-account-booking-professional="${text(relationship?.tenantId)}"`,
          aria: `Выбрать специалиста ${relationshipTitle(relationship)}`,
        })))}${filtered.length ? '' : '<div class="muted">Специалистов пока нет.</div>'}`;
        host.querySelector('[data-account-booking-professional-search]')?.addEventListener('input', (event) => renderList(event.currentTarget.value));
        host.querySelectorAll('[data-account-booking-professional]').forEach((node) => node.addEventListener('click', () => void openTenant(node.dataset.accountBookingProfessional)));
      };
      renderList();
    } catch {
      host.innerHTML = '<div class="muted">Не удалось загрузить специалистов.</div>';
    }
  };

  async function getAccountBookingContext(id) {
    const module = await import('../core/account/index.js');
    return module.getBookingContext(id);
  }

  if (state.tenantId) void openTenant(state.tenantId);
  else void renderProfessionals();
  return owner;
}
