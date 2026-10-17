import {
  acceptAccountTerms,
  accountErrorMessage,
  createBookingRequest,
  getAccount,
  getAccountConsentState,
  getAccountPlatformState,
  getAccountTerms,
  getBookingContext,
  getRememberedAccountEmail,
  isAccountSystemError,
  loginAccount,
  prepareAccount,
  registerAccount,
  submitAccountConsents,
} from '../core/account/index.js';
import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import {
  button,
  documentTile,
  documentTiles,
  emptyState,
  escapeHtml,
  field,
  formValidationMessage,
  initPasswordFields,
  initV2StickerSwipe,
  openDocumentViewer,
  openNotice,
  passwordField,
  phoneField,
  v2Sticker,
} from '../ui/ui.js';
import { formError, formView } from '../ui/forms/index.js';
import { openRecords } from '../core/records/records.js';
import {
  bookingProcedureCost,
  getBookingProcedures,
  getBookingSlots,
  getBookingTimeRows,
  getBookingWorkingDates,
  getBookingWorkplace,
  requiredBookingDocuments,
} from './model.js';
import { workplaceCardAppearance, workplaceCardFields } from '../core/profile/card-presentation.js';

function numericCost(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function accountDiscount(account = {}) {
  const value = Number(account?.discountPercent || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function accountFlowError(error, fallbackMessage) {
  const message = accountErrorMessage(error, fallbackMessage);
  if (!isAccountSystemError(error)) return message;
  openNotice({ title: 'Не удалось выполнить действие', message, variant: 'technical' });
  return '';
}

function exitBookingContext(state, target = {}) {
  if (typeof state.onExitToAccount !== 'function') return false;
  state.onExitToAccount(target);
  return true;
}

function openConsentDocument(document = {}) {
  return openDocumentViewer({
    title: document?.title || 'Документ',
    version: document?.version || 1,
    content: document?.content ?? document?.text ?? '',
  });
}

function currentAccountTermsFact(state) {
  const document = state.accountTerms || {};
  return {
    key: String(document.key || ''),
    version: Math.max(1, Number(document.version || 1)),
    accepted: Boolean(state.accountTermsAccepted),
    acceptedAt: new Date().toISOString(),
  };
}

function currentTenantConsentFacts(state) {
  return requiredBookingDocuments(state.context).map((document) => ({
    documentId: String(document.id || ''),
    documentVersion: Math.max(1, Number(document.version || 1)),
    accepted: Boolean(state.consents[String(document.id || '')]),
    acceptedAt: new Date().toISOString(),
  }));
}

function seedTenantConsents(state, facts = []) {
  state.consents = {};
  for (const fact of Array.isArray(facts) ? facts : []) {
    if (fact?.accepted) state.consents[String(fact.documentId || '')] = true;
  }
}

async function refreshContext(state) {
  state.context = await getBookingContext(state.tenantId, state.lockedWorkplaceKey);
  state.settings = normalizeBookingSettings(state.context.settings);
}

async function loadLegalState(state) {
  const [platform, tenant] = await Promise.all([
    getAccountPlatformState(state.tenantId),
    getAccountConsentState(state.tenantId).catch(() => ({ pdnActive: false, consents: [] })),
  ]);
  state.accountTerms = platform?.document || state.accountTerms || null;
  if (!state.accountTerms) state.accountTerms = await getAccountTerms();
  state.accountTermsAccepted = Boolean(platform?.accepted);
  seedTenantConsents(state, tenant?.consents || []);
  return { platform, tenant };
}

function renderWelcome(root, state) {
  const profile = state.context?.profile || {};
  const owner = [profile.name, profile.surname].filter(Boolean).join(' ').trim();
  const continueFlow = () => {
    if (state.account) void continueAfterIdentity(root, state);
    else renderAccountEntry(root, state);
  };
  root.innerHTML = `<section class="booking-account booking-account--account booking-account--v2">${v2Sticker({
    eyebrow: owner ? `Приглашение от ${escapeHtml(owner)}` : '',
    title: state.settings.welcomeTitle || '',
    body: state.settings.welcomeText ? `<p>${escapeHtml(state.settings.welcomeText).replaceAll('\n', '<br>')}</p>` : '',
    action: button('Продолжить', { data: 'data-access-welcome' }),
    className: 'v2-sticker-screen--welcome',
    closeData: 'data-access-welcome-close',
  })}</section>`;
  root.querySelector('[data-access-welcome]')?.addEventListener('click', continueFlow);
  root.querySelector('[data-access-welcome-close]')?.addEventListener('click', continueFlow);
  initV2StickerSwipe(root, { onRight: continueFlow, onLeft: continueFlow });
}

function renderAccountEntry(root, state) {
  const remembered = state.accountDraft?.identifier || getRememberedAccountEmail(state.tenantId) || '';
  const form = formView(`
    ${field({ label: 'Телефон или email', name: 'identifier', value: remembered, required: true, autocomplete: 'username' })}
    ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })}
    ${formError(state.error)}
    <button type="button" class="v2-sticker-link" data-access-register>Зарегистрироваться</button>
  `, { data: 'id="access-entry-form" data-access-entry-form' });
  root.innerHTML = `<section class="booking-account booking-account--account booking-account--v2">${v2Sticker({
    title: 'Вход',
    body: form,
    action: '<button class="ui-button" type="submit" form="access-entry-form">Войти</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-access-auth-close',
  })}</section>`;
  initPasswordFields(root);
  const authForm = root.querySelector('[data-access-entry-form]');
  root.querySelector('[data-access-auth-close]')?.addEventListener('click', () => {
    if (state.entry === 'account-booking' && exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId })) return;
    renderWelcome(root, state);
  });
  root.querySelector('[data-access-register]')?.addEventListener('click', async () => {
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    state.accountDraft = { identifier, ...(identifier.includes('@') ? { email: identifier.toLowerCase() } : {}) };
    state.error = '';
    state.accountTerms = await getAccountTerms().catch(() => null);
    renderAccountDetails(root, state);
  });
  authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(authForm);
    if (validationError) {
      state.error = validationError;
      renderAccountEntry(root, state);
      return;
    }
    const submit = root.querySelector('button[form="access-entry-form"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Входим…';
    }
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    const password = String(data.get('password') || '');
    try {
      const prepared = await prepareAccount(state.tenantId, { identifier });
      if (!prepared.exists) {
        state.accountDraft = {
          identifier,
          ...(prepared.identifierType === 'EMAIL' ? { email: identifier.toLowerCase() } : {}),
          ...(prepared.identifierType === 'PHONE' ? { phone: identifier } : {}),
        };
        state.error = 'Аккаунт не найден. Выберите «Зарегистрироваться».';
        renderAccountEntry(root, state);
        return;
      }
      const payload = await loginAccount(state.tenantId, identifier, password);
      state.account = payload.account;
      state.error = '';
      await continueAfterIdentity(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось войти');
      renderAccountEntry(root, state);
    }
  });
}

