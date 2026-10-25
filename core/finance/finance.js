import { canUseBookCapability } from '../access.js';

const FINANCE_NAVIGATION = [
  { id: 'cash', label: 'Касса', capability: 'finance.cash.access' },
  { id: 'dds', label: 'ДДС', capability: 'finance.dds.access' },
  { id: 'z-report', label: 'Z-отчёт', capability: 'finance.z_report.access' },
];

function investmentAccessAllowed() {
  return canUseBookCapability('finance.investment.self.access')
    || canUseBookCapability('finance.investment.raise.access')
    || canUseBookCapability('finance.investment.external.access');
}

export function financeNavigationItems() {
  const cashAccess = canUseBookCapability('finance.cash.access');
  return FINANCE_NAVIGATION
    .filter((item) => item.id === 'cash'
      ? (cashAccess || investmentAccessAllowed())
      : canUseBookCapability(item.capability))
    .map(({ id, label }) => ({
      id,
      label: id === 'cash' && !cashAccess && investmentAccessAllowed() ? 'Инвестиции' : label,
    }));
}

export function renderFinanceSection(root, section = 'cash', options = {}) {
  if (section === 'dds') {
    return import('./dds/index.js').then(({ renderDDS }) => renderDDS(root));
  }
  if (section === 'z-report') {
    return import('./z-report/index.js').then(({ renderZReport }) => renderZReport(root));
  }
  return import('./cash/cash.js').then(({ renderWallets }) => renderWallets(root, options));
}

export { renderFinanceSection as render };
