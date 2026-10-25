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

export async function renderFinanceSection(root, section = 'cash', options = {}) {
  if (section === 'dds') {
    const { renderDDS } = await import('./dds/index.js');
    return renderDDS(root);
  }
  if (section === 'z-report') {
    const { renderZReport } = await import('./z-report/index.js');
    return renderZReport(root);
  }
  const { renderWallets } = await import('./cash/cash.js');
  return renderWallets(root, options);
}

export { renderFinanceSection as render };
