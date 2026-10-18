import {
  details,
  emptyState,
  entityCardRail,
  entityVisualCard,
  escapeHtml,
  shortDateTime,
  v2ListEntries,
  v2ListEntry,
  v2Section,
} from '../../ui/ui.js';
import { getUEI } from '../uei.js';
import { personalAccountVisualCard } from '../loyalty/personal-account/index.js';
import { getCachedPersonalAccount, loadPersonalAccount } from '../loyalty/personal-account/data.js';
import { getDepositInstances, listPersonDeposits } from '../loyalty/deposit/data.js';
import {
  depositCardAppearance,
  depositCardFields,
  depositCardPhoto,
  depositCardPhotoPosition,
} from '../loyalty/deposit/card-presentation.js';
import { getCertificateAssignmentsForPerson } from '../loyalty/certificate/index.js';
import { getSubscriptionAssignmentsForPerson } from '../loyalty/subscription/index.js';
import { getReferralAssignmentsForPerson } from '../loyalty/referral/index.js';
import { getBonusAssignmentsForPerson } from '../loyalty/bonus/index.js';
import { loyaltyCardFields } from '../loyalty/card-presentation.js';
import { loyaltyVisualCard } from '../loyalty/shared.js';
import {
  calculateInvestmentState,
  calculateLoanState,
  cashEntityCardAppearance,
  cashEntityCardFields,
  cashEntityCardPhoto,
  getFinanceEntityMovements,
  getInvestmentEntities,
  getLoanEntities,
  investmentRoleLabel,
  normalizeInvestmentTerms,
} from '../finance/index.js';

