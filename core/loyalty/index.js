import { emptyState, page } from '../../ui/ui.js';
import { loyaltyHeader } from './shared.js';
import { canUseBookCapability } from '../access.js';

const LOYALTY_NAVIGATION = [
  { id: 'deposit', label: 'Депозит', capability: 'loyalty.deposit.access' },
  { id: 'personal-account', label: 'Личный счёт', capability: 'loyalty.personal_account.access' },
  { id: 'certificate', label: 'Сертификат', capability: 'loyalty.certificate.access' },
  { id: 'subscription', label: 'Абонемент', capability: 'loyalty.subscription.access' },
  { id: 'referral', label: 'Реферальная программа', capability: 'loyalty.referral.access' },
  { id: 'bonus', label: 'Бонусная программа', capability: 'loyalty.bonus.access' },
];

export function loyaltyNavigationItems() {
  return LOYALTY_NAVIGATION.filter((item) => canUseBookCapability(item.capability)).map(({ id, label }) => ({ id, label }));
}

export async function renderLoyaltySection(root, section = 'deposit') {
  if (!loyaltyNavigationItems().some((item) => item.id === section)) {
    root.innerHTML = page([loyaltyHeader('Лояльность'), emptyState('Инструмент недоступен', 'У вас нет доступа к этому инструменту.')]);
    return;
  }
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
