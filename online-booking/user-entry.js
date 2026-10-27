import { getGlobalAccountBookingTargets } from '../core/account/booking-targets.js';
import { openAccountBookingFlow } from './account-booking-flow.js';
import { renderGlobalClient } from './booking.js';

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

async function renderGlobalClientRoot(initial = {}) {
  const nextRoot = document.createElement('main');
  nextRoot.className = 'booking-content';
  nextRoot.id = 'app-content';

  await renderGlobalClient(nextRoot, initial);

  disposeView();
  disposeView = () => {};
  setThemeColor('#2F3338');
  app.classList.add('app-shell--booking');
  app.replaceChildren(nextRoot);
  syncViewport();
}

function startAccountBooking(detail = {}) {
  const options = detail && typeof detail === 'object' ? detail : {};
  void openAccountBookingFlow({
    tenantId: String(options.tenantId || ''),
    workplaceKey: String(options.workplaceKey || ''),
    procedureIds: Array.isArray(options.procedureIds) ? options.procedureIds : [],
    onCreated: async (result) => {
      await renderGlobalClientRoot({
        tab: 'journal',
        journalDate: String(result?.date || ''),
      });
    },
  });
}

window.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncViewport, { passive: true });
window.addEventListener('cova:account-journal-open-contacts', () => {
  startAccountBooking();
});
window.addEventListener('cova:account-start-booking', (event) => {
  startAccountBooking(event?.detail || {});
});

syncViewport();
const bookingTargetsPrefetch = getGlobalAccountBookingTargets().catch(() => []);
await renderGlobalClientRoot();
void bookingTargetsPrefetch;
