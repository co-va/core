import { loadProfileState } from '../core/profile/runtime.js';
import { loadOperationalState } from '../core/runtime/operational-state.js';

let prefetched = false;

function prefetchWhenJournalVisible() {
  if (prefetched) return;
  const journal = document.querySelector('[data-time-timeline], [data-journal-day], [data-journal-view]');
  if (!journal) return;
  prefetched = true;
  void Promise.allSettled([
    loadOperationalState({ full: true }),
    loadProfileState({ full: true }),
  ]).then((results) => {
    if (results.every((result) => result.status === 'rejected')) prefetched = false;
  });
}

const observer = new MutationObserver(prefetchWhenJournalVisible);
observer.observe(document.documentElement, { childList: true, subtree: true });

const onLogout = () => {
  prefetched = false;
};
const dispose = () => {
  observer.disconnect();
  window.removeEventListener('book:auth-logout', onLogout);
  window.removeEventListener('pagehide', dispose);
};

window.addEventListener('book:auth-logout', onLogout);
window.addEventListener('pagehide', dispose);
prefetchWhenJournalVisible();
