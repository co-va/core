// Historical financial reconstruction belongs to the server. Do not
// resurrect materialized balances of expired deposits when backfilling.
type Row = Record<string, any>;
type Split = { amount: number; principalAmount: number; benefitAmount: number };
type EventKind = 'funding' | 'withdrawal' | 'refund' | 'payment' | 'candidate';
type Event = { occurred: number; kind: EventKind; principal?: number; bonus?: number };

function amount(value: unknown): number {
  const n = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}
function parts(value: unknown, depositId: string): Split | null {
  const values = Array.isArray(value) ? value : [];
  const row = values.map(object).find(entry => String(entry.depositId || entry.sourceId || entry.id) === depositId);
  if (!row) return null;
  const total = amount(row.amount);
  const principal = row.principalAmount == null ? total : amount(row.principalAmount);
  const bonus = row.benefitAmount == null ? amount(total - principal) : amount(row.benefitAmount);
  if (Math.abs(total - principal - bonus) > 0.009) throw new Error('История списаний депозита содержит несогласованные суммы');
  return { amount: total, principalAmount: principal, benefitAmount: bonus };
}
function moment(value: unknown): number {
  const at = value instanceof Date ? value : new Date(String(value ?? ''));
  return Number.isFinite(at.getTime()) ? at.getTime() : NaN;
}

export function depositHistoricalLedger(
  operations: unknown, depositIdValue: unknown, termsValue: unknown, at: Date, charge = 0,
): { available: number; allocation: Split | null } {
  const depositId = String(depositIdValue || '');
  const cutoff = moment(at);
  if (!depositId || !Number.isFinite(cutoff)) throw new Error('Не указаны депозит и дата операции');
  const terms = object(termsValue);
  const accrual = String(terms.benefitType || '').toLowerCase() === 'accrual';
  const rate = Math.max(0, Math.min(100, Number(terms.benefitValue) || 0));
  const events: Event[] = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (String(operation?.status) !== 'completed') continue;
    const occurred = moment(operation?.occurredAt);
    if (!Number.isFinite(occurred)) continue;
    const data = object(operation.data);
    const kind = String(operation.kind || '');
    const own = String(operation.sourceType || '') === 'deposit' && String(operation.sourceId || '') === depositId;
    if (kind === 'deposit-funding' && own) {
      const value = amount(data.amount ?? data.total);
      if (value > 0) events.push({ occurred, kind: 'funding', principal: value,
        bonus: accrual ? Math.round(value * rate) / 100 : 0 });
    } else if (kind === 'deposit-withdrawal' && own) {
      events.push({ occurred, kind: 'withdrawal' });
    } else if (kind === 'payment' || kind === 'refund') {
      const split = parts(data.depositAllocations, depositId);
      if (split?.amount) events.push({ occurred, kind, principal: split.principalAmount, bonus: split.benefitAmount });
    }
  }
  const additional = amount(charge);
  if (additional > 0) events.push({ occurred: cutoff, kind: 'candidate' });
  const rank: Record<EventKind, number> = { funding: 0, refund: 1, payment: 2, withdrawal: 3, candidate: 4 };
  events.sort((a, b) => a.occurred - b.occurred || rank[a.kind] - rank[b.kind]);
  let principal = 0;
  let bonus = 0;
  let available = 0;
  let captured = false;
  let allocation: Split | null = null;
  for (const event of events) {
    if (!captured && event.occurred > cutoff) { available = amount(principal + bonus); captured = true; }
    if (event.kind === 'funding' || event.kind === 'refund') {
      principal = Math.round((principal + (event.principal || 0)) * 100) / 100;
      bonus = Math.round((bonus + (event.bonus || 0)) * 100) / 100;
    } else if (event.kind === 'withdrawal') {
      principal = 0;
      bonus = 0;
    } else if (event.kind === 'payment') {
      principal = Math.round((principal - (event.principal || 0)) * 100) / 100;
      bonus = Math.round((bonus - (event.bonus || 0)) * 100) / 100;
    } else if (event.kind === 'candidate') {
      available = amount(principal + bonus);
      captured = true;
      if (additional > available + 0.009) throw new Error('Недостаточно средств на дату исторического визита');
      const p = Math.min(principal, additional);
      const b = Math.round((additional - p) * 100) / 100;
      principal = Math.round((principal - p) * 100) / 100;
      bonus = Math.round((bonus - b) * 100) / 100;
      allocation = { amount: additional, principalAmount: p, benefitAmount: b };
    }
    if (principal < -0.009 || bonus < -0.009) {
      throw new Error('Историческое списание превысит остаток депозита в одной из последующих операций');
    }
    if (!captured && event.occurred <= cutoff) available = amount(principal + bonus);
  }
  if (!captured) available = amount(principal + bonus);
  return { available, allocation };
}
