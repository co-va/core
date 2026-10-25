import { apiRequest } from '../auth.js';
import { hydrateCashEntitiesFromServer, hydrateFinanceFromServer, hydrateWalletsFromServer } from '../finance/index.js';
import { hydrateProductsFromServer } from '../../core/service/products/data.js';
import { hydrateTagsFromServer } from '../../settings/tags/data.js';
import { hydrateCardAppearanceTemplates } from '../card-appearance-templates.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

async function payload(response, fallback) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.message || fallback);
  return value;
}

function hydrateAuxiliary(remote) {
  hydrateWalletsFromServer(Array.isArray(remote.wallets) ? clone(remote.wallets) : []);
  hydrateCashEntitiesFromServer({
    investments: Array.isArray(remote.investments) ? clone(remote.investments) : [],
    loans: Array.isArray(remote.loans) ? clone(remote.loans) : [],
  });
  hydrateTagsFromServer(Array.isArray(remote.tags) ? clone(remote.tags) : []);
  hydrateProductsFromServer({
    products: Array.isArray(remote.products) ? clone(remote.products) : [],
    productHistory: Array.isArray(remote.productHistory) ? clone(remote.productHistory) : [],
  });
  hydrateCardAppearanceTemplates(Array.isArray(remote.cardAppearanceTemplates) ? clone(remote.cardAppearanceTemplates) : []);
}

export async function loadAuxiliaryState() {
  const financeResponse = await apiRequest('/finance');
  const finance = await payload(financeResponse, 'Не удалось загрузить Финансы');
  hydrateFinanceFromServer(finance);

  void apiRequest('/auxiliary-state')
    .then((response) => payload(response, 'Не удалось загрузить связанные данные'))
    .then(hydrateAuxiliary)
    .catch((error) => console.error('Deferred auxiliary state load failed', error));

  return finance;
}
