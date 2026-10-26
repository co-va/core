import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { field, openRecordCreationOwner, recordPersonList } from '../ui/ui.js';
import { renderGlobalClient } from './booking.js';
import { renderAccess } from './access.js';

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
  const content = document.querySelector('#app-content');
  creationOwner?.close?.();
  if (!id || !content) return;

  await renderAccess(content, {
    tenantId: id,
    workplaceKey: '',
    procedureIds: [],
  });
}

async function openAccountBookingProfessionalSelector() {
  const owner = openRecordCreationOwner();
  if (!owner) return null;

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
      void startJournalBooking(tenantId, owner);
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
await renderGlobalClientRoot();
