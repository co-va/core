import { getDepositInstances } from './deposit/data.js';
import { getCertificateAssignmentsForPerson } from './certificate/index.js';
import { getSubscriptionAssignmentsForPerson } from './subscription/index.js';
import { getReferralAssignmentsForPerson } from './referral/index.js';
import { getBonusAssignmentsForPerson } from './bonus/index.js';

const text = (value) => String(value ?? '').trim();
const percent = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function personKeyOf(personOrKey = '') {
  if (personOrKey && typeof personOrKey === 'object') {
    return text(personOrKey.key || personOrKey.id);
  }
  return text(personOrKey);
}

function option({ type, typeLabel, assignmentId = '', programId = '', name = '', pricePercent = 0 } = {}) {
  const normalizedType = text(type);
  const normalizedAssignmentId = text(assignmentId);
  const normalizedProgramId = text(programId);
  const stableId = normalizedAssignmentId || normalizedProgramId;
  if (!normalizedType || !stableId) return null;
  return {
    key: `${normalizedType}:${stableId}`,
    type: normalizedType,
    typeLabel: text(typeLabel) || 'Программа',
    assignmentId: normalizedAssignmentId,
    programId: normalizedProgramId,
    name: text(name) || 'Программа',
    pricePercent: percent(pricePercent),
  };
}

function activeStatus(value = '') {
  const status = text(value).toLowerCase();
  return !status || status === 'active';
}

function depositOptions(personKey) {
  return getDepositInstances()
    .filter((deposit) => personKeyOf(deposit?.person) === personKey && activeStatus(deposit?.status))
    .map((deposit) => option({
      type: 'deposit',
      typeLabel: 'Депозит',
      assignmentId: deposit?.depositId || deposit?.id,
      programId: deposit?.programId,
      name: deposit?.programName || 'Депозит',
      pricePercent: deposit?.discountPercent,
    }))
    .filter(Boolean);
}

function certificateOptions(personKey) {
  return getCertificateAssignmentsForPerson(personKey)
    .filter(({ instance, program }) => activeStatus(program?.status)
      && !['used', 'closed', 'ended', 'expired'].includes(text(instance?.status).toLowerCase()))
    .map(({ instance, program }) => option({
      type: 'certificate',
      typeLabel: 'Сертификат',
      assignmentId: instance?.id,
      programId: program?.id || instance?.programId,
      name: program?.name || 'Сертификат',
    }))
    .filter(Boolean);
}

function subscriptionOptions(personKey) {
  return getSubscriptionAssignmentsForPerson(personKey)
    .filter(({ instance, program }) => activeStatus(program?.status)
      && !['closed', 'ended', 'expired', 'paused'].includes(text(instance?.status).toLowerCase()))
    .map(({ instance, program }) => option({
      type: 'subscription',
      typeLabel: 'Абонемент',
      assignmentId: instance?.id,
      programId: program?.id || instance?.programId,
      name: program?.name || 'Абонемент',
    }))
    .filter(Boolean);
}

function referralOptions(personKey) {
  return getReferralAssignmentsForPerson(personKey)
    .filter(({ relation, program }) => activeStatus(program?.status)
      && text(relation?.status).toLowerCase() !== 'cancelled')
    .map(({ relation, program }) => {
      const isInvitee = relation && text(relation?.inviteeKey) === personKey;
      const referralPercent = isInvitee && text(program?.inviteeBenefit) === 'discount'
        ? program?.inviteeBenefitValue
        : 0;
      return option({
        type: 'referral',
        typeLabel: 'Реферальная программа',
        assignmentId: relation?.id || '',
        programId: program?.id,
        name: program?.name || 'Реферальная программа',
        pricePercent: referralPercent,
      });
    })
    .filter(Boolean);
}

function bonusOptions(personKey) {
  return getBonusAssignmentsForPerson(personKey)
    .filter(({ participant, program }) => activeStatus(program?.status)
      && (!participant || activeStatus(participant?.assignmentStatus)))
    .map(({ participant, program }) => option({
      type: 'bonus',
      typeLabel: 'Бонусная программа',
      assignmentId: participant?.id || '',
      programId: program?.id,
      name: program?.name || 'Бонусная программа',
    }))
    .filter(Boolean);
}

export function getRecordProgramOptions(personOrKey = '') {
  const personKey = personKeyOf(personOrKey);
  if (!personKey) return [];
  const values = [
    ...depositOptions(personKey),
    ...certificateOptions(personKey),
    ...subscriptionOptions(personKey),
    ...referralOptions(personKey),
    ...bonusOptions(personKey),
  ];
  const seen = new Set();
  return values.filter((item) => {
    if (!item?.key || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

export function recordProgramSelection(optionValue = null) {
  if (!optionValue?.key || !optionValue?.type) return null;
  return {
    key: text(optionValue.key),
    type: text(optionValue.type),
    assignmentId: text(optionValue.assignmentId),
    programId: text(optionValue.programId),
    name: text(optionValue.name),
    pricePercent: percent(optionValue.pricePercent),
  };
}

export function getSelectedRecordProgram(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  if (!stored) return null;
  const personKey = personKeyOf(record?.person);
  const options = getRecordProgramOptions(personKey);
  const storedKey = text(stored.key);
  if (storedKey) return options.find((item) => item.key === storedKey) || { ...stored, pricePercent: percent(stored.pricePercent) };
  const storedType = text(stored.type);
  const storedAssignment = text(stored.assignmentId);
  const storedProgram = text(stored.programId);
  return options.find((item) => item.type === storedType
    && ((storedAssignment && item.assignmentId === storedAssignment)
      || (!storedAssignment && storedProgram && item.programId === storedProgram)))
    || { ...stored, pricePercent: percent(stored.pricePercent) };
}

export function selectedRecordProgramPricePercent(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  return percent(stored?.pricePercent);
}

export function selectedRecordDepositId(record = null) {
  const stored = record?.loyaltyProgram && typeof record.loyaltyProgram === 'object'
    ? record.loyaltyProgram
    : null;
  return text(stored?.type) === 'deposit' ? text(stored?.assignmentId) : '';
}
