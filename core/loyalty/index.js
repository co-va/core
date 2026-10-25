import { emptyState, page } from '../../ui/ui.js';
import { loyaltyHeader } from './shared.js';

const LOYALTY_NAVIGATION = [
  { id: 'deposit', label: 'Депозит' },
  { id: 'personal-account', label: 'Личный счёт' },
  { id: 'certificate', label: 'Сертификат' },
  { id: 'subscription', label: 'Абонемент' },
  { id: 'referral', label: 'Реферальная программа' },
  { id: 'bonus', label: 'Бонусная программа' },
];

export function loyaltyNavigationItems() {
  return LOYALTY_NAVIGATION.map((item) => ({ ...item }));
}

export async function renderLoyaltySection(root, section = 'deposit') {
  if (section === 'deposit') {
    const { renderDeposit } = await import('./deposit/index.js');
    return renderDeposit(root);
  }
  if (section === 'personal-account') {
    const { renderPersonalAccount } = await import('./personal-account/index.js');
    return renderPersonalAccount(root);
  }
  if (section === 'certificate') {
    const { renderCertificate } = await import('./certificate/index.js');
    return renderCertificate(root);
  }
  if (section === 'subscription') {
    const { renderSubscription } = await import('./subscription/index.js');
    return renderSubscription(root);
  }
  if (section === 'referral') {
    const { renderReferral } = await import('./referral/index.js');
    return renderReferral(root);
  }
  if (section === 'bonus') {
    const { renderBonus } = await import('./bonus/index.js');
    return renderBonus(root);
  }
  root.innerHTML = page([
    loyaltyHeader('Лояльность'),
    emptyState('Раздел не найден', 'Выберите инструмент Лояльности в меню.'),
  ]);
}

export { renderLoyaltySection as render };
