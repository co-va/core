import { accountErrorMessage, createBookingRequest, getAccount, getBookingContext } from '../core/account/index.js';
import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { normalizeBookingSettings } from '../core/booking-settings/index.js';
import { openRecords } from '../core/records/records.js';
import { field, openNotice, openRecordCreationOwner, recordPersonList, v2ListEntry, v2ListEntries } from '../ui/ui.js';
import { renderGlobalClient } from './booking.js';
import {
  bookingProcedureCost,
  getBookingProcedures,
  getBookingSlots,
  getBookingTimeRows,
  getBookingWorkingDates,
} from './model.js';

const app = document.querySelector('#app');
let disposeView = () => {};

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

function workplaceRows(workplaces = []) {
  return v2ListEntries(workplaces.map((workplace) => v2ListEntry({
    title: String(workplace?.name || '').trim() || 'Рабочее пространство',
    subtitle: [workplace?.city, workplace?.address].map((value) => String(value || '').trim()).filter(Boolean).join(', '),
    interactive: true,
    data: `data-account-booking-workplace="${String(workplace?.key || '')}"`,
    aria: `Выбрать рабочее пространство ${String(workplace?.name || '').trim()}`,
  })));
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

  const resolveAccount = async () => {
    if (account) return account;
    const result = await accountResultPromise;
    if (result.error) throw result.error;
    account = result.account;
    if (!account) throw new Error('Account is unavailable');
    return account;
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
      procedureIds: procedures.map((entry) => String(entry.id || '')),
      step: settings.slotStep,
    }),
    personDisplay: (person = {}) => ({
      uei: String(person?.uei || person?.person?.uei || ''),
      name: [person?.name, person?.surname].filter(Boolean).join(' ').trim() || accountDisplayName(account),
      phone: String(person?.phone || person?.phones?.[0] || ''),
    }),
    discount: () => accountDiscount(account),
    total: (recordsState) => {
      const subtotal = recordsState.procedures.reduce((sum, entry) => sum + numericCost(entry.cost), 0);
      return Math.max(0, subtotal * (1 - accountDiscount(account) / 100));
    },
    async create(recordsState) {
      return createBookingRequest(id, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        from: recordsState.from,
        procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')).filter(Boolean),
      });
    },
    async onCreateError(error, recordsState, { renderTimes, renderConfirmation }) {
      bookingContext = await getBookingContext(id, recordsState.workplaceId).catch(() => bookingContext);
      const stillAvailable = getBookingSlots(bookingContext, {
        workplaceKey: recordsState.workplaceId,
        date: recordsState.date,
        procedureIds: recordsState.procedures.map((entry) => String(entry.id || '')),
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

  const openBooking = async (workplaceKey) => {
    if (!creationOwner.isOpen()) return;
    let resolvedAccount;
    try {
      resolvedAccount = await resolveAccount();
    } catch (error) {
      openNotice({ title: 'Запись недоступна', message: accountErrorMessage(error, 'Не удалось определить пользователя приложения.') });
      return;
    }
    if (!creationOwner.isOpen()) return;
    openRecords({
      context: 'online',
      person: resolvedAccount,
      workplaceId: String(workplaceKey || ''),
      procedures: [],
      professionalActions: false,
      provider,
      creationOwner,
      stepBack: true,
      onBackFromStart: () => workplaces.length > 1 ? renderWorkplaces() : showProfessionals(),
      onCreated: async (result) => {
        await renderGlobalClientRoot({
          tab: 'journal',
          journalDate: String(result?.date || ''),
        });
      },
    });
  };

  const renderWorkplaces = () => {
    if (!creationOwner.isOpen()) return false;
    creationOwner.setBackHandler?.(() => showProfessionals());
    const view = creationOwner.render({
      step: 'workplace',
      title: 'Выбор пространства',
      body: workplaceRows(workplaces),
    });
    view?.body?.querySelectorAll('[data-account-booking-workplace]').forEach((node) => node.addEventListener('click', () => {
      const workplaceKey = String(node.dataset.accountBookingWorkplace || '');
      if (workplaceKey) void openBooking(workplaceKey);
    }));
    return true;
  };

  if (workplaces.length === 1) {
    await openBooking(String(workplaces[0]?.key || ''));
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
