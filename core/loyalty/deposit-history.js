// Read-only financial timeline for backfilled deposits. A materialized
// "expired" balance is not the balance that existed on a past service date.
// The canonical FinanceOperation journal owns all historic movements.
function amount(value) {
  const n = Number(String(value ?? 0).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parts(value, depositId) {
  const values = Array.isArray(value) ? value : [];
  const row = values.map(object).find(entry => String(entry.depositId || entry.sourceId || entry.id) === depositId);
  if (!row) return null;
  const total = amount(row.amount);
  const principal = row.principalAmount == null ? total : amount(row.principalAmount);
  const bonus = row.benefitAmount == null ? Math.max(0, Math.round((total - principal) * 100) / 100) : amount(row.benefitAmount);
  if (Math.abs(total - principal - bonus) > 0.009) {
    throw new Error('История списаний депозита содержит несогласованные суммы');
  }
  return { total, principal, bonus };
}

function moment(value) {
  const at = value instanceof Date ? value : new Date(value);
  return Number.isFinite(at.getTime()) ? at.getTime() : NaN;
}

// Returns the actual historical balance at "at". If "charge" is present,
// reconstructs the whole timeline with a proposed backdated payment and
// rejects it if any subsequent operation would overdraw the same principal.
export function depositHistoricalLedger(operations, depositIdValue, termsValue, at, charge = 0) {
  const depositId = String(depositIdValue || '');
  const cutoff = moment(at);
  if (!depositId || !Number.isFinite(cutoff)) throw new Error('Не указаны депозит и дата операции');
  const terms = object(termsValue);
  const accrual = String(terms.benefitType || '').toLowerCase() === 'accrual';
  const rate = Math.max(0, Math.min(100, Number(terms.benefitValue) || 0));
  const events = [];
  for (const operation of Array.isArray(operations) ? operations : []) {
    if (String(operation?.status) !== 'completed') continue;
    const occurred = moment(operation?.occurredAt);
    if (!Number.isFinite(occurred)) continue;
    const data = object(operation.data);
    const kind = String(operation.kind || '');
    const ownDeposit = String(operation.sourceType || '') === 'deposit'
      && String(operation.sourceId || '') === depositId;
    if (kind === 'deposit-funding' && ownDeposit) {
      const value = amount(data.amount ?? data.total);
      if (value > 0) events.push({ occurred, kind: 'funding', principal: value,
        bonus: accrual ? Math.round(value * rate) / 100 : 0 });
    } else if (kind === 'deposit-withdrawal' && ownDeposit) {
      events.push({ occurred, kind: 'withdrawal' });
    } else if (kind === 'payment' || kind === 'refund') {
      const split = parts(data.depositAllocations, depositId);
      if (split?.total) events.push({ occurred, kind, ...split });
    }
  }
  const additional = amount(charge);
  if (additional > 0) events.push({ occurred: cutoff, kind: 'candidate' });
  const rank = { funding: 0, refund: 1, payment: 2, withdrawal: 3, candidate: 4 };
  events.sort((a, b) => a.occurred - b.occurred || rank[a.kind] - rank[b.kind]);
  let principal = 0;
  let bonus = 0;
  let available = 0;
  let captured = false;
  let allocation = null;
  for (const event of events) {
    if (!captured && event.occurred > cutoff) {
      available = amount(principal + bonus);
      captured = true;
    }
    if (event.kind === 'funding') {
      principal = Math.round((principal + event.principal) * 100) / 100;
      bonus = Math.round((bonus + event.bonus) * 100) / 100;
    } else if (event.kind === 'withdrawal') {
      principal = 0;
      bonus = 0;
    } else if (event.kind === 'refund') {
      principal = Math.round((principal + event.principal) * 100) / 100;
      bonus = Math.round((bonus + event.bonus) * 100) / 100;
    } else if (event.kind === 'payment') {
      principal = Math.round((principal - event.principal) * 100) / 100;
      bonus = Math.round((bonus - event.bonus) * 100) / 100;
    } else if (event.kind === 'candidate') {
      available = amount(principal + bonus);
      captured = true;
      if (additional > available + 0.009) throw new Error('Недостаточно средств на дату исторического визита');
      const fromPrincipal = Math.min(principal, additional);
      const fromBonus = Math.round((additional - fromPrincipal) * 100) / 100;
      principal = Math.round((principal - fromPrincipal) * 100) / 100;
      bonus = Math.round((bonus - fromBonus) * 100) / 100;
      allocation = { amount: additional, principalAmount: fromPrincipal, benefitAmount: fromBonus };
    }
    if (principal < -0.009 || bonus < -0.009) {
      throw new Error('Историческое списание превысит остаток по депозиту в одной из последующих операций');
    }
    if (!captured && event.occurred <= cutoff) available = amount(principal + bonus);
  }
  if (!captured) available = amount(principal + bonus);
  return { available, allocation };
}
