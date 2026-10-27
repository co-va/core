let bookingContext = null;

function text(value) {
  return String(value ?? '').trim();
}

function scheduledWorkplaces(context = bookingContext) {
  const days = Array.isArray(context?.days) ? context.days : [];
  return new Set(days.map((day) => text(day?.workplaceId)).filter(Boolean));
}

function applyWorkplaceAvailability() {
  if (!bookingContext) return;
  const scheduled = scheduledWorkplaces();
  document.querySelectorAll('[data-booking-workplace]').forEach((node) => {
    const key = text(node.dataset.bookingWorkplace);
    const enabled = Boolean(key && scheduled.has(key));
    if ('disabled' in node) node.disabled = !enabled;
    node.toggleAttribute('aria-disabled', !enabled);
    node.classList.toggle('is-disabled', !enabled);
    if (!enabled) node.setAttribute('title', 'Расписание не настроено');
    else node.removeAttribute('title');
  });
}

const originalFetch = window.fetch.bind(window);
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const url = text(args[0]?.url || args[0]);
  if (response.ok && /\/online-booking\/[^/?]+\/context(?:\?|$)/.test(url)) {
    void response.clone().json().then((payload) => {
      bookingContext = payload && typeof payload === 'object' ? payload : null;
      applyWorkplaceAvailability();
    }).catch(() => {});
  }
  return response;
};

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-booking-workplace]') : null;
  if (!target || target.getAttribute('aria-disabled') !== 'true') return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

new MutationObserver(() => applyWorkplaceAvailability())
  .observe(document.documentElement, { childList: true, subtree: true });
