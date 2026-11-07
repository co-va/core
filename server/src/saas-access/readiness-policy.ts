// Explicit readiness policy layered on top of the user's stored tool permissions.
// Existing stored grants are never mutated by this policy.
import type { ResolvedCapability } from './saas-access.service';

export type ReadinessGateRow = {
  key: string;
  status: string;
  enforced: boolean;
};

export const CABINET_READINESS_CAPABILITIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'cabinet.people': ['people.access'],
  'cabinet.journal.day': ['journal.day.access'],
  'cabinet.journal.month': ['journal.month.access'],
  'cabinet.journal.list': ['journal.list.access'],
  'cabinet.profile.data': ['profile.access'],
  'cabinet.timetable': ['timetable.access'],
  'cabinet.service': ['services.access'],
  'cabinet.chat': ['chat.access'],
  'cabinet.loyalty.deposit': ['loyalty.deposit.access'],
  'cabinet.loyalty.personal-account': ['loyalty.personal_account.access'],
  'cabinet.loyalty.certificate': ['loyalty.certificate.access'],
  'cabinet.loyalty.subscription': ['loyalty.subscription.access'],
  'cabinet.loyalty.referral': ['loyalty.referral.access'],
  'cabinet.loyalty.bonus': ['loyalty.bonus.access'],
  'cabinet.finance.cash': ['finance.cash.access', 'finance.investment.self.access', 'finance.investment.raise.access', 'finance.investment.external.access'],
  'cabinet.finance.dds': ['finance.dds.access', 'finance.income_expense.access', 'finance.articles.access', 'finance.special.access'],
  'cabinet.finance.z-report': ['finance.z_report.access'],
  'cabinet.inventory.stock': ['inventory.stock.access'],
  'cabinet.inventory.movements': ['inventory.movements.access'],
  'cabinet.inventory.order': ['inventory.order.access'],
  'cabinet.inventory.stocktake': ['inventory.stocktake.access'],
  'cabinet.settings.data-transfer': ['data_transfer.access'],
  'cabinet.settings.online-booking': ['online_booking.access'],
  'cabinet.settings.notifications': ['notifications.access'],
  'cabinet.settings.integrations': ['integrations.access'],
  'cabinet.settings.documents': ['documents.access'],
  'cabinet.settings.tags': ['tags.access'],
});

const capabilityToReadinessKey = new Map<string, string>();
for (const [key, capabilityKeys] of Object.entries(CABINET_READINESS_CAPABILITIES)) {
  for (const capabilityKey of capabilityKeys) {
    if (capabilityToReadinessKey.has(capabilityKey)) throw new Error('Duplicate readiness capability: ' + capabilityKey);
    capabilityToReadinessKey.set(capabilityKey, key);
  }
}

export function applyReadinessGate(
  capability: ResolvedCapability,
  rows: readonly ReadinessGateRow[],
  actor: { isTester: boolean; isOwnerBook: boolean; commercialMode?: string },
): ResolvedCapability {
  if (capability.valueType !== 'BOOLEAN' || capability.enabled !== true) return capability;
  const key = capabilityToReadinessKey.get(capability.key);
  if (!key) return capability;
  // Readiness is the authoritative visibility policy for all commercial modes.
  // Old "enforced" markers are intentionally ignored: NOT_READY must never leak.
  const row = rows.find((item) => item.key === key);
  const allowed = row?.status === 'READY'
    || (row?.status === 'TESTING'
      && (actor.commercialMode === 'DEMO' || actor.isTester || actor.isOwnerBook));
  return allowed ? capability : { ...capability, enabled: false, source: 'READINESS' };
}