function renderAccountDetails(root, state) {
  const draft = state.accountDraft || {};
  const form = formView(`
    ${field({ label: 'Имя', name: 'name', value: draft.name || '', required: true, autocomplete: 'given-name' })}
    ${field({ label: 'Фамилия', name: 'surname', value: draft.surname || '', autocomplete: 'family-name' })}
    ${phoneField({ label: 'Телефон', name: 'phone', value: draft.phone || '', required: true })}
    ${field({ label: 'Email', name: 'email', value: draft.email || '', type: 'email', required: true, autocomplete: 'email' })}
    ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'new-password' })}
    ${passwordField({ label: 'Повтор пароля', name: 'repeatPassword', required: true, autocomplete: 'new-password' })}
    ${formError(state.error)}
  `, { data: 'id="access-register-form" data-access-register-form' });
  root.innerHTML = `<section class="booking-account booking-account--account booking-account--v2">${v2Sticker({
    title: 'Регистрация',
    body: form,
    action: '<button class="ui-button" type="submit" form="access-register-form">Подтвердить</button>',
    closeData: 'data-access-register-close',
  })}</section>`;
  initPasswordFields(root);
  root.querySelector('[data-access-register-close]')?.addEventListener('click', () => renderAccountEntry(root, state));
  const registerForm = root.querySelector('[data-access-register-form]');
  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(registerForm);
    if (validationError) {
      state.error = validationError;
      renderAccountDetails(root, state);
      return;
    }
    const data = new FormData(registerForm);
    const password = String(data.get('password') || '');
    if (password !== String(data.get('repeatPassword') || '')) {
      state.error = 'Пароли не совпадают.';
      renderAccountDetails(root, state);
      return;
    }
    const submit = root.querySelector('button[form="access-register-form"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Проверяем…';
    }
    const email = String(data.get('email') || '').trim().toLowerCase();
    const phone = String(data.get('phone') || '').trim();
    state.accountDraft = {
      name: String(data.get('name') || '').trim(),
      surname: String(data.get('surname') || '').trim(),
      email,
      phone,
      password,
    };
    try {
      const prepared = await prepareAccount(state.tenantId, { email, phone });
      if (prepared?.conflicts?.email || prepared?.conflicts?.phone) {
        state.error = 'Этот контакт уже зарегистрирован. Войдите в учетную запись.';
        renderAccountDetails(root, state);
        return;
      }
      if (!state.accountTerms) state.accountTerms = await getAccountTerms();
      state.accountTermsAccepted = false;
      renderLegal(root, state, { registration: true });
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось проверить контакты');
      renderAccountDetails(root, state);
    }
  });
}

