import { loadOperationalState } from '../core/runtime/operational-state.js';

let prefetched = false;

function prefetchWhenJournalVisible() {
  if (prefetched) return;
  const journal = document.querySelector('[data-time-timeline], [data-journal-day], [data-journal-view]');
  if (!journal) return;
  prefetched = true;
  void loadOperationalState({ full: true }).catch(() => {
    prefetched = false;
  });
}

new MutationObserver(prefetchWhenJournalVisible)
  .observe(document.documentElement, { childList: true, subtree: true });

window.addEventListener('book:auth-logout', () => {
  prefetched = false;
});

prefetchWhenJournalVisible();
