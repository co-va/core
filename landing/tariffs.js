// Landing is a read-only storefront. Core owns pricing and the period quote.
const registrationOrigin = 'https://prof.va-tools.ru/invite/';
const source = new URLSearchParams(location.search);
const invitationToken = source.get('invite') || '';
const periodSelect = document.querySelector('[data-tariff-period]');
const priceNodes = document.querySelectorAll('[data-tariff-price]');
const links = [...document.querySelectorAll('[data-tariff-entry]')];
let offers = null;

function registrationUrl(tariff, months) {
  const url = new URL(registrationOrigin);
  if (invitationToken) url.searchParams.set('token', invitationToken);
  if (tariff !== 'demo') url.searchParams.set('tariff', tariff);
  if (tariff === 'start-plus' || tariff === 'pro') url.searchParams.set('months', String(months));
  return url.toString();
}

function currency(minor) {
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB',
    maximumFractionDigits: 0 }).format(minor / 100);
}

function renderIncludedTools() {
  for (const list of document.querySelectorAll('[data-tariff-tools]')) {
    const offer = offers?.professional?.find((item) => item.key === list.dataset.tariffTools);
    const names = [...new Set((offer?.tools || []).map((tool) => String(tool?.name || '').trim()).filter(Boolean))];
    list.replaceChildren();
    for (const name of names) {
      const row = document.createElement('li');
      row.textContent = name;
      list.append(row);
    }
    if (!names.length) {
      const row = document.createElement('li');
      row.className = 'is-unavailable';
      row.textContent = offers ? 'Состав тарифа пока не настроен' : 'Состав тарифа недоступен';
      list.append(row);
    }
  }
}

function render() {
  const months = Number(periodSelect?.value || 1);
  for (const link of links) {
    const key = link.dataset.tariffEntry;
    link.href = registrationUrl(key, months);
    if (key === 'demo' || key === 'start') continue;
    const offer = offers?.professional?.find((item) => item.key === 'tariff.' + key);
    const period = offer?.periods?.find((item) => item.months === months);
    const available = offer?.purchasable === true && Number(offer.priceMinor) > 0 && Boolean(period);
    link.setAttribute('aria-disabled', String(!available));
    link.tabIndex = available ? 0 : -1;
    const node = [...priceNodes].find((item) => item.dataset.tariffPrice === 'tariff.' + key);
    if (node) node.textContent = available
      ? currency(offer.priceMinor * months) : 'Цена не установлена';
    const detail = document.querySelector('[data-tariff-description="tariff.' + key + '"]');
    if (detail) detail.textContent = available
      ? period.accessDays + ' дней доступа' +
        (period.bonusDays ? ' · ' + period.bonusDays + ' дней в подарок' : '')
      : 'Стоимость и срок доступа появятся после настройки тарифа.';
  }
  renderIncludedTools();
}

periodSelect?.addEventListener('change', render);
render();
try {
  const response = await fetch('/saas-commercial-public/tariffs', {
    headers: { Accept: 'application/json' }, cache: 'no-store',
  });
  if (!response.ok) throw new Error('Tariff service unavailable');
  offers = await response.json();
} catch {
  // Unconfigured, offline or older backend: never invent a paid price.
  offers = null;
}
render();