function renderLegal(root, state, { registration = false } = {}) {
  const tenantDocuments = requiredBookingDocuments(state.context);
  const platformDocument = state.accountTerms && !state.accountTermsAccepted
    ? { ...state.accountTerms, platform: true, required: true }
    : null;
  const documents = [...(platformDocument ? [platformDocument] : []), ...tenantDocuments];
  const canContinue = (!platformDocument || state.accountTermsAccepted)
    && tenantDocuments.filter((document) => document.required).every((document) => state.consents[String(document.id || '')]);
  const cards = documentTiles(documents.map((document) => documentTile({
    title: document.platform ? 'Условия использования' : document.required ? 'Согласие на обработку персональных данных' : 'Согласие на получение рекламы',
    version: document.version || 1,
    openData: document.platform ? 'data-access-platform-document' : `data-access-document="${escapeHtml(document.id)}"`,
    toggleData: document.platform ? 'data-access-platform-toggle' : `data-access-consent="${escapeHtml(document.id)}"`,
    toggleChecked: document.platform ? Boolean(state.accountTermsAccepted) : Boolean(state.consents[String(document.id || '')]),
  })), { layout: 'rail' });
  root.innerHTML = `<section class="booking-account booking-account--account booking-account--v2">${v2Sticker({
    title: 'Документы',
    body: `${cards}${button('Продолжить', { data: 'data-access-legal-continue', disabled: !canContinue })}${formError(state.error)}`,
    closeData: 'data-access-legal-close',
  })}</section>`;
  root.querySelector('[data-access-legal-close]')?.addEventListener('click', () => (
    registration ? renderAccountDetails(root, state) : renderAccountEntry(root, state)
  ));
  root.querySelector('[data-access-platform-document]')?.addEventListener('click', () => openConsentDocument(state.accountTerms));
  root.querySelector('[data-access-platform-toggle]')?.addEventListener('click', () => {
    state.accountTermsAccepted = !state.accountTermsAccepted;
    renderLegal(root, state, { registration });
  });
  root.querySelectorAll('[data-access-document]').forEach((node) => node.addEventListener('click', () => {
    const document = tenantDocuments.find((item) => String(item.id) === String(node.dataset.accessDocument));
    if (document) openConsentDocument(document);
  }));
  root.querySelectorAll('[data-access-consent]').forEach((node) => node.addEventListener('click', () => {
    const id = String(node.dataset.accessConsent || '');
    state.consents[id] = !state.consents[id];
    renderLegal(root, state, { registration });
  }));
  root.querySelector('[data-access-legal-continue]')?.addEventListener('click', async (event) => {
    if (!canContinue) return;
    const action = event.currentTarget;
    action.disabled = true;
    action.textContent = 'Сохраняем…';
    try {
      if (!state.account) {
        const payload = await registerAccount(state.tenantId, {
          ...state.accountDraft,
          accountTerms: currentAccountTermsFact(state),
        });
        state.account = payload.account;
      } else if (platformDocument) {
        const accepted = await acceptAccountTerms(state.tenantId, currentAccountTermsFact(state));
        state.accountTermsAccepted = Boolean(accepted?.accepted);
      }
      const consents = currentTenantConsentFacts(state);
      if (consents.length) {
        const saved = await submitAccountConsents(state.tenantId, consents);
        seedTenantConsents(state, saved?.consents || consents);
      }
      state.error = '';
      startBookingFlow(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось сохранить документы');
      renderLegal(root, state, { registration });
    }
  });
}

async function continueAfterIdentity(root, state) {
  if (!state.account) {
    renderAccountEntry(root, state);
    return;
  }
  try {
    const { platform, tenant } = await loadLegalState(state);
    if (!platform?.accepted || !tenant?.pdnActive) {
      renderLegal(root, state);
      return;
    }
    startBookingFlow(root, state);
  } catch (error) {
    state.error = accountFlowError(error, 'Не удалось проверить учетную запись');
    renderAccountEntry(root, state);
  }
}

function workplaceCards(state) {
  const profile = state.context?.profile || {};
  return (Array.isArray(state.context.workplaces) ? state.context.workplaces : []).map((workplace) => ({
    ...workplace,
    appearance: workplaceCardAppearance(workplace),
    fields: workplaceCardFields(workplace, workplace.cardProfile || profile),
    image: workplace.photo || '',
    imagePosition: `${Number(workplace.photoCropX || 50)}% ${Number(workplace.photoCropY || 50)}%`,
  }));
}

function onlineProcedureEntry(state, procedure, workplaceKey) {
  return {
    id: String(procedure?.id || ''),
    name: String(procedure?.name || ''),
    cost: bookingProcedureCost(procedure, workplaceKey),
    duration: Math.max(0, Number(procedure?.duration) || 0),
    raw: procedure,
  };
}

function startBookingFlow(root, state) {
  const workplaces = Array.isArray(state.context.workplaces) ? state.context.workplaces : [];
  if (!workplaces.length) {
    openNotice({ title: 'Запись недоступна', message: 'Рабочие пространства не настроены.' });
    return;
  }

  const initialWorkplace = state.lockedWorkplaceKey
    || (workplaces.length === 1 ? String(workplaces[0]?.key || '') : '');
  let initialProcedures = [];
  if (initialWorkplace && state.repeatProcedureIds.length) {
    const byId = new Map(getBookingProcedures(state.context, initialWorkplace)
      .map((procedure) => [String(procedure.id || ''), procedure]));
    initialProcedures = state.repeatProcedureIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((procedure) => onlineProcedureEntry(state, procedure, initialWorkplace));
  }

  const provider = {
    kind: 'online',
    workplaces: () => workplaces,
    workplaceId: (workplace) => String(workplace?.key || ''),
    workplaceName: (workplaceKey) => (
      getBookingWorkplace(state.context, workplaceKey)?.name
      || [state.context?.profile?.name, state.context?.profile?.surname].filter(Boolean).join(' ').trim()
      || 'Рабочее пространство'
    ),
    workplaceCards: () => workplaceCards(state),
    procedures: (workplaceKey) => getBookingProcedures(state.context, workplaceKey),
    procedureId: (procedure) => String(procedure?.id || ''),
    procedureName: (procedure) => String(procedure?.name || ''),
    procedureCost: (procedure, workplaceKey) => bookingProcedureCost(procedure, workplaceKey),
    procedureDuration: (procedure) => Math.max(0, Number(procedure?.duration) || 0),
    workingDates: (workplaceKey) => getBookingWorkingDates(state.context, workplaceKey),
    timeRows: ({ workplaceId, date, procedures }) => getBookingTimeRows(state.context, {
      workplaceKey: workplaceId,
      date,
      procedureIds: procedures.map((entry) => String(entry.id || '')),
      step: state.settings.slotStep,
    }),
    personDisplay: (account = {}) => ({
      uei: String(account?.uei || account?.person?.uei || ''),
      name: [account?.name, account?.surname].filter(Boolean).join(' ').trim() || 'Запись',
      phone: String(account?.phone || account?.phones?.[0] || ''),
    }),
    discount: () => accountDiscount(state.account),
    total: (recordsState) => {
      const subtotal = recordsState.procedures.reduce((sum, entry) => sum + numericCost(entry.cost), 0);
      return Math.max(0, subtotal * (1 - accountDiscount(state.account) / 100));
    },
    async create(recordsState) {
      return createBookingRequest(state.tenantId, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        from: recordsState.from,
        procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')),
      });
    },
    async onCreateError(error, recordsState, { renderTimes, renderConfirmation }) {
      await refreshContext(state).catch(() => {});
      const stillAvailable = getBookingSlots(state.context, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')),
        step: state.settings.slotStep,
      }).some((slot) => String(slot.from || '') === String(recordsState.from || ''));
      if (!stillAvailable) {
        openNotice({ title: 'Запись недоступна', message: 'Выбранное время уже занято или стало недоступно. Выберите другое.' });
        renderTimes();
        return;
      }
      const message = accountFlowError(error, 'Не удалось подтвердить запись');
      if (message) openNotice({ title: 'Не удалось подтвердить запись', message });
      renderConfirmation();
    },
  };

  openRecords({
    context: 'online',
    person: state.account,
    workplaceId: initialWorkplace,
    procedures: initialProcedures,
    professionalActions: false,
    provider,
    onCancel: () => {
      if (state.entry === 'account-booking') {
        exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId });
      }
    },
    onCreated: () => {
      if (!exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId })) {
        document.querySelector('#app')?.replaceChildren();
        openNotice({ title: 'Запись создана', message: 'Запись отправлена специалисту.' });
      }
    },
  });
}

