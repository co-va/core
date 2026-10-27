import { accountErrorMessage, createBookingRequest, getAccount, getBookingContext } from '../core/account/index.js';
import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import { openRecords } from '../core/records/records.js';
import {
  button,
  durationText,
  escapeHtml,
  field,
  formValidationMessage,
  initMultiSelect,
  openNotice,
  openRecordCreationOwner,
  recordPersonList,
  recordProcedureList,
  v2ListEntry,
  v2ListEntries,
} from '../ui/ui.js';
import { renderGlobalClient } from './booking.js';
import {
  bookingProcedureCost,
  bookingProcedurePrice,
  getBookingProcedures,
  getBookingSlots,
  getBookingTimeRows,
  getBookingWorkingDates,
} from './model.js';

const app = document.querySelector('#app');
const MODE_SELF = 'self';
const MODE_OTHER = 'other';
const MODE_JOINT = 'joint';
let disposeView = () => {};

function text(value) {
  return String(value ?? '').trim();
}

function money(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function priceText(price = {}) {
  return `${price.variable ? 'от ' : ''}${money(price.minimum)}`;
}

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(value || '');
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1] || match[2]}`;
}

function syncViewport() {
  const vv = window.visualViewport;
  const height = vv?.height || window.innerHeight;
  const width = vv?.width || window.innerWidth;
  document.documentElement.style.setProperty('--visual-vh', `${height}px`);
  document.documentElement.style.setProperty('--visual-vw', `${width}px`);
  document.documentElement.classList.toggle('keyboard-open', vv ? height < window.innerHeight * 0.78 : false);
}

function setThemeColor(value) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', value);
}

function relationshipTitle(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [profile.name, profile.surname].filter(Boolean).join(' ').trim() || 'Профиль';
}

function relationshipSearchText(relationship = {}) {
  const profile = relationship?.context?.profile || {};
  return [relationshipTitle(relationship), profile.profession, profile.phone]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase('ru');
}

function accountBookingProfessionalList(relationships = [], query = '') {
  const needle = String(query || '').trim().toLocaleLowerCase('ru');
  const filtered = (Array.isArray(relationships) ? relationships : [])
    .filter((relationship) => String(relationship?.tenantId || '').trim())
    .filter((relationship) => !needle || relationshipSearchText(relationship).includes(needle));
  return recordPersonList(filtered.map((relationship) => {
    const profile = relationship?.context?.profile || {};
    const title = relationshipTitle(relationship);
    return {
      key: String(relationship.tenantId || ''),
      name: title,
      uei: String(profile.profession || ''),
      phone: String(profile.phone || ''),
      aria: `Выбрать специалиста ${title}`,
    };
  }), {
    data: 'data-account-booking-professional',
    empty: needle ? 'Специалисты не найдены.' : 'Специалистов пока нет.',
  });
}

function accountDisplayName(account = {}) {
  return [account?.name, account?.surname]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    || 'Пользователь';
}

function accountDiscount(account = {}) {
  const value = Number(account?.discountPercent || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function numericCost(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function workplaceRows(context = {}, workplaces = []) {
  return v2ListEntries(workplaces.map((workplace) => {
    const workplaceKey = String(workplace?.key || '');
    const available = getBookingWorkingDates(context, workplaceKey).length > 0;
    return v2ListEntry({
      title: String(workplace?.name || '').trim() || 'Рабочее пространство',
      subtitle: [workplace?.city, workplace?.address].map((value) => String(value || '').trim()).filter(Boolean).join(', '),
      interactive: available,
      data: available ? `data-account-booking-workplace="${workplaceKey}"` : '',
      aria: available ? `Выбрать рабочее пространство ${String(workplace?.name || '').trim()}` : '',
    });
  }));
}

async function renderGlobalClientRoot(initial = {}) {
  disposeView();
  disposeView = () => {};
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');
  app.innerHTML = `<main class="booking-content" id="app-content">
    <section class="v2-sticker-screen" data-startup-loading aria-live="polite" aria-busy="true">
      <article class="v2-sticker">
        <h1 class="v2-sticker__title">Загрузка…</h1>
      </article>
    </section>
  </main>`;
  await renderGlobalClient(document.querySelector('#app-content'), initial);
  syncViewport();
}

function newParticipant(id, source = {}) {
  return {
    id: text(id),
    name: text(source.name),
    surname: text(source.surname),
    phone: text(source.phone),
    email: text(source.email),
    uei: text(source.uei),
    procedures: Array.isArray(source.procedures) ? source.procedures.map((entry) => ({ ...entry })) : [],
  };
}

function participantFields(participant, index, { removable = false } = {}) {
  return `<section class="booking-participant" data-account-booking-participant="${index}">
    <div class="booking-participant__heading"><strong>Участник ${index + 1}</strong>${removable ? button('Удалить', { variant: 'secondary', data: `data-account-booking-remove-participant="${index}"` }) : ''}</div>
    ${field({ label: 'Имя', name: `participantName${index}`, value: participant.name, required: true, autocomplete: 'given-name' })}
    ${field({ label: 'Телефон', name: `participantPhone${index}`, value: participant.phone, type: 'tel', required: false, autocomplete: 'tel', inputmode: 'tel' })}
    ${field({ label: 'Email', name: `participantEmail${index}`, value: participant.email, type: 'email', required: false, autocomplete: 'email' })}
  </section>`;
}

function procedureEntry(procedure, workplaceKey) {
  return {
    id: String(procedure?.id || ''),
    name: String(procedure?.name || ''),
    cost: bookingProcedureCost(procedure, workplaceKey),
    duration: Math.max(0, Number(procedure?.duration) || 0),
    raw: procedure,
  };
}

function proceduresPrice(procedures = [], workplaceKey = '') {
  return procedures.reduce((summary, procedure) => {
    const price = bookingProcedurePrice(procedure?.raw || procedure, workplaceKey);
    summary.minimum += Math.max(0, Number(price?.minimum) || 0);
    summary.variable = summary.variable || Boolean(price?.variable);
    return summary;
  }, { minimum: 0, variable: false });
}

async function startJournalBooking(tenantId, creationOwner) {
  const id = String(tenantId || '').trim();
  if (!id || !creationOwner?.isOpen?.()) return;

  const accountResultPromise = getAccount(id)
    .then((account) => ({ account, error: null }))
    .catch((error) => ({ account: null, error }));

  let context;
  try {
    context = await getBookingContext(id);
  } catch (error) {
    openNotice({ title: 'Запись недоступна', message: accountErrorMessage(error, 'Не удалось открыть запись.') });
    return;
  }
  if (!creationOwner.isOpen()) return;

  let bookingContext = context && typeof context === 'object' ? context : {};
  const workplaces = Array.isArray(bookingContext.workplaces) ? bookingContext.workplaces : [];
  if (!workplaces.length) {
    openNotice({ title: 'Запись недоступна', message: 'Рабочие пространства не настроены.' });
    return;
  }
  const settings = normalizeBookingSettings(bookingContext.settings);
  let account = null;
  let mode = '';
  let participants = [];
  let activeWorkplaceKey = '';
  let participantProcedureController = null;

  const destroyParticipantProcedureController = () => {
    participantProcedureController?.destroy?.();
    participantProcedureController = null;
  };

  const resolveAccount = async () => {
    if (account) return account;
    const result = await accountResultPromise;
    if (result.error) throw result.error;
    account = result.account;
    if (!account) throw new Error('Account is unavailable');
    return account;
  };

  const confirmationMarkup = (recordsState = {}) => {
    const summaryParticipants = mode === MODE_SELF
      ? [{ ...participants[0], procedures: Array.isArray(recordsState.procedures) ? recordsState.procedures : [] }]
      : participants;
    const blocks = summaryParticipants.map((participant) => {
      const procedures = Array.isArray(participant?.procedures) ? participant.procedures : [];
      const price = proceduresPrice(procedures, activeWorkplaceKey);
      return `<section class="booking-summary__participant">
        <strong>${escapeHtml(text(participant?.name) || 'Участник')}</strong>
        ${text(participant?.phone) ? `<div>${escapeHtml(text(participant.phone))}</div>` : ''}
        ${procedures.map((procedure) => `<div>${escapeHtml(text(procedure?.name))}</div>`).join('')}
        <div class="booking-summary__participant-cost">${escapeHtml(priceText(price))}</div>
      </section>`;
    }).join('');
    const total = summaryParticipants.length > 1
      ? proceduresPrice(summaryParticipants.flatMap((participant) => Array.isArray(participant?.procedures) ? participant.procedures : []), activeWorkplaceKey)
      : null;
    return `<div class="booking-summary">
      ${blocks}
      <dl>
        <div><dt>Дата</dt><dd>${escapeHtml(formatDate(recordsState.date))}</dd></div>
        <div><dt>Начало</dt><dd>${escapeHtml(text(recordsState.from))}</dd></div>
        ${total ? `<div><dt>Итого</dt><dd>${escapeHtml(priceText(total))}</dd></div>` : ''}
      </dl>
    </div>`;
  };

  const ownerRender = creationOwner.render.bind(creationOwner);
  creationOwner.render = (config = {}) => {
    const confirmation = config?.step === 'confirmation'
      && text(config?.action?.data).includes('data-records-confirm');
    if (!confirmation) return ownerRender(config);
    const recordsState = creationOwner.getRecordState?.() || {};
    return ownerRender({ ...config, body: confirmationMarkup(recordsState) });
  };

  const provider = {
    kind: 'online',
    workplaces: () => Array.isArray(bookingContext.workplaces) ? bookingContext.workplaces : [],
    workplaceId: (workplace) => String(workplace?.key || ''),
    workplaceName: (workplaceKey) => {
      const workplace = (Array.isArray(bookingContext.workplaces) ? bookingContext.workplaces : [])
        .find((item) => String(item?.key || '') === String(workplaceKey || ''));
      return String(workplace?.name || '').trim() || 'Рабочее пространство';
    },
    procedures: (workplaceKey) => getBookingProcedures(bookingContext, workplaceKey),
    procedureId: (procedure) => String(procedure?.id || ''),
    procedureName: (procedure) => String(procedure?.name || ''),
    procedureCost: (procedure, workplaceKey) => bookingProcedureCost(procedure, workplaceKey),
    procedureDuration: (procedure) => Math.max(0, Number(procedure?.duration) || 0),
    workingDates: (workplaceKey) => getBookingWorkingDates(bookingContext, workplaceKey),
    timeRows: ({ workplaceId, date, procedures }) => getBookingTimeRows(bookingContext, {
      workplaceKey: workplaceId,
      date,
      duration: procedures.reduce((sum, entry) => sum + Math.max(0, Number(entry?.duration) || 0), 0),
      step: settings.slotStep,
    }),
    personDisplay: (person = {}) => ({
      uei: String(person?.uei || person?.person?.uei || ''),
      name: [person?.name, person?.surname].filter(Boolean).join(' ').trim() || accountDisplayName(account),
      phone: String(person?.phone || person?.phones?.[0] || ''),
    }),
    discount: () => mode === MODE_SELF ? accountDiscount(account) : 0,
    total: (recordsState) => {
      const subtotal = recordsState.procedures.reduce((sum, entry) => sum + numericCost(entry.cost), 0);
      return mode === MODE_SELF
        ? Math.max(0, subtotal * (1 - accountDiscount(account) / 100))
        : subtotal;
    },
    async create(recordsState) {
      if (mode === MODE_OTHER || mode === MODE_JOINT) {
        return createBookingRequest(id, {
          workplaceKey: recordsState.workplaceId,
          date: recordsState.date,
          from: recordsState.from,
          mode,
          procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')).filter(Boolean),
          participants: participants.map((participant) => ({
            id: text(participant.id),
            name: text(participant.name),
            phone: text(participant.phone),
            email: text(participant.email),
            procedureIds: participant.procedures.map((entry) => text(entry?.id)).filter(Boolean),
          })),
        });
      }
      return createBookingRequest(id, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        from: recordsState.from,
        procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')).filter(Boolean),
      });
    },
    async onCreateError(error, recordsState, { renderTimes, renderConfirmation }) {
      bookingContext = await getBookingContext(id, recordsState.workplaceId).catch(() => bookingContext);
      const duration = recordsState.procedures.reduce((sum, entry) => sum + Math.max(0, Number(entry?.duration) || 0), 0);
      const stillAvailable = getBookingSlots(bookingContext, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        duration,
        step: settings.slotStep,
      }).some((slot) => String(slot.from || '') === String(recordsState.from || ''));
      if (!stillAvailable) {
        openNotice({ title: 'Запись недоступна', message: 'Выбранное время уже занято или стало недоступно. Выберите другое.' });
        renderTimes();
        return;
      }
      const message = accountErrorMessage(error, 'Не удалось подтвердить запись');
      openNotice({ title: 'Не удалось подтвердить запись', message });
      renderConfirmation();
    },
  };

  const showProfessionals = () => {
    if (!creationOwner.isOpen()) return false;
    void openAccountBookingProfessionalSelector(creationOwner);
    return true;
  };

  const selfParticipant = (resolvedAccount) => newParticipant('booker', {
    name: accountDisplayName(resolvedAccount),
    phone: resolvedAccount?.phone,
    email: resolvedAccount?.email,
    uei: resolvedAccount?.uei || resolvedAccount?.person?.uei,
  });

  const syncParticipantForm = (form, { validate = false } = {}) => {
    if (!form) return '';
    if (validate) {
      const error = formValidationMessage(form);
      if (error) return error;
    }
    const data = new FormData(form);
    const extras = mode === MODE_JOINT ? participants.filter((participant) => participant.id !== 'booker') : participants;
    extras.forEach((participant, index) => {
      participant.name = text(data.get(`participantName${index}`));
      participant.phone = text(data.get(`participantPhone${index}`));
      participant.email = text(data.get(`participantEmail${index}`));
    });
    return '';
  };

  const openCanonicalRecords = async ({ preselected = false } = {}) => {
    if (!creationOwner.isOpen()) return;
    const resolvedAccount = await resolveAccount();
    const initialProcedures = preselected
      ? participants.flatMap((participant) => participant.procedures.map((entry) => ({ ...entry })))
      : [];
    destroyParticipantProcedureController();
    openRecords({
      context: 'online',
      person: resolvedAccount,
      workplaceId: activeWorkplaceKey,
      procedures: initialProcedures,
      professionalActions: false,
      provider,
      creationOwner,
      stepBack: true,
      onBackFromStart: () => {
        if (mode === MODE_SELF) {
          mode = '';
          participants = [];
          return renderMode();
        }
        const lastIndex = Math.max(0, participants.length - 1);
        return renderParticipantProcedures(lastIndex);
      },
      onCreated: async (result) => {
        await renderGlobalClientRoot({
          tab: 'journal',
          journalDate: String(result?.date || ''),
        });
        const confirmedDate = formatDate(result?.date);
        const confirmedTime = text(result?.from);
        openNotice({
          title: 'Запись подтверждена',
          message: confirmedDate && confirmedTime
            ? `Запись на ${confirmedDate} в ${confirmedTime} подтверждена.`
            : 'Запись подтверждена.',
        });
      },
    });
  };

  const renderParticipantProcedures = (participantIndex = 0) => {
    if (!creationOwner.isOpen()) return false;
    const index = Math.max(0, Math.min(Number(participantIndex) || 0, Math.max(0, participants.length - 1)));
    const participant = participants[index];
    if (!participant) return false;
    destroyParticipantProcedureController();
    const available = getBookingProcedures(bookingContext, activeWorkplaceKey);
    const selected = new Map((participant.procedures || []).map((entry) => [String(entry.id || ''), entry]));

    const render = () => {
      const body = recordProcedureList(available.map((procedure) => ({
        id: String(procedure?.id || ''),
        name: String(procedure?.name || ''),
        durationText: durationText(Math.max(0, Number(procedure?.duration) || 0)),
        costText: bookingProcedureCost(procedure, activeWorkplaceKey) !== ''
          ? `${bookingProcedureCost(procedure, activeWorkplaceKey)} ₽`
          : '',
      })), {
        data: 'data-account-booking-procedure',
        selected: [...selected.keys()],
        empty: 'Для этого рабочего пространства процедуры не настроены.',
      });
      creationOwner.setBackHandler?.(() => {
        if (index > 0) return renderParticipantProcedures(index - 1);
        return renderParticipantData();
      });
      const view = creationOwner.render({
        step: 'procedures',
        title: `Выбор услуг — ${participant.name || `Участник ${index + 1}`}`,
        body,
        action: { label: 'Далее', data: 'data-account-booking-procedures-next', disabled: selected.size === 0 },
      });
      participantProcedureController = initMultiSelect(view?.body, {
        selectedValues: [...selected.keys()],
        selector: '[data-account-booking-procedure]',
        valueAttribute: 'accountBookingProcedure',
        onChange: (values) => {
          const next = new Map();
          values.forEach((procedureId) => {
            const raw = available.find((item) => String(item?.id || '') === String(procedureId));
            if (raw) next.set(String(procedureId), selected.get(String(procedureId)) || procedureEntry(raw, activeWorkplaceKey));
          });
          selected.clear();
          next.forEach((value, key) => selected.set(key, value));
          participant.procedures = [...selected.values()];
          const nextButton = view?.layer?.querySelector('[data-account-booking-procedures-next]');
          if (nextButton) nextButton.disabled = selected.size === 0;
        },
      });
      view?.layer?.querySelector('[data-account-booking-procedures-next]')?.addEventListener('click', () => {
        if (!selected.size) return;
        participant.procedures = [...selected.values()];
        if (index + 1 < participants.length) {
          renderParticipantProcedures(index + 1);
          return;
        }
        void openCanonicalRecords({ preselected: true });
      });
    };

    render();
    return true;
  };

  const renderParticipantData = (errorMessage = '') => {
    if (!creationOwner.isOpen()) return false;
    destroyParticipantProcedureController();
    const extras = mode === MODE_JOINT ? participants.filter((participant) => participant.id !== 'booker') : participants;
    const body = `<form data-account-booking-participant-form>
      ${extras.map((participant, index) => participantFields(participant, index, {
        removable: mode === MODE_JOINT && extras.length > 1,
      })).join('')}
      ${mode === MODE_JOINT ? button('Добавить участника', { variant: 'secondary', data: 'data-account-booking-add-participant' }) : ''}
      ${errorMessage ? `<p class="form-error" role="alert">${escapeHtml(errorMessage)}</p>` : ''}
    </form>`;
    creationOwner.setBackHandler?.(() => {
      mode = '';
      participants = [];
      renderMode();
      return true;
    });
    const view = creationOwner.render({
      step: 'person',
      title: 'Данные участников',
      body,
      action: { label: 'Далее', data: 'data-account-booking-participant-next' },
    });
    const form = view?.body?.querySelector('[data-account-booking-participant-form]');
    view?.body?.querySelector('[data-account-booking-add-participant]')?.addEventListener('click', () => {
      syncParticipantForm(form);
      participants.push(newParticipant(`recipient-${participants.length + 1}`));
      renderParticipantData();
    });
    view?.body?.querySelectorAll('[data-account-booking-remove-participant]').forEach((node) => node.addEventListener('click', () => {
      syncParticipantForm(form);
      const index = Math.max(0, Number(node.dataset.accountBookingRemoveParticipant) || 0);
      const booker = participants.find((participant) => participant.id === 'booker');
      const remaining = participants.filter((participant) => participant.id !== 'booker').filter((_, itemIndex) => itemIndex !== index);
      participants = [booker, ...remaining].filter(Boolean);
      renderParticipantData();
    }));
    view?.layer?.querySelector('[data-account-booking-participant-next]')?.addEventListener('click', () => {
      const validationError = syncParticipantForm(form, { validate: true });
      const missingName = extras.some((participant) => !participant.name);
      if (validationError || missingName) {
        renderParticipantData(validationError || 'Укажите имя каждого участника.');
        return;
      }
      void renderParticipantProcedures(0);
    });
    return true;
  };

  const renderMode = async () => {
    if (!creationOwner.isOpen()) return false;
    destroyParticipantProcedureController();
    let resolvedAccount;
    try {
      resolvedAccount = await resolveAccount();
    } catch (error) {
      openNotice({ title: 'Запись недоступна', message: accountErrorMessage(error, 'Не удалось определить пользователя приложения.') });
      return false;
    }
    if (!creationOwner.isOpen()) return false;
    creationOwner.setBackHandler?.(() => {
      mode = '';
      participants = [];
      activeWorkplaceKey = '';
      return workplaces.length > 1 ? renderWorkplaces() : showProfessionals();
    });
    const rows = [
      { value: MODE_SELF, label: 'Записаться' },
      { value: MODE_OTHER, label: 'Записать другого человека' },
      { value: MODE_JOINT, label: 'Совместная запись' },
    ].map((option) => v2ListEntry({
      title: option.label,
      interactive: true,
      selected: mode === option.value,
      data: `data-account-booking-mode="${option.value}"`,
      aria: option.label,
    }));
    const view = creationOwner.render({
      step: 'person',
      title: 'Как оформить запись?',
      body: v2ListEntries(rows),
    });
    view?.body?.querySelectorAll('[data-account-booking-mode]').forEach((node) => node.addEventListener('click', () => {
      mode = text(node.dataset.accountBookingMode);
      if (mode === MODE_SELF) {
        participants = [selfParticipant(resolvedAccount)];
        void openCanonicalRecords();
      } else if (mode === MODE_OTHER) {
        participants = [newParticipant('recipient-1')];
        renderParticipantData();
      } else {
        participants = [selfParticipant(resolvedAccount), newParticipant('recipient-1')];
        renderParticipantData();
      }
    }));
    return true;
  };

  const enterWorkplace = (workplaceKey) => {
    activeWorkplaceKey = text(workplaceKey);
    mode = '';
    participants = [];
    void renderMode();
  };

  const renderWorkplaces = () => {
    if (!creationOwner.isOpen()) return false;
    destroyParticipantProcedureController();
    creationOwner.setBackHandler?.(() => {
      activeWorkplaceKey = '';
      mode = '';
      participants = [];
      return showProfessionals();
    });
    const view = creationOwner.render({
      step: 'workplace',
      title: 'Выбор пространства',
      body: workplaceRows(bookingContext, workplaces),
    });
    view?.body?.querySelectorAll('[data-account-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
      const workplaceKey = String(node.dataset.accountBookingWorkplace || '');
      if (workplaceKey) enterWorkplace(workplaceKey);
    }));
    return true;
  };

  if (workplaces.length === 1) {
    enterWorkplace(String(workplaces[0]?.key || ''));
    return;
  }

  renderWorkplaces();
}

async function openAccountBookingProfessionalSelector(existingOwner = null) {
  const owner = existingOwner || openRecordCreationOwner();
  if (!owner) return null;
  owner.setBackHandler?.(null);

  const view = owner.render({
    step: 'person',
    title: 'Выбор специалиста',
    header: field({
      name: 'accountBookingProfessionalSearch',
      type: 'search',
      placeholder: 'Поиск по имени или профессии',
      autocomplete: 'off',
      data: 'data-account-booking-professional-search',
    }),
    body: '<div class="record-screen record-screen--people"><div class="record-person-list" data-account-booking-professional-list><div class="muted">Загрузка…</div></div></div>',
  });
  const listHost = view?.body?.querySelector('[data-account-booking-professional-list]');
  const search = view?.header?.querySelector('[data-account-booking-professional-search]');
  if (!listHost) return owner;

  let relationships = [];
  let opening = false;
  const renderList = () => {
    listHost.innerHTML = accountBookingProfessionalList(relationships, search?.value || '');
    listHost.querySelectorAll('[data-account-booking-professional]').forEach((node) => node.addEventListener('click', () => {
      if (opening) return;
      const tenantId = String(node.dataset.accountBookingProfessional || '');
      if (!tenantId) return;
      opening = true;
      void startJournalBooking(tenantId, owner).finally(() => {
        opening = false;
      });
    }));
  };
  search?.addEventListener('input', renderList);

  try {
    const loaded = await getGlobalAccountBookingTargets();
    relationships = Array.isArray(loaded) ? loaded : [];
    if (owner.isOpen()) renderList();
  } catch {
    if (owner.isOpen()) listHost.innerHTML = '<div class="muted">Не удалось загрузить специалистов.</div>';
  }
  return owner;
}

window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });
window.addEventListener('cova:account-journal-open-contacts', () => {
  void openAccountBookingProfessionalSelector();
});

syncViewport();
const bookingTargetsPrefetch = getGlobalAccountBookingTargets().catch(() => []);
await renderGlobalClientRoot();
void bookingTargetsPrefetch;
