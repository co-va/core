// Pure recovery rules. Never manufacture wallet IDs or infer names from bank
// labels: only canonical snapshots/import facts/finance movements are accepted.
type Wallet = Record<string, any>;
type JsonRow = Record<string, any>;

const text = (value: unknown) => String(value ?? '').trim();
const obj = (value: unknown): JsonRow => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRow : {};
const arr = (value: unknown): any[] => Array.isArray(value) ? value : [];

export function mergeWalletCatalog(current: Wallet[], incoming: Wallet[]): Wallet[] {
  const existing = arr(current);
  const requested = arr(incoming);
  const existingById = new Map(existing.map((row) => [text(row?.id), row]));
  const seen = new Set<string>();
  for (const row of requested) {
    const id = text(row?.id);
    if (!id || seen.has(id)) throw new Error('Некорректный или повторный ID кошелька');
    seen.add(id);
  }
  // Wallet removal is never implicit in a PUT containing a partial catalog.
  // A soft delete must preserve the row with deletedAt; permanent deletion has
  // its own authorized endpoint and transaction.
  return [
    ...requested.map((row) => {
      const before = existingById.get(text(row?.id));
      // No generic PUT can silently undo a prior soft deletion.
      return before?.deletedAt && !row?.deletedAt ? { ...row, deletedAt: before.deletedAt } : row;
    }),
    ...existing.filter((row) => !seen.has(text(row?.id))),
  ];
}

export function recoverWalletCandidates(input: {
  wallets: Wallet[];
  sessions: Array<{ before: unknown; after: unknown; createdAt?: Date | string }>;
  transfers: Array<{ targetId: string; input: unknown }>;
  operations: Array<{ occurredAt: Date | string; data: unknown }>;
  ledger: Array<{ walletId: string; data: unknown; occurredAt: Date | string }>;
  excludedIds?: string[];
}): { recovered: Wallet[]; unresolvedIds: string[] } {
  const existing = new Set(arr(input.wallets).map((row) => text(row?.id)));
  const archived = new Map<string, Wallet>();
  const intentionallyDeleted = new Set<string>();
  const recordedNames = new Map<string, string>();
  const observed = new Set<string>();
  const excluded = new Set(arr(input.excludedIds).map(text));
  const eligible = (id: string) => Boolean(id) && id !== 'cash' && id !== 'cashless'
    && !existing.has(id) && !excluded.has(id);
  const saveName = (idValue: unknown, nameValue: unknown) => {
    const id = text(idValue), name = text(nameValue);
    if (!eligible(id)) return;
    observed.add(id);
    if (name) recordedNames.set(id, name);
  };
  const saveSnapshot = (wallet: unknown) => {
    const value = obj(wallet), id = text(value.id), name = text(value.name);
    if (!eligible(id)) return;
    if (value.deletedAt) {
      archived.delete(id);
      intentionallyDeleted.add(id);
      return;
    }
    intentionallyDeleted.delete(id);
    if (name) archived.set(id, { ...value, id, name });
  };
  // DataTransferSession has full copies of BusinessAuxiliaryState before
  // and after each import. Preserve the most recent ORIGINAL metadata.
  for (const session of [...arr(input.sessions)].sort((a, b) => {
    const left = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const right = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return left - right;
  })) {
    for (const phase of ['before', 'after']) {
      const state = obj(session?.[phase]);
      for (const row of arr(state.BusinessAuxiliaryState)) {
        const data = obj(row?.data);
        for (const wallet of arr(data.wallets)) saveSnapshot(wallet);
      }
    }
  }
  for (const transfer of arr(input.transfers)) {
    const id = text(transfer?.targetId), name = text(obj(transfer?.input).name);
    saveName(id, name);
  }
  const operations = [...arr(input.operations)]
    .sort((a, b) => text(a?.occurredAt).localeCompare(text(b?.occurredAt)));
  for (const operation of operations) {
    const data = obj(operation?.data);
    saveName(data.walletId, data.walletName);
    saveName(data.fromWalletId, data.fromWalletName);
    saveName(data.toWalletId, data.toWalletName);
    for (const line of arr(data.allocations)) saveName(line?.walletId, line?.walletName);
    for (const line of arr(data.walletAllocations)) saveName(line?.walletId, line?.walletName);
  }
  const ledger = [...arr(input.ledger)]
    .sort((a, b) => text(a?.occurredAt).localeCompare(text(b?.occurredAt)));
  for (const entry of ledger) saveName(entry?.walletId, obj(entry?.data).walletName);

  const candidates = new Map<string, Wallet>();
  // Historical full snapshots outrank partial transaction labels.
  for (const [id, row] of archived) candidates.set(id, row);
  for (const [id, name] of recordedNames) if (!candidates.has(id) && !intentionallyDeleted.has(id)) {
    candidates.set(id, { id, name, photo: '', system: false });
  }
  return {
    recovered: [...candidates.values()],
    unresolvedIds: [...observed].filter((id) => !candidates.has(id) && !intentionallyDeleted.has(id)),
  };
}