export async function renderAccess(root, {
  tenantId = '',
  workplaceKey = '',
  procedureIds = [],
  entry = '',
  onExitToAccount = null,
} = {}) {
  const state = {
    tenantId: String(tenantId || ''),
    lockedWorkplaceKey: String(workplaceKey || ''),
    repeatProcedureIds: [...new Set((Array.isArray(procedureIds) ? procedureIds : []).map((value) => String(value || '').trim()).filter(Boolean))],
    context: {},
    settings: normalizeBookingSettings(),
    accountDraft: {},
    account: null,
    accountTerms: null,
    accountTermsAccepted: false,
    consents: {},
    error: '',
    entry: String(entry || ''),
    onExitToAccount,
  };

  if (!state.tenantId) {
    root.innerHTML = emptyState('Ссылка недействительна', 'В ссылке отсутствует идентификатор онлайн-записи.');
    return;
  }

  if (state.entry !== 'account-booking') {
    root.innerHTML = emptyState('Онлайн-запись', 'Загрузка…');
  }
  try {
    const [, account] = await Promise.all([
      refreshContext(state),
      getAccount(state.tenantId),
    ]);
    state.account = account;
    if (state.entry === 'account-booking') {
      if (state.account) await continueAfterIdentity(root, state);
      else renderAccountEntry(root, state);
      return;
    }
    if (state.account) {
      await continueAfterIdentity(root, state);
      return;
    }
    renderWelcome(root, state);
  } catch (error) {
    root.innerHTML = emptyState('Запись недоступна', accountFlowError(error, 'Не удалось открыть онлайн-запись.'));
  }
}
