import { emptyState, page } from '../../ui/ui.js';
import { loyaltyHeader } from './shared.js';
import { canUseBookCapability } from '../access.js';

const LOYALTY_NAVIGATION = [
  { id: 'deposit', label: 'Депозит' },
  { id: 'personal-account', label: 'Личный счёт' },
  { id: 'certificate', label: 'Сертификат' },
  { id: 'subscription', label: 'Абонемент' },
  { id: 'referral', label: 'Реферальная программа' },
  { id: 'bonus', label: 'Бонусная программа' },
];

const LOYALTY_CAPABILITIES = Object.freeze({
  'deposit': 'loyalty.deposit.access',
  'personal-account': 'loyalty.personal_account.access',
  'certificate': 'loyalty.certificate.access',
  'subscription': 'loyalty.subscription.access',
  'referral': 'loyalty.referral.access',
  'bonus': 'loyalty.bonus.access',
});

export function loyaltyNavigationItems() {
  return LOYALTY_NAVIGATION.filter((item) => canUseBookCapability(LOYALTY_CAPABILITIES[item.id])).map(({ id, label }) => ({ id, label }));
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
