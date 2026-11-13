import { tariffBenefits, tariffHeadline, tariffNewBenefits } from './tariff-benefits.js';

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
  const tiers = offers?.professional || [];
  document.querySelectorAll('[data-tariff-tools]').forEach((list) => {
    const index = tiers.findIndex((tier) => tier.key === list.dataset.tariffTools);
    const tier = tiers[index];
    const previous = index > 0 ? tiers[index - 1] : null;
    const benefits = tariffBenefits(tier);
    const earlier = previous ? tariffBenefits(previous) : [];
    const inherits = earlier.length > 0 && earlier.every((item) =>
      benefits.some((entry) => entry.title === item.title));
    const additional = inherits ? tariffNewBenefits(tier, previous) : benefits;
    const headline = document.querySelector('[data-tariff-headline="' + list.dataset.tariffTools + '"]');
    if (headline) headline.textContent = tariffHeadline(list.dataset.tariffTools);
    list.replaceChildren();
    const appendBenefit = (title, detail = '', inherited = false) => {
      const row = document.createElement('li');
      if (inherited) row.className = 'is-inherited';
      const strong = document.createElement('strong');
      strong.textContent = title;
      row.append(strong);
      if (detail) {
        const body = document.createElement('span');
        body.textContent = detail;
        row.append(body);
      }
      list.append(row);
    };
    if (inherits) appendBenefit('Все возможности ' + previous.name);
    for (const benefit of additional) appendBenefit(benefit.title, benefit.detail);
    if (!benefits.length) appendBenefit(offers ? 'Состав тарифа пока не настроен' : 'Пока не удалось загрузить состав тарифа');
  });
}

function render() {
  const months = Number(periodSelect?.value || 1);
  for (const link of links) {
    const key = link.dataset.tariffEntry;
    link.href = registrationUrl(key, months);
    if (key === 'demo') continue;
    const offer = offers?.professional?.find((item) => item.key === 'tariff.' + key);
    const period = offer?.periods?.find((item) => item.months === months);
    const available = offer?.published === true && offer?.purchasable === true &&
      (key === 'start' || (Number(offer.priceMinor) > 0 && Boolean(period)));
    const card = link.closest('.tariff-card');
    if (card) card.hidden = !available;
    link.setAttribute('aria-disabled', String(!available));
    link.tabIndex = available ? 0 : -1;
    // The free Start plan has no paid period or price to render.
    if (key === 'start') continue;
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
