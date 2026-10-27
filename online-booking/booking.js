import {
  acceptAccountTerms,
  accountErrorMessage,
  isAccountSystemError,
  acceptGlobalAccountTerms,
  clearAccount,
  createBookingRequest,
  getAccount,
  getAccountConsentState,
  getGlobalAccount,
  getGlobalAccountPlatformState,
  getGlobalAccountRecords,
  getGlobalAccountRelationships,
  getAccountPlatformState,
  getAccountTerms,
  getBookingContext,
  getRememberedAccountEmail,
  loginAccount,
  loginGlobalAccount,
  prepareAccount,
  prepareGlobalAccount,
  registerAccount,
  registerGlobalAccount,
  submitAccountConsents,
} from '../core/account/index.js';
import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import {
  actionBlock,
  button,
  documentTile,
  documentTiles,
  emptyState,
  escapeHtml,
  field,
  formValidationMessage,
  initCalendar,
  initPasswordFields,
  initV2StickerSwipe,
  initV2Swipe,
  mountV2ZLayer,
  openDocumentViewer,
  openNotice,
  passwordField,
  phoneField,
  v2Header,
  v2Shell,
  v2ZLayer,
  recordWorkplaceCards,
  recordProcedureList,
  recordTimeRows,
  recordConfirmationMiniCard,
  v2Sticker,
} from '../ui/ui.js';
import { formError, formView } from '../ui/forms/index.js';
import {
  bookingProcedureCost,
  bookingSelection,
  getBookingProcedures,
  getBookingSlots,
  getBookingWorkingDates,
  getBookingWorkplace,
  requiredBookingDocuments,
} from './model.js';
import { renderGlobalAccount } from './account-shell.js';
import { workplaceCardAppearance, workplaceCardFields } from '../core/profile/card-presentation.js';

function formatDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1].slice(-2)}` : String(value || '');
}

function money(value) {
  if (value === '' || value == null) return '0 ₽';
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? `${number.toLocaleString('ru-RU').replaceAll('\u00a0', ' ')} ₽` : `${value} ₽`;
}

function numericCost(value) {
  const number = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function selectedSubtotal(context, workplaceKey, ids) {
  return bookingSelection(context, workplaceKey, ids).reduce((sum, procedure) => sum + numericCost(bookingProcedureCost(procedure, workplaceKey)), 0);
}

function accountDiscount(account = {}) {
  const value = Number(account?.discountPercent || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function discountedTotal(subtotal, discountPercent) {
  return Math.max(0, Number(subtotal || 0) * (1 - Number(discountPercent || 0) / 100));
}

function accountFlowError(error, fallbackMessage) {
  const message = accountErrorMessage(error, fallbackMessage);
  if (!isAccountSystemError(error)) return message;
  openNotice({
    title: 'Не удалось выполнить действие',
    message,
    action: 'Закрыть',
    variant: 'technical',
  });
  return '';
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
    if (!fact?.accepted) continue;
    state.consents[String(fact.documentId || '')] = true;
  }
}

async function refreshTenantConsentState(state) {
  const consentState = await getAccountConsentState(state.tenantId);
  seedTenantConsents(state, consentState?.consents || []);
  return consentState || { pdnActive: false, consents: [] };
}

async function saveTenantConsents(state) {
  const consents = currentTenantConsentFacts(state);
  const consentState = await submitAccountConsents(state.tenantId, consents);
  seedTenantConsents(state, consentState?.consents || consents);
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

async function loadAccountTerms(state) {
  state.accountTerms = await getAccountTerms();
  state.accountTermsAccepted = false;
  return state.accountTerms;
}

function openConsentDocument(document = {}) {
  return openDocumentViewer({
    title: document?.title || 'Документ',
    version: document?.version || 1,
    content: document?.content ?? document?.text ?? '',
  });
}

function legalTitle(document = {}) {
  if (document.platform) return 'Условия использования';
  return document.required ? 'Согласие на обработку персональных данных' : 'Согласие на получение рекламы';
}

function renderLegalSticker(root, state) {
  const tenantDocuments = state.platformOnlyLegal ? [] : requiredBookingDocuments(state.context);
  const platformDocument = state.accountTerms && !state.accountTermsAccepted
    ? { ...state.accountTerms, platform: true, required: true }
    : null;
  const documents = [...(platformDocument ? [platformDocument] : []), ...tenantDocuments];
  const platformReady = !platformDocument || state.accountTermsAccepted;
  const tenantReady = tenantDocuments.filter((document) => document.required).every((document) => state.consents[String(document.id || '')]);
  const canContinue = platformReady && tenantReady;

  const cards = documentTiles(documents.map((document) => documentTile({
    title: legalTitle(document),
    version: document.version || 1,
    openData: document.platform ? 'data-legal-platform-document' : `data-booking-document="${escapeHtml(document.id)}"`,
    toggleData: document.platform ? 'data-legal-platform-toggle' : `data-booking-consent="${escapeHtml(document.id)}"`,
    toggleChecked: document.platform ? Boolean(state.accountTermsAccepted) : Boolean(state.consents[String(document.id || '')]),
    aria: `Открыть ${legalTitle(document)}`,
    toggleAria: `Изменить согласие: ${legalTitle(document)}`,
  })), { layout: 'rail' });

  const action = button('Продолжить', { data: 'data-legal-continue', disabled: !canContinue });
  const closeLegal = () => {
    state.error = '';
    if (state.identityDestination === 'booking' && state.from) renderConfirmation(root, state);
    else if (state.identityDestination === 'booking-start' && state.account) exitBookingContext(state, {
      tab: 'contact-detail',
      tenantId: state.tenantId,
    });
    else if (state.account && state.identityDestination === 'profile') exitBookingContext(state, {
      tab: state.entry === 'chat' ? 'messages' : 'contact-detail',
      tenantId: state.tenantId,
    });
    else if (state.account && state.identityDestination === 'booking') exitBookingContext(state, {
      tab: 'journal',
      tenantId: state.tenantId,
    });
    else renderAccountDetails(root, state);
  };

  root.innerHTML = `<section class="${flowThemeClasses()}">${v2Sticker({
    title: 'Документы',
    body: `${cards}${formError(state.error)}`,
    action,
    className: 'v2-sticker-screen--legal',
    closeData: 'data-booking-legal-u-close',
  })}</section>`;

  initV2StickerSwipe(root, {
    onRight: closeLegal,
    onLeft: () => { exitBookingContext(state); },
  });
  root.querySelector('[data-booking-legal-u-close]')?.addEventListener('click', closeLegal);

  root.querySelector('[data-legal-platform-document]')?.addEventListener('click', () => {
    openConsentDocument({
      title: state.accountTerms?.title || 'Условия использования',
      version: state.accountTerms?.version || 1,
      content: state.accountTerms?.content || '',
    });
  });
  root.querySelector('[data-legal-platform-toggle]')?.addEventListener('click', () => {
    state.accountTermsAccepted = !state.accountTermsAccepted;
    renderLegalSticker(root, state);
  });
  root.querySelectorAll('[data-booking-document]').forEach((node) => node.addEventListener('click', () => {
    const document = tenantDocuments.find((item) => String(item.id) === String(node.dataset.bookingDocument));
    if (!document) return;
    openConsentDocument({
      title: document.title || legalTitle(document),
      version: document.version || 1,
      content: document.text || '',
    });
  }));
  root.querySelectorAll('[data-booking-consent]').forEach((node) => node.addEventListener('click', () => {
    const id = String(node.dataset.bookingConsent || '');
    state.consents[id] = !state.consents[id];
    renderLegalSticker(root, state);
  }));

  root.querySelector('[data-legal-continue]')?.addEventListener('click', async (event) => {
    if (!canContinue) return;
    event.currentTarget.disabled = true;
    try {
      if (!state.account) {
        const payload = await registerAccount(state.tenantId, {
          ...state.accountDraft,
          password: state.accountDraft.password,
          accountTerms: currentAccountTermsFact(state),
        });
        state.account = payload.account;
      } else if (platformDocument) {
        const accepted = await acceptAccountTerms(state.tenantId, currentAccountTermsFact(state));
        state.accountTerms = accepted?.document || state.accountTerms;
        state.accountTermsAccepted = Boolean(accepted?.accepted);
      }
      if (tenantDocuments.length) await saveTenantConsents(state);
      state.platformOnlyLegal = false;
      state.error = '';
      await continueAfterIdentity(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось сохранить документы');
      renderLegalSticker(root, state);
    }
  });
}

function resetBookingChoice(state) {
  state.workplaceKey = state.lockedWorkplaceKey || '';
  state.procedureIds = [];
  state.date = '';
  state.from = '';
  state.to = '';
  state.error = '';
  state.repeatSelection = null;
}

function flowThemeClasses() {
  return 'booking-account booking-account--account booking-account--v2';
}

function representativeName(state) {
  const profile = state.context?.profile || {};
  return [profile.name, profile.surname].filter(Boolean).join(' ').trim() || 'Запись';
}

function representativePhoto(state) {
  return String(state.context?.profile?.photo || '');
}

function subtitleBlock(value = '') {
  const valueText = String(value || '').trim();
  return valueText ? `<div class="v2-flow-subtitle">${escapeHtml(valueText).replaceAll('\
', '<br>')}</div>` : '';
}

function actionMarkup(action = null) {
  if (!action?.label) return '';
  return actionBlock(button(action.label, {
    data: action.data || '',
    aria: action.aria || action.label || '',
    disabled: Boolean(action.disabled),
    variant: action.variant || '',
  }));
}

function renderFlowPage(root, state, {
  title = '',
  subtitle = '',
  body = '',
  action = null,
  center = false,
  step = '',
} = {}) {
  if (step) state.bookingStep = step;
  const bookingScreen = ['workplaces', 'procedures', 'dates', 'times', 'confirmation'].includes(step);
  const registration = step === 'registration';
  const header = v2Header({
    a: {
      kind: 'avatar',
      label: representativeName(state),
      image: representativePhoto(state),
      disabled: true,
      aria: `Профиль ${representativeName(state)}`,
    },
    b: registration ? 'Регистрация' : bookingScreen ? 'Запись' : (title || representativeName(state)),
    d: bookingScreen ? null : (state.account ? { kind: 'chat', data: 'data-booking-flow-chat', aria: 'Чат' } : null),
  });
  const localTitle = title ? `<h2 class="v2-flow-title">${escapeHtml(title)}</h2>` : '';
  const shell = v2Shell({
    header,
    body: `${localTitle}${subtitleBlock(subtitle)}${body}${actionMarkup(action)}`,
    className: center ? 'v2-app--flow-center' : 'v2-app--booking-flow',
  });
  root.innerHTML = `<section class="${flowThemeClasses()}">${shell}</section>`;
  root.querySelector('[data-booking-flow-chat]')?.addEventListener('click', () => {
    exitBookingContext(state, { tab: 'messages', tenantId: state.tenantId });
  });
}

function bookingHeaderMarkup(state) {
  return v2Header({
    a: {
      kind: 'avatar',
      label: representativeName(state),
      image: representativePhoto(state),
      disabled: true,
      aria: `Профиль ${representativeName(state)}`,
    },
    b: 'Запись',
    d: null,
  });
}

function bookingActionForStep(state, step) {
  if (step === 'procedures') {
    return {
      label: 'Далее',
      data: 'data-booking-procedures-next',
      disabled: state.procedureIds.length === 0,
    };
  }
  if (step === 'confirmation') {
    return { label: 'Подтвердить', data: 'data-booking-confirm' };
  }
  return null;
}

function bookingStepBody(state, step, body = '') {
  return `${body}${actionMarkup(bookingActionForStep(state, step))}`;
}

function syncBookingHeader(root, state) {
  const app = root.querySelector('[data-v2-app]');
  const header = app?.querySelector(':scope > [data-v2-header]');
  if (!header) return;
  header.outerHTML = bookingHeaderMarkup(state);
}

function currentBookingStepNode(root) {
  const app = root.querySelector('[data-v2-app]');
  const layers = [...(app?.querySelectorAll?.('[data-booking-step-layer]') || [])];
  return layers.at(-1) || app?.querySelector?.('[data-booking-base-step]') || null;
}

function previousBookingStep(root) {
  const app = root.querySelector('[data-v2-app]');
  const layers = [...(app?.querySelectorAll?.('[data-booking-step-layer]') || [])];
  if (layers.length) return String(layers.at(-1)?.dataset.bookingStep || '');
  return String(app?.querySelector?.('[data-booking-base-step]')?.dataset.bookingStep || '');
}

function renderBookingStep(root, state, {
  step,
  body = '',
  onFirstBack = null,
} = {}) {
  const content = bookingStepBody(state, step, body);
  let app = root.querySelector('[data-v2-app]');
  if (!app || !app.classList.contains('v2-app--booking-flow')) {
    root.innerHTML = `<section class="${flowThemeClasses()}">${v2Shell({
      header: bookingHeaderMarkup(state),
      body: '<div data-booking-base-step></div>',
      className: 'v2-app--booking-flow',
    })}</section>`;
    app = root.querySelector('[data-v2-app]');
    const base = app?.querySelector('[data-booking-base-step]');
    if (!base) return null;
    base.dataset.bookingStep = step;
    base.innerHTML = content;
    state.bookingStep = step;
    initV2Swipe(app.querySelector('[data-v2-z]'), {
      onRight: () => onFirstBack?.(),
      revealDeck: false,
    });
    return base;
  }

  const active = currentBookingStepNode(root);
  if (active && String(active.dataset.bookingStep || '') === String(step)) {
    active.innerHTML = content;
    state.bookingStep = step;
    syncBookingHeader(root, state);
    return active;
  }

  const layer = mountV2ZLayer(root, v2ZLayer(content, { className: 'booking-step-z' }), {
    stack: true,
    onClose: () => {
      const previous = previousBookingStep(root);
      state.bookingStep = previous;
      syncBookingHeader(root, state);
    },
  });
  if (!layer) return null;
  layer.dataset.bookingStep = step;
  layer.dataset.bookingStepLayer = '';
  state.bookingStep = step;
  syncBookingHeader(root, state);
  return layer;
}

function resumeBookingStep(root, state) {
  if (state.bookingStep === 'workplaces') return renderWorkplaces(root, state);
  if (state.bookingStep === 'procedures') return renderProcedures(root, state);
  if (state.bookingStep === 'dates') return renderDates(root, state);
  if (state.bookingStep === 'times') return renderTimes(root, state);
  if (state.bookingStep === 'confirmation') return renderConfirmation(root, state);
  if (state.bookingStep === 'registration') return renderAccountDetails(root, state);
  if (state.bookingStep === 'auth') return renderAccountEntry(root, state);
  return exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId });
}

function requestProcedures(request = {}) {
  return Array.isArray(request.procedures) ? request.procedures : [];
}

function continueRepeat(root, state) {
  const selection = state.repeatSelection;
  if (!selection) return false;
  state.repeatSelection = null;
  const requestWorkplace = String(selection.workplaceKey || '').trim();
  state.workplaceKey = state.lockedWorkplaceKey || requestWorkplace;
  state.procedureIds = [...new Set((Array.isArray(selection.procedureIds) ? selection.procedureIds : []).map(String).filter(Boolean))];
  state.date = '';
  state.from = '';
  state.to = '';
  if (!state.workplaceKey) {
    renderWorkplaces(root, state);
    return true;
  }
  if (!state.procedureIds.length) {
    renderProcedures(root, state);
    return true;
  }
  renderDates(root, state);
  return true;
}

function nextBookingStep(root, state) {
  state.error = '';
  if (continueRepeat(root, state)) return;
  if (state.lockedWorkplaceKey) {
    state.workplaceKey = state.lockedWorkplaceKey;
    renderProcedures(root, state);
  } else {
    renderWorkplaces(root, state);
  }
}

function backFromFirstBookingStep(root, state) {
  state.error = '';
  state.repeatSelection = null;
  if (state.account) {
    exitBookingContext(state, {
      tab: state.bookingOrigin === 'profile' ? 'contact-detail' : 'journal',
      tenantId: state.tenantId,
    });
    return;
  }
  state.identityDestination = 'booking';
  renderWelcome(root, state);
}

function exitBookingContext(state, target = {}) {
  if (!state.account || typeof state.onExitToAccount !== 'function') return false;
  state.onExitToAccount(target);
  return true;
}

function renderWelcome(root, state) {
  const profile = state.context.profile || {};
  const owner = [profile.name, profile.surname].filter(Boolean).join(' ').trim();
  const continueFlow = () => {
    resetBookingChoice(state);
    state.identityDestination = 'booking';
    state.bookingOrigin = 'welcome';
    if (state.account) {
      void continueAfterIdentity(root, state);
      return;
    }
    renderAccountEntry(root, state);
  };
  root.innerHTML = `<section class="${flowThemeClasses()}">${v2Sticker({
    eyebrow: owner ? `Приглашение от ${owner}` : '',
    title: state.settings.welcomeTitle || '',
    body: state.settings.welcomeText ? `<p>${escapeHtml(state.settings.welcomeText).replaceAll('\
', '<br>')}</p>` : '',
    className: 'v2-sticker-screen--welcome',
    closeData: 'data-booking-welcome-u-close',
  })}</section>`;
  initV2StickerSwipe(root, {
    onRight: continueFlow,
    onLeft: () => {
      if (!exitBookingContext(state)) continueFlow();
    },
  });
  root.querySelector('[data-booking-welcome-u-close]')?.addEventListener('click', continueFlow);
}

function renderAccountEntry(root, state) {
  state.bookingStep = 'auth';
  const rememberedIdentifier = state.accountDraft?.identifier
    || state.accountDraft?.email
    || getRememberedAccountEmail(state.tenantId)
    || '';
  const form = formView(`
    ${field({ label: 'Телефон или email', name: 'identifier', value: rememberedIdentifier, required: true, autocomplete: 'username' })}
    ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })}
    ${formError(state.error)}
    <button type="button" class="v2-sticker-link" data-booking-forgot>Забыли пароль?</button>
    <button type="button" class="v2-sticker-link" data-booking-register>Зарегистрироваться</button>
  `, { data: 'id="booking-entry-form" data-booking-entry-form' });
  root.innerHTML = `<section class="${flowThemeClasses()}">${v2Sticker({
    title: 'Вход',
    body: form,
    action: '<button class="ui-button" type="submit" form="booking-entry-form">Войти</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-booking-u-close',
  })}</section>`;

  initV2StickerSwipe(root, {
    onRight: () => {
      state.error = '';
      if (state.identityDestination === 'booking' && state.from) {
        renderConfirmation(root, state);
        return;
      }
      renderWelcome(root, state);
    },
    onLeft: () => { exitBookingContext(state); },
  });

  initPasswordFields(root);
  root.querySelector('[data-booking-u-close]')?.addEventListener('click', () => {
    if (state.entry === 'account-booking') {
      exitBookingContext(state, { tab: 'contact-detail', tenantId: state.tenantId });
      return;
    }
    renderWelcome(root, state);
  });
  const authForm = root.querySelector('[data-booking-entry-form]');
  root.querySelector('[data-booking-register]')?.addEventListener('click', async () => {
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    state.accountDraft = {
      ...(state.accountDraft || {}),
      identifier,
      ...(identifier.includes('@') ? { email: identifier.toLowerCase() } : {}),
    };
    state.error = '';
    try {
      await loadAccountTerms(state);
      renderAccountDetails(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось открыть регистрацию');
      renderAccountEntry(root, state);
    }
  });
  root.querySelector('[data-booking-forgot]')?.addEventListener('click', () => {
    openNotice({
      title: 'Восстановление пароля',
      message: 'Восстановление пароля пока недоступно.',
      action: 'Закрыть',
      variant: 'technical',
    });
  });
  authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(authForm);
    if (validationError) {
      state.error = validationError;
      renderAccountEntry(root, state);
      return;
    }
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    const password = String(data.get('password') || '');
    const submit = authForm.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const prepared = await prepareAccount(state.tenantId, { identifier });
      if (!prepared.exists) {
        state.accountDraft = {
          ...(state.accountDraft || {}),
          identifier,
          ...(prepared.identifierType === 'EMAIL' ? { email: identifier.toLowerCase() } : {}),
          ...(prepared.identifierType === 'PHONE' ? { phone: identifier } : {}),
        };
        state.error = 'Аккаунт не найден. Выберите «Зарегистрироваться».';
        renderAccountEntry(root, state);
        return;
      }
      const payload = await loginAccount(state.tenantId, identifier, password);
      state.accountDraft = { ...(state.accountDraft || {}), identifier };
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
  state.bookingStep = 'registration';
  const draft = state.accountDraft || {};
  const contactErrors = state.contactErrors || {};
  renderFlowPage(root, state, {
    title: 'Регистрация',
    action: { label: 'Подтвердить', data: 'data-booking-account-submit' },
    step: 'registration',
    body: formView(`
      ${field({ label: 'Имя', name: 'name', value: draft.name || '', required: true, autocomplete: 'given-name' })}
      ${field({ label: 'Фамилия', name: 'surname', value: draft.surname || '', autocomplete: 'family-name' })}
      ${phoneField({ label: 'Телефон', name: 'phone', value: draft.phone || '', required: true })}
      ${formError(contactErrors.phone || '')}
      ${field({ label: 'Email', name: 'email', value: draft.email || '', type: 'email', required: true, autocomplete: 'email' })}
      ${formError(contactErrors.email || '')}
      ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'new-password' })}
      ${passwordField({ label: 'Повтор пароля', name: 'repeatPassword', required: true, autocomplete: 'new-password' })}
      ${formError(state.error)}
    `, { data: 'data-booking-account-form' }),
  });
  initV2Swipe(root, {
    onRight: () => {
      state.error = '';
      state.contactErrors = {};
      renderAccountEntry(root, state);
    },
  });
  initPasswordFields(root);
  const form = root.querySelector('[data-booking-account-form]');
  root.querySelector('[data-booking-account-submit]')?.addEventListener('click', () => form?.requestSubmit());
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(form);
    if (validationError) {
      state.error = validationError;
      renderAccountDetails(root, state);
      return;
    }
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim().toLowerCase();
    const phone = String(data.get('phone') || '').trim();
    const password = String(data.get('password') || '');
    const repeatPassword = String(data.get('repeatPassword') || '');
    if (password !== repeatPassword) {
      state.error = 'Пароли не совпадают.';
      renderAccountDetails(root, state);
      return;
    }
    state.accountDraft = {
      ...(state.accountDraft || {}),
      name: String(data.get('name') || '').trim(),
      surname: String(data.get('surname') || '').trim(),
      email,
      phone,
      password,
    };
    const submit = root.querySelector('[data-booking-account-submit]');
    if (submit) submit.disabled = true;
    try {
      const prepared = await prepareAccount(state.tenantId, { email, phone });
      const contactMessage = 'Этот контакт уже зарегистрирован. Войдите в учетную запись или восстановите пароль.';
      state.contactErrors = {
        email: prepared?.conflicts?.email ? contactMessage : '',
        phone: prepared?.conflicts?.phone ? contactMessage : '',
      };
      if (state.contactErrors.email || state.contactErrors.phone) {
        state.error = '';
        renderAccountDetails(root, state);
        return;
      }
      state.contactErrors = {};
      state.error = '';
      if (!state.accountTerms) await loadAccountTerms(state);
      renderLegalSticker(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось проверить контакты');
      renderAccountDetails(root, state);
    }
  });
}

async function continueAfterIdentity(root, state) {
  if (!state.account) {
    renderAccountEntry(root, state);
    return;
  }

  try {
    const platformState = await getAccountPlatformState(state.tenantId);
    state.accountTerms = platformState?.document || state.accountTerms;
    state.accountTermsAccepted = Boolean(platformState?.accepted);

    if (!platformState?.accepted) {
      state.platformOnlyLegal = state.identityDestination === 'profile' || state.identityDestination === 'booking-start';
      renderLegalSticker(root, state);
      return;
    }

    if (state.identityDestination === 'booking-start') {
      state.platformOnlyLegal = false;
      state.identityDestination = 'booking';
      nextBookingStep(root, state);
      return;
    }

    if (state.identityDestination === 'profile') {
      state.platformOnlyLegal = false;
      exitBookingContext(state, {
        tab: state.entry === 'chat' ? 'messages' : 'contact-detail',
        tenantId: state.tenantId,
      });
      return;
    }

    state.platformOnlyLegal = false;
    const consentState = await refreshTenantConsentState(state);
    if (!consentState.pdnActive) {
      renderLegalSticker(root, state);
      return;
    }

    const hasBookingSelection = Boolean(
      state.workplaceKey
      && state.procedureIds.length
      && state.date
      && state.from
      && state.to
    );
    if (hasBookingSelection) {
      await finalizeBookingRequest(root, state);
      return;
    }
    nextBookingStep(root, state);
  } catch (error) {
    state.error = accountFlowError(error, 'Не удалось проверить юридический статус');
    try {
      if (!state.accountTerms) await loadAccountTerms(state);
      await refreshTenantConsentState(state).catch(() => ({ pdnActive: false }));
      renderLegalSticker(root, state);
    } catch {
      renderFlowPage(root, state, {
        title: 'Проверка учетной записи',
        body: formError(state.error),
        step: state.bookingStep || 'times',
      });
      initV2Swipe(root, {
        onRight: () => {
          if (state.identityDestination === 'booking' && state.from) renderConfirmation(root, state);
          else nextBookingStep(root, state);
        },
      });
    }
  }
}

function renderWorkplaces(root, state) {
  const workplaces = Array.isArray(state.context.workplaces) ? state.context.workplaces : [];
  const profile = state.context?.profile || {};
  const content = recordWorkplaceCards(workplaces.map((workplace) => ({
    ...workplace,
    appearance: workplaceCardAppearance(workplace),
    fields: workplaceCardFields(workplace, workplace.cardProfile || profile),
    image: workplace.photo || '',
    imagePosition: `${Number(workplace.photoCropX || 50)}% ${Number(workplace.photoCropY || 50)}%`,
  })), {
    data: 'data-booking-workplace',
  });
  const layer = renderBookingStep(root, state, {
    step: 'workplaces',
    body: content || emptyState('Нет доступных пространств', 'Рабочие пространства для онлайн-записи не найдены.'),
    onFirstBack: () => backFromFirstBookingStep(root, state),
  });
  layer?.querySelectorAll('[data-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
    state.workplaceKey = node.dataset.bookingWorkplace || '';
    state.procedureIds = [];
    state.date = '';
    state.from = '';
    renderProcedures(root, state);
  }));
}

function renderProcedures(root, state) {
  const procedures = getBookingProcedures(state.context, state.workplaceKey);
  const content = recordProcedureList(procedures.map((procedure) => {
    const cost = bookingProcedureCost(procedure, state.workplaceKey);
    return {
      id: String(procedure.id || ''),
      name: procedure.name || '',
      durationText: procedure.duration ? `${Number(procedure.duration)} мин` : '',
      costText: cost !== '' ? money(cost) : '',
    };
  }), {
    selected: state.procedureIds,
    data: 'data-booking-procedure',
    empty: 'Для этого рабочего пространства процедуры не настроены.',
  });
  const layer = renderBookingStep(root, state, {
    step: 'procedures',
    body: content || emptyState('Процедур нет', 'Для этого рабочего пространства процедуры не настроены.'),
    onFirstBack: () => backFromFirstBookingStep(root, state),
  });
  layer?.querySelectorAll('[data-booking-procedure]').forEach((node) => node.addEventListener('click', () => {
    const id = String(node.dataset.bookingProcedure || '');
    const next = new Set(state.procedureIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    state.procedureIds = [...next];
    state.date = '';
    state.from = '';
    renderProcedures(root, state);
  }));
  layer?.querySelector('[data-booking-procedures-next]')?.addEventListener('click', () => {
    if (!state.procedureIds.length) return;
    state.date = '';
    state.from = '';
    renderDates(root, state);
  });
}

function renderDates(root, state) {
  const dates = getBookingWorkingDates(state.context, state.workplaceKey);
  const first = state.date || dates[0] || '2000-01-01';
  const firstDate = new Date(`${first}T00:00:00`);
  const layer = renderBookingStep(root, state, {
    step: 'dates',
    body: dates.length ? '<div data-booking-calendar></div>' : emptyState('Свободных дат нет', 'В графике пока нет доступных дат.'),
    onFirstBack: () => backFromFirstBookingStep(root, state),
  });
  const calendarRoot = layer?.querySelector('[data-booking-calendar]');
  if (!calendarRoot) return;
  initCalendar(calendarRoot, {
    month: new Date(firstDate.getFullYear(), firstDate.getMonth(), 1),
    selectedValue: state.date || '',
    workingDates: dates,
    onDateSelect: (date) => {
      if (!dates.includes(date)) return;
      state.date = date;
      state.from = '';
      renderTimes(root, state);
    },
  });
}

function renderTimes(root, state) {
  const slots = getBookingSlots(state.context, {
    workplaceKey: state.workplaceKey,
    date: state.date,
    procedureIds: state.procedureIds,
    step: state.settings.slotStep,
  });
  const layer = renderBookingStep(root, state, {
    step: 'times',
    body: `${slots.length
      ? recordTimeRows(slots, { data: 'data-booking-time', accentEvery: 0 })
      : emptyState('Свободного времени нет', 'На эту дату нет интервала для выбранных процедур.')}${formError(state.error)}`,
    onFirstBack: () => backFromFirstBookingStep(root, state),
  });
  layer?.querySelectorAll('[data-booking-time]').forEach((node) => {
    if (String(node.dataset.bookingTime || '') === String(state.from || '')) node.classList.add('is-selected');
    node.addEventListener('click', () => {
      const slot = slots.find((item) => item.from === node.dataset.bookingTime);
      if (!slot) return;
      state.from = slot.from;
      state.to = slot.to;
      state.error = '';
      state.identityDestination = 'booking';
      renderConfirmation(root, state);
    });
  });
}

function confirmationCard(state) {
  const workplace = getBookingWorkplace(state.context, state.workplaceKey) || {};
  const procedures = bookingSelection(state.context, state.workplaceKey, state.procedureIds);
  const subtotal = selectedSubtotal(state.context, state.workplaceKey, state.procedureIds);
  const discount = accountDiscount(state.account);
  const total = discountedTotal(subtotal, discount);
  const duration = procedures.reduce((sum, procedure) => sum + Math.max(0, Number(procedure.duration || 0)), 0);
  const accountName = [state.account?.name, state.account?.surname].filter(Boolean).join(' ').trim();
  const accountPhone = String(state.account?.phone || state.account?.phones?.[0] || '');
  const uei = String(state.account?.uei || state.account?.person?.uei || '');
  return recordConfirmationMiniCard({
    workplace: workplace.name || representativeName(state),
    date: formatDate(state.date),
    period: `${state.from || ''} - ${state.to || ''}`,
    uei,
    name: accountName || 'Запись',
    phone: accountPhone,
    duration: duration ? `${duration} мин` : '—',
    discount: `${discount}%`,
    total: money(total),
    procedures: procedures.map((procedure) => ({
      name: procedure.name || '',
      durationText: procedure.duration ? `${Number(procedure.duration)} мин` : '',
      right: money(bookingProcedureCost(procedure, state.workplaceKey)),
    })),
  });
}

function renderConfirmation(root, state) {
  const layer = renderBookingStep(root, state, {
    step: 'confirmation',
    body: `${confirmationCard(state)}${formError(state.error)}`,
    onFirstBack: () => backFromFirstBookingStep(root, state),
  });
  layer?.querySelector('[data-booking-confirm]')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    state.identityDestination = 'booking';
    state.error = '';
    if (!state.account) {
      renderAccountEntry(root, state);
      return;
    }
    await continueAfterIdentity(root, state);
  });
}

async function finalizeBookingRequest(root, state) {
  const slotStillAvailable = () => getBookingSlots(state.context, {
    workplaceKey: state.workplaceKey,
    date: state.date,
    procedureIds: state.procedureIds,
    step: state.settings.slotStep,
  }).some((slot) => String(slot.from || '') === String(state.from || ''));

  try {
    state.lastRequest = await createBookingRequest(state.tenantId, {
      workplaceKey: state.workplaceKey,
      date: state.date,
      from: state.from,
      procedureIds: state.procedureIds,
    });
    state.notice = 'Запись отправлена в журнал.';
    state.error = '';
    exitBookingContext(state, {
      tab: 'journal',
      journalDate: String(state.date || ''),
    });
  } catch (error) {
    await refreshContext(state).catch(() => {});
    if (state.from && !slotStillAvailable()) {
      state.error = 'Выбранное время уже занято или стало недоступно. Выберите другое.';
      state.from = '';
      state.to = '';
      renderTimes(root, state);
      return;
    }
    state.error = accountFlowError(error, 'Не удалось подтвердить запись');
    renderConfirmation(root, state);
  }
}

async function refreshContext(state) {
  state.context = await getBookingContext(state.tenantId, state.lockedWorkplaceKey);
  state.settings = normalizeBookingSettings(state.context.settings);
}

function globalAccountState(initial = {}) {
  const journalDate = String(initial.journalDate || '').trim();
  return {
    tenantId: '',
    context: {},
    settings: normalizeBookingSettings(),
    accountDraft: {},
    contactErrors: {},
    account: null,
    accountTerms: null,
    accountTermsAccepted: false,
    relationships: [],
    accountRecords: [],
    error: '',
    accountJournalDate: /^\d{4}-\d{2}-\d{2}$/.test(journalDate) ? new Date(`${journalDate}T12:00:00`) : null,
    accountTab: String(initial.tab || 'journal'),
    accountDeckOpen: false,
    accountDeckActive: String(initial.tab === 'profile' ? 'profile' : initial.tab === 'history' ? 'history' : initial.tab === 'contacts' || initial.tab === 'contact-detail' ? 'contacts' : 'journal'),
    accountSelectedContactTenantId: String(initial.tab === 'contact-detail' ? initial.tenantId || '' : ''),
    accountSelectedChatTenantId: String(initial.tab === 'messages' ? initial.tenantId || '' : ''),
  };
}

function globalTermsFact(state) {
  const document = state.accountTerms || {};
  return {
    key: String(document.key || ''),
    version: Math.max(1, Number(document.version || 1)),
    accepted: Boolean(state.accountTermsAccepted),
    acceptedAt: new Date().toISOString(),
  };
}

async function renderGlobalClientHome(root, state) {
  const account = state.account || await getGlobalAccount();
  if (!account) {
    renderGlobalClientEntry(root, state);
    return;
  }
  state.account = account;

  const tab = String(state.accountTab || 'journal');
  const profileOnly = tab === 'profile' || tab === 'profile-settings';
  const needsRecords = tab === 'journal' || tab === 'contact-detail';
  const relationships = profileOnly
    ? await getGlobalAccountBookingTargets().catch(() => [])
    : await getGlobalAccountRelationships().catch(() => []);
  const records = needsRecords
    ? await getGlobalAccountRecords().catch(() => [])
    : [];

  state.relationships = Array.isArray(relationships) ? relationships : [];
  state.accountRecords = Array.isArray(records) ? records : [];
  await renderGlobalAccount(root, state, {
    onStartBooking: (tenantId, options = {}) => {
      const id = String(tenantId || '').trim();
      if (!id) return;
      const repeatRequest = options?.repeatRequest && typeof options.repeatRequest === 'object'
        ? options.repeatRequest
        : null;
      const workplaceKey = String(
        options?.workplaceKey
        || repeatRequest?.workplaceId
        || repeatRequest?.workplaceKey
        || ''
      ).trim();
      window.dispatchEvent(new CustomEvent('cova:account-booking-start', {
        detail: {
          tenantId: id,
          workplaceKey,
          repeatRequest,
          entry: repeatRequest ? 'repeat' : workplaceKey ? 'workplace' : 'profile',
        },
      }));
    },
    onLogout: () => {
      clearAccount('');
      state.account = null;
      state.relationships = [];
      state.accountRecords = [];
      state.error = '';
      renderGlobalClientEntry(root, state);
    },
  });
}

async function continueGlobalIdentity(root, state) {
  const platformState = await getGlobalAccountPlatformState();
  state.accountTerms = platformState?.document || state.accountTerms;
  state.accountTermsAccepted = Boolean(platformState?.accepted);
  if (!platformState?.accepted) {
    renderGlobalClientLegal(root, state);
    return;
  }
  await renderGlobalClientHome(root, state);
}

function renderGlobalClientEntry(root, state) {
  const rememberedIdentifier = state.accountDraft?.identifier
    || state.accountDraft?.email
    || getRememberedAccountEmail('')
    || '';
  const form = formView(`
    ${field({ label: 'Телефон или email', name: 'identifier', value: rememberedIdentifier, required: true, autocomplete: 'username' })}
    ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'current-password' })}
    ${formError(state.error)}
    <button type="button" class="v2-sticker-link" data-global-account-forgot>Забыли пароль?</button>
    <button type="button" class="v2-sticker-link" data-global-account-register>Зарегистрироваться</button>
  `, { data: 'id="global-account-entry" data-global-account-entry' });
  root.innerHTML = `<section class="${flowThemeClasses(state)}">${v2Sticker({
    title: 'Вход',
    body: form,
    action: '<button class="ui-button" type="submit" form="global-account-entry">Войти</button>',
    className: 'v2-sticker-screen--auth',
    closeData: 'data-global-account-u-close',
  })}</section>`;
  initPasswordFields(root);
  root.querySelector('[data-global-account-u-close]')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
  });
  root.querySelector('[data-global-account-forgot]')?.addEventListener('click', () => {
    openNotice({
      title: 'Восстановление пароля',
      message: 'Восстановление пароля пока недоступно.',
      action: 'Закрыть',
      variant: 'technical',
    });
  });
  const authForm = root.querySelector('[data-global-account-entry]');
  root.querySelector('[data-global-account-register]')?.addEventListener('click', async () => {
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    state.accountDraft = {
      ...(state.accountDraft || {}),
      identifier,
      ...(identifier.includes('@') ? { email: identifier.toLowerCase() } : {}),
    };
    state.error = '';
    try {
      state.accountTerms = await getAccountTerms();
      state.accountTermsAccepted = false;
      renderGlobalClientDetails(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось открыть регистрацию');
      renderGlobalClientEntry(root, state);
    }
  });
  authForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(authForm);
    if (validationError) {
      state.error = validationError;
      renderGlobalClientEntry(root, state);
      return;
    }
    const data = new FormData(authForm);
    const identifier = String(data.get('identifier') || '').trim();
    const password = String(data.get('password') || '');
    try {
      const prepared = await prepareGlobalAccount({ identifier });
      if (!prepared.exists) {
        state.accountDraft = {
          ...(state.accountDraft || {}),
          identifier,
          ...(prepared.identifierType === 'EMAIL' ? { email: identifier.toLowerCase() } : {}),
          ...(prepared.identifierType === 'PHONE' ? { phone: identifier } : {}),
        };
        state.error = 'Аккаунт не найден. Выберите «Зарегистрироваться».';
        renderGlobalClientEntry(root, state);
        return;
      }
      const payload = await loginGlobalAccount(identifier, password);
      state.account = payload.account;
      state.error = '';
      await continueGlobalIdentity(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось войти');
      renderGlobalClientEntry(root, state);
    }
  });
}

function renderGlobalClientDetails(root, state) {
  const draft = state.accountDraft || {};
  const contactErrors = state.contactErrors || {};
  renderFlowPage(root, state, {
    title: 'Регистрация',
    action: { label: 'Подтвердить', data: 'data-global-account-submit' },
    step: 'registration',
    body: formView(`
      ${field({ label: 'Имя', name: 'name', value: draft.name || '', required: true, autocomplete: 'given-name' })}
      ${field({ label: 'Фамилия', name: 'surname', value: draft.surname || '', autocomplete: 'family-name' })}
      ${phoneField({ label: 'Телефон', name: 'phone', value: draft.phone || '', required: true })}
      ${formError(contactErrors.phone || '')}
      ${field({ label: 'Email', name: 'email', value: draft.email || '', type: 'email', required: true, autocomplete: 'email' })}
      ${formError(contactErrors.email || '')}
      ${passwordField({ label: 'Пароль', name: 'password', required: true, autocomplete: 'new-password' })}
      ${passwordField({ label: 'Повтор пароля', name: 'repeatPassword', required: true, autocomplete: 'new-password' })}
      ${formError(state.error)}
    `, { data: 'data-global-account-form' }),
  });
  initPasswordFields(root);
  const form = root.querySelector('[data-global-account-form]');
  root.querySelector('[data-global-account-submit]')?.addEventListener('click', () => form?.requestSubmit());
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const validationError = formValidationMessage(form);
    if (validationError) {
      state.error = validationError;
      renderGlobalClientDetails(root, state);
      return;
    }
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim().toLowerCase();
    const phone = String(data.get('phone') || '').trim();
    const password = String(data.get('password') || '');
    const repeatPassword = String(data.get('repeatPassword') || '');
    if (password !== repeatPassword) {
      state.error = 'Пароли не совпадают.';
      renderGlobalClientDetails(root, state);
      return;
    }
    state.accountDraft = {
      ...(state.accountDraft || {}),
      name: String(data.get('name') || '').trim(),
      surname: String(data.get('surname') || '').trim(),
      email,
      phone,
      password,
    };
    try {
      const prepared = await prepareGlobalAccount({ email, phone });
      const conflict = 'Этот контакт уже зарегистрирован. Войдите в учетную запись.';
      state.contactErrors = {
        email: prepared?.conflicts?.email ? conflict : '',
        phone: prepared?.conflicts?.phone ? conflict : '',
      };
      if (state.contactErrors.email || state.contactErrors.phone) {
        state.error = '';
        renderGlobalClientDetails(root, state);
        return;
      }
      if (!state.accountTerms) state.accountTerms = await getAccountTerms();
      state.accountTermsAccepted = false;
      renderGlobalClientLegal(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось проверить контакты');
      renderGlobalClientDetails(root, state);
    }
  });
}

function renderGlobalClientLegal(root, state) {
  const document = state.accountTerms;
  if (!document) {
    void getAccountTerms().then((terms) => {
      state.accountTerms = terms;
      renderGlobalClientLegal(root, state);
    });
    return;
  }
  const cards = documentTiles([documentTile({
    title: document.title || 'Условия использования учетной записи',
    version: document.version || 1,
    openData: 'data-global-platform-document',
    toggleData: 'data-global-platform-toggle',
    toggleChecked: Boolean(state.accountTermsAccepted),
    aria: 'Открыть Условия использования учетной записи',
    toggleAria: 'Принять Условия использования учетной записи',
  })], { layout: 'rail' });
  root.innerHTML = `<section class="${flowThemeClasses(state)}">${v2Sticker({
    title: 'Документы',
    body: `${cards}${button('Продолжить', { data: 'data-global-platform-continue', disabled: !state.accountTermsAccepted })}${formError(state.error)}`,
    className: 'v2-sticker-screen--legal',
    closeData: 'data-global-legal-u-close',
  })}</section>`;
  root.querySelector('[data-global-legal-u-close]')?.addEventListener('click', () => renderGlobalClientDetails(root, state));
  root.querySelector('[data-global-platform-document]')?.addEventListener('click', () => {
    openConsentDocument(document);
  });
  root.querySelector('[data-global-platform-toggle]')?.addEventListener('click', () => {
    state.accountTermsAccepted = !state.accountTermsAccepted;
    renderGlobalClientLegal(root, state);
  });
  root.querySelector('[data-global-platform-continue]')?.addEventListener('click', async () => {
    if (!state.accountTermsAccepted) return;
    try {
      if (!state.account) {
        const payload = await registerGlobalAccount({
          ...state.accountDraft,
          password: state.accountDraft.password,
          accountTerms: globalTermsFact(state),
        });
        state.account = payload.account;
      } else {
        await acceptGlobalAccountTerms(globalTermsFact(state));
      }
      state.error = '';
      await renderGlobalClientHome(root, state);
    } catch (error) {
      state.error = accountFlowError(error, 'Не удалось сохранить документ');
      renderGlobalClientLegal(root, state);
    }
  });
}

export async function renderGlobalClient(root, initial = {}) {
  const state = globalAccountState(initial);
  renderFlowPage(root, state, { title: 'Профиль', subtitle: 'Загрузка…', center: true });
  try {
    const account = await getGlobalAccount();
    if (!account) {
      renderGlobalClientEntry(root, state);
      return;
    }
    state.account = account;
    await continueGlobalIdentity(root, state);
  } catch (error) {
    state.error = accountFlowError(error, 'Не удалось открыть профиль');
    renderGlobalClientEntry(root, state);
  }
}

export async function renderOnlineBooking(root, { tenantId = '', workplaceKey = '', procedureIds = [], entry = '', onExitToAccount = null } = {}) {
  const state = {
    tenantId: String(tenantId || ''),
    lockedWorkplaceKey: String(workplaceKey || ''),
    workplaceKey: String(workplaceKey || ''),
    context: {},
    settings: normalizeBookingSettings(),
    procedureIds: [],
    date: '',
    from: '',
    to: '',
    accountDraft: {},
    contactErrors: {},
    account: null,
    accountTerms: null,
    accountTermsAccepted: false,
    consents: {},
    error: '',
    notice: '',
    lastRequest: null,
    repeatSelection: Array.isArray(procedureIds) && procedureIds.length
      ? {
          workplaceKey: String(workplaceKey || ''),
          procedureIds: [...new Set(procedureIds.map((value) => String(value || '').trim()).filter(Boolean))],
        }
      : null,
    identityDestination: entry === 'account-booking' ? 'booking-start' : 'booking',
    bookingOrigin: entry === 'account' || entry === 'chat' || entry === 'account-booking' ? 'profile' : 'welcome',
    bookingStep: '',
    onExitToAccount,
    entry: String(entry || ''),
    platformOnlyLegal: false,
  };

  renderFlowPage(root, state, { title: 'Онлайн-запись', subtitle: 'Загрузка…', center: true });
  if (!state.tenantId) {
    renderFlowPage(root, state, { title: 'Онлайн-запись', body: emptyState('Ссылка недействительна', 'В ссылке отсутствует идентификатор онлайн-записи.'), center: true });
    return;
  }

  try {
    await refreshContext(state);
    const account = await getAccount(state.tenantId);
    if (account) state.account = account;
    if (state.entry === 'account-booking') {
      state.identityDestination = 'booking-start';
      if (!state.account) {
        renderAccountEntry(root, state);
        return;
      }
      await continueAfterIdentity(root, state);
      return;
    }
    if (state.entry === 'account' || state.entry === 'chat') {
      state.identityDestination = 'profile';
      if (!state.account) {
        renderAccountEntry(root, state);
        return;
      }
      await continueAfterIdentity(root, state);
      return;
    }
    if (state.account) {
      state.identityDestination = 'booking';
      await continueAfterIdentity(root, state);
      return;
    }
    renderWelcome(root, state);
  } catch (error) {
    renderFlowPage(root, state, {
      title: 'Онлайн-запись',
      body: emptyState('Запись недоступна', accountFlowError(error, 'Не удалось открыть онлайн-запись.')),
      center: true,
    });
  }
}