const text = (value) => String(value ?? '').trim();
const money = (value) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value || 0)).replaceAll('\u00a0', ' ')} ₽`;

function statusLabel(value = '') {
  if (value === 'used' || value === 'closed' || value === 'ended') return 'Завершено';
  if (value === 'paused') return 'Приостановлено';
  if (value === 'expired') return 'Срок завершён';
  return 'Активно';
}

function historyList(items = [], emptyText = 'Истории пока нет') {
  if (!items.length) return emptyState(emptyText, 'Движения появятся после использования.');
  return v2ListEntries(items.map((item) => v2ListEntry({
    title: item.title || 'Операция',
    subtitle: item.subtitle || shortDateTime(item.occurredAt, '—'),
    rightTop: item.rightTop || '',
    rightBottom: item.rightBottom || '',
    interactive: false,
    initial: '',
  })));
}

function personalAccountDetail(account, loadError = '') {
  if (loadError) return emptyState('Личный счёт временно недоступен', loadError);
  const value = account || {};
  const movements = (Array.isArray(value.movements) ? value.movements : []).slice().reverse().map((item) => ({
    title: item.kind === 'funding' ? 'Пополнение' : item.kind === 'withdrawal' ? 'Возврат' : item.kind === 'payment' ? 'Оплата' : 'Операция',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: `${String(item.direction || '').toUpperCase() === 'IN' ? '+' : '−'}${money(item.amount)}`,
    rightBottom: `Остаток ${money(item.balanceAfter)}`,
  }));
  const debts = (Array.isArray(value.debts) ? value.debts : []).map((item) => ({
    title: Number(item.outstandingAmount || 0) > 0.009 ? 'Задолженность' : 'Погашено',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: money(item.outstandingAmount || item.originalAmount),
  }));
  return `${details([
    { label: 'Денежный остаток', value: money(value.balance) },
    { label: 'Задолженность', value: money(value.debtTotal) },
    { label: 'Можно оплатить со счёта', value: `${Math.max(0, Math.min(100, Number(value.spendLimitPercent ?? 100) || 0))}%` },
  ])}${debts.length ? v2Section('Задолженности', historyList(debts)) : ''}${v2Section('История', historyList(movements))}`;
}

function depositCard(deposit) {
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  return entityVisualCard({
    appearance: depositCardAppearance(),
    fields: depositCardFields({
      uei: getUEI('loyalty-deposit', deposit?.depositId || deposit?.id) || '',
      title: deposit?.programName || 'Депозит',
      subtitle: terms.termRule || 'Бессрочно',
      status: statusLabel(deposit?.status),
      metaLeft: terms.benefit || 'Депозит',
      metaRight: money(deposit?.balance),
    }),
    image: depositCardPhoto(),
    imagePosition: depositCardPhotoPosition(),
    interactive: true,
    data: `data-person-program="deposit:${escapeHtml(deposit?.depositId || deposit?.id || '')}"`,
    aria: `Открыть депозит ${deposit?.programName || ''}`,
  });
}

function depositDetail(deposit = {}) {
  const terms = deposit?.terms && typeof deposit.terms === 'object' ? deposit.terms : {};
  const rows = [
    { label: 'UEI', value: getUEI('loyalty-deposit', deposit?.depositId || deposit?.id) || '—' },
    { label: 'Дата оформления', value: shortDateTime(deposit?.fundedAt, '—') },
    { label: 'Внесено', value: money(deposit?.fundedAmount) },
    { label: 'Остаток', value: money(deposit?.balance) },
    { label: 'Срок', value: terms.termRule || 'Бессрочно' },
    { label: 'Условие выгоды', value: terms.benefit || 'Без дополнительной выгоды' },
    { label: 'Состояние', value: statusLabel(deposit?.status) },
  ];
  const history = (Array.isArray(deposit.history) ? deposit.history : []).slice().reverse().map((item) => ({
    title: item.kind === 'deposit-funding' ? 'Внесение' : item.kind === 'deposit-withdrawal' ? 'Возврат остатка' : item.kind === 'payment' ? 'Использование при оплате' : 'Операция',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: `${String(item.direction || '').toUpperCase() === 'IN' ? '+' : '−'}${money(item.amount)}`,
  }));
  return `${details(rows)}${v2Section('История', historyList(history, 'Истории депозита пока нет'))}`;
}

function certificateCard({ instance, program }) {
  return loyaltyVisualCard('certificate', loyaltyCardFields({
    uei: program?.uei || '',
    title: program?.name || 'Сертификат',
    subtitle: 'Сертификат',
    status: statusLabel(instance?.status),
    metaLeft: instance?.expiresAt || program?.term || 'Бессрочно',
    metaRight: program?.type === 'amount' ? money(instance?.balance) : (instance?.status === 'used' ? 'Использован' : 'Активен'),
  }), {
    data: `data-person-program="certificate:${escapeHtml(instance?.id || '')}"`,
    aria: `Открыть сертификат ${program?.name || ''}`,
  });
}

function certificateDetail({ instance = {}, program = {} }) {
  const history = (Array.isArray(instance.history) ? instance.history : []).slice().reverse().map((item) => ({
    title: item.title || 'Использование',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: item.amount ? `−${money(item.amount)}` : '',
  }));
  return `${details([
    { label: 'Сертификат', value: program.name || '—' },
    { label: 'Дата оформления', value: shortDateTime(instance.issuedAt, '—') },
    { label: 'Исходное право', value: program.type === 'amount' ? money(instance.initialValue) : (program.service || 'Право по программе') },
    { label: 'Остаток', value: program.type === 'amount' ? money(instance.balance) : statusLabel(instance.status) },
    { label: 'Срок', value: instance.expiresAt || program.term || 'Бессрочно' },
    { label: 'Состояние', value: statusLabel(instance.status) },
  ])}${v2Section('История', historyList(history, 'Истории сертификата пока нет'))}`;
}

function subscriptionCard({ instance, program }) {
  const unlimited = program?.compositionMode === 'unlimited';
  return loyaltyVisualCard('subscription', loyaltyCardFields({
    uei: program?.uei || '',
    title: program?.name || 'Абонемент',
    subtitle: 'Абонемент',
    status: statusLabel(instance?.status),
    metaLeft: instance?.expiresAt || program?.termValue || 'Бессрочно',
    metaRight: unlimited ? 'Безлимит' : `Осталось ${Math.max(0, Number(instance?.remaining || 0))}`,
  }), {
    data: `data-person-program="subscription:${escapeHtml(instance?.id || '')}"`,
    aria: `Открыть абонемент ${program?.name || ''}`,
  });
}

function subscriptionDetail({ instance = {}, program = {} }) {
  const unlimited = program?.compositionMode === 'unlimited';
  const history = (Array.isArray(instance.history) ? instance.history : []).slice().reverse().map((item) => ({
    title: item.title || 'Использование',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: item.procedure || '',
  }));
  return `${details([
    { label: 'Абонемент', value: program.name || '—' },
    { label: 'Дата оформления', value: shortDateTime(instance.issuedAt, '—') },
    { label: 'Использовано', value: String(Math.max(0, Number(instance.used || 0))) },
    { label: 'Остаток', value: unlimited ? 'Безлимит' : String(Math.max(0, Number(instance.remaining || 0))) },
    { label: 'Начало', value: instance.startsAt || '—' },
    { label: 'Срок', value: instance.expiresAt || program.termValue || 'Бессрочно' },
    { label: 'Состояние', value: statusLabel(instance.status) },
  ])}${v2Section('История', historyList(history, 'Истории абонемента пока нет'))}`;
}

function referralCard({ program }) {
  return loyaltyVisualCard('referral', loyaltyCardFields({
    uei: program?.uei || '',
    title: program?.name || 'Реферальная программа',
    subtitle: 'Реферальная программа',
    status: statusLabel(program?.status),
    metaLeft: program?.term || 'Бессрочно',
    metaRight: `${Math.max(1, Number(program?.levels || 1))} ур.`,
  }), {
    data: `data-person-program="referral:${escapeHtml(program?.id || '')}"`,
    aria: `Открыть реферальную программу ${program?.name || ''}`,
  });
}

function referralDetail({ program = {}, relation = null }) {
  const rows = [
    { label: 'Программа', value: program.name || '—' },
    { label: 'Срок', value: program.term || 'Бессрочно' },
    { label: 'Состояние', value: statusLabel(program.status) },
    { label: 'Уровней', value: String(Math.max(1, Number(program.levels || 1))) },
  ];
  if (relation) {
    rows.push(
      { label: 'Пригласил', value: relation.inviterName || '—' },
      { label: 'Приглашён', value: relation.inviteeName || '—' },
      { label: 'Начислено', value: `${Math.max(0, Number(relation.reward || 0))} бонусов` },
    );
  }
  return details(rows);
}

function bonusCard({ program, participant = null }) {
  return loyaltyVisualCard('bonus', loyaltyCardFields({
    uei: program?.uei || '',
    title: program?.name || 'Бонусная программа',
    subtitle: 'Бонусная программа',
    status: statusLabel(program?.status),
    metaLeft: program?.term || 'Бессрочно',
    metaRight: participant ? `${Math.max(0, Number(participant.available || 0))} бонусов` : `${Math.max(0, Number(program?.rewardValue || 0))}${program?.rewardType === 'percent' ? '%' : ''}`,
  }), {
    data: `data-person-program="bonus:${escapeHtml(program?.id || '')}"`,
    aria: `Открыть бонусную программу ${program?.name || ''}`,
  });
}

function bonusDetail({ program = {}, participant = null }) {
  const rows = [
    { label: 'Программа', value: program.name || '—' },
    { label: 'Срок', value: program.term || 'Бессрочно' },
    { label: 'Состояние', value: statusLabel(program.status) },
  ];
  if (participant) {
    rows.push(
      { label: 'Начислено', value: `${Math.max(0, Number(participant.earned || 0))} бонусов` },
      { label: 'Использовано', value: `${Math.max(0, Number(participant.spent || 0))} бонусов` },
      { label: 'Доступно', value: `${Math.max(0, Number(participant.available || 0))} бонусов` },
    );
  }
  return details(rows);
}

function financeCard(entity, kind) {
  const movements = getFinanceEntityMovements(kind, entity.id);
  if (kind === 'loan') {
    const state = calculateLoanState(entity, movements);
    return entityVisualCard({
      appearance: cashEntityCardAppearance(entity, kind),
      fields: cashEntityCardFields(entity, state.totalDue, kind, state.endDate),
      image: cashEntityCardPhoto(entity, kind),
      interactive: true,
      data: `data-person-finance="loan:${escapeHtml(entity.id)}"`,
      aria: `Открыть займ ${entity.name || ''}`,
    });
  }
  const state = calculateInvestmentState(entity, movements);
  const terms = normalizeInvestmentTerms(entity);
  const balance = state.role === 'raise' ? state.remainingObligation : state.result;
  return entityVisualCard({
    appearance: cashEntityCardAppearance(entity, kind),
    fields: cashEntityCardFields(entity, balance, kind, '', {
      roleLabel: investmentRoleLabel(terms.role),
      balanceLabel: state.role === 'raise' ? 'Обязательства' : 'Результат',
      balanceValue: balance,
    }),
    image: cashEntityCardPhoto(entity, kind),
    interactive: true,
    data: `data-person-finance="investment:${escapeHtml(entity.id)}"`,
    aria: `Открыть инвестицию ${entity.name || ''}`,
  });
}

function financeDetail(entity, kind) {
  const movements = getFinanceEntityMovements(kind, entity.id);
  const state = kind === 'loan' ? calculateLoanState(entity, movements) : calculateInvestmentState(entity, movements);
  const rows = kind === 'loan'
    ? [
        { label: 'Займ', value: entity.name || '—' },
        { label: 'К возврату', value: money(state.totalDue) },
        { label: 'Срок', value: state.endDate || 'Бессрочно' },
      ]
    : [
        { label: 'Инвестиция', value: entity.name || '—' },
        { label: 'Роль', value: investmentRoleLabel(normalizeInvestmentTerms(entity).role) },
        { label: 'Результат', value: money(state.result) },
      ];
  const history = movements.slice().reverse().map((item) => ({
    title: item.articleName || item.operationKind || 'Финансовая операция',
    subtitle: shortDateTime(item.occurredAt, '—'),
    rightTop: money(item.amount || item.total),
  }));
  return `${details(rows)}${v2Section('История', historyList(history, 'Истории пока нет'))}`;
}

function personFinanceEntities(person = {}) {
  const personKey = text(person.key || person.id);
  const accountIds = new Set((Array.isArray(person.accounts) ? person.accounts : []).map(text).filter(Boolean));
  const investments = getInvestmentEntities().filter((entity) => {
    const terms = normalizeInvestmentTerms(entity);
    return Boolean(terms.participantAccountId && accountIds.has(text(terms.participantAccountId)))
      || text(entity.personKey) === personKey;
  });
  const loans = getLoanEntities().filter((entity) => text(entity.personKey) === personKey
    || (entity.loanTerms?.participantAccountId && accountIds.has(text(entity.loanTerms.participantAccountId))));
  return { investments, loans };
}

function cachedPersonDeposits(personKey = '') {
  const key = text(personKey);
  if (!key) return [];
  return getDepositInstances().filter((item) => {
    const person = item?.person && typeof item.person === 'object' ? item.person : {};
    return text(person.key || person.personKey || person.id) === key;
  });
}

export async function buildPersonRelationshipSections(person = {}, { refresh = true } = {}) {
  const key = text(person.key || person.id);
  const account = getCachedPersonalAccount(key);
  const accountError = '';
  const deposits = cachedPersonDeposits(key);
  const refreshPromise = refresh
    ? Promise.allSettled([
        loadPersonalAccount(key),
        listPersonDeposits(key),
      ])
    : null;
  const certificates = getCertificateAssignmentsForPerson(key);
  const subscriptions = getSubscriptionAssignmentsForPerson(key);
  const referrals = getReferralAssignmentsForPerson(key);
  const bonuses = getBonusAssignmentsForPerson(key);
  const finance = personFinanceEntities(person);

  const programCards = [
    ...(account ? [personalAccountVisualCard({
      person,
      balance: account.balance || 0,
      debt: account.debtTotal || 0,
      data: 'data-person-program="personal-account"',
      aria: 'Открыть Личный счёт',
    })] : []),
    ...deposits.map(depositCard),
    ...certificates.map(certificateCard),
    ...subscriptions.map(subscriptionCard),
    ...referrals.map(referralCard),
    ...bonuses.map(bonusCard),
  ];

  const financeCards = [
    ...finance.investments.map((item) => financeCard(item, 'investment')),
    ...finance.loans.map((item) => financeCard(item, 'loan')),
  ];

  const detailByKey = new Map([
    ...(account ? [['personal-account', { title: 'Личный счёт', body: personalAccountDetail(account, accountError) }]] : []),
    ...deposits.map((item) => [`deposit:${item.depositId || item.id}`, { title: item.programName || 'Депозит', body: depositDetail(item) }]),
    ...certificates.map((item) => [`certificate:${item.instance?.id}`, { title: item.program?.name || 'Сертификат', body: certificateDetail(item) }]),
    ...subscriptions.map((item) => [`subscription:${item.instance?.id}`, { title: item.program?.name || 'Абонемент', body: subscriptionDetail(item) }]),
    ...referrals.map((item) => [`referral:${item.program?.id}`, { title: item.program?.name || 'Реферальная программа', body: referralDetail(item) }]),
    ...bonuses.map((item) => [`bonus:${item.program?.id}`, { title: item.program?.name || 'Бонусная программа', body: bonusDetail(item) }]),
    ...finance.investments.map((item) => [`investment:${item.id}`, { title: item.name || 'Инвестиция', body: financeDetail(item, 'investment') }]),
    ...finance.loans.map((item) => [`loan:${item.id}`, { title: item.name || 'Займ', body: financeDetail(item, 'loan') }]),
  ]);

  const sectionMarkup = `${programCards.length ? v2Section('Программы', entityCardRail(programCards)) : ''}${financeCards.length ? v2Section('Инвестиции / Займы', entityCardRail(financeCards)) : ''}`;
  const markup = `<div data-person-relationships>${sectionMarkup}</div>`;

  return {
    markup,
    bind(scope, onOpen = () => {}) {
      const relationshipRoot = scope?.querySelector?.('[data-person-relationships]') || scope;
      relationshipRoot?.querySelectorAll?.('[data-person-program]').forEach((node) => {
        node.addEventListener('click', () => {
          const detail = detailByKey.get(String(node.dataset.personProgram || ''));
          if (detail) onOpen(detail);
        });
      });
      relationshipRoot?.querySelectorAll?.('[data-person-finance]').forEach((node) => {
        node.addEventListener('click', () => {
          const detail = detailByKey.get(String(node.dataset.personFinance || ''));
          if (detail) onOpen(detail);
        });
      });
      if (refreshPromise) {
        void refreshPromise.then(async () => {
          if (!scope?.isConnected) return;
          const fresh = await buildPersonRelationshipSections(person, { refresh: false });
          const current = scope.querySelector?.('[data-person-relationships]');
          if (!current) return;
          const template = document.createElement('template');
          template.innerHTML = fresh.markup;
          const next = template.content.querySelector('[data-person-relationships]');
          current.innerHTML = next?.innerHTML || '';
          fresh.bind(current, onOpen);
        });
      }
    },
  };
}
