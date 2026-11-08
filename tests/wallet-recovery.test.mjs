import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const source = stripTypeScriptTypes(fs.readFileSync('server/src/auxiliary-state/wallet-recovery.ts', 'utf8'));
const { mergeWalletCatalog, recoverWalletCandidates } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

const system = [{ id: 'cash', name: 'Наличные', system: true }, { id: 'cashless', name: 'Безналичные', system: true }];
const former = { id: 'test-wallet-original-id', name: 'Тест 5', photo: 'old-photo', cardAppearance: { size: 'original' } };
const snapshot = (wallets) => ({ BusinessAuxiliaryState: [{ id: 'state', data: { wallets } }] });
const args = (extra = {}) => ({ wallets: system, sessions: [], transfers: [], operations: [], ledger: [], ...extra });

assert.deepEqual(
  mergeWalletCatalog([...system, former], system),
  system.concat(former),
  'partial PUT must not delete existing wallet',
);
assert.deepEqual(
  mergeWalletCatalog([...system, former], [...system, { ...former, deletedAt: '2026-11-08' }]).at(-1).deletedAt,
  '2026-11-08', 'soft-delete keeps original row',
);
assert.throws(() => mergeWalletCatalog(system, [...system, system[0]]), /повторный ID/);

const historical = recoverWalletCandidates(args({
  sessions: [{ before: snapshot([...system, former]), after: snapshot([...system, former]) }],
}));
assert.deepEqual(historical.recovered, [former], 'zero-operation test wallet restores original ID and card settings');

const transaction = recoverWalletCandidates(args({
  ledger: [{ walletId: 'sber-original', data: { walletName: 'Сбербанк' }, occurredAt: '2026-11-07' }],
}));
assert.equal(transaction.recovered[0].id, 'sber-original');
assert.equal(transaction.recovered[0].name, 'Сбербанк');

const mixed = recoverWalletCandidates(args({
  sessions: [{ before: snapshot([...system, former]), after: snapshot([...system, former]) }],
  ledger: [{ walletId: former.id, data: { walletName: 'Wrong display label' }, occurredAt: '2026-11-08' }],
}));
assert.deepEqual(mixed.recovered, [former], 'archived metadata overrides partial transaction label');

const deleted = recoverWalletCandidates(args({
  sessions: [
    { before: snapshot([...system, former]), after: snapshot([...system, former,]) },
    { before: snapshot([...system, former]), after: snapshot([...system, { ...former, deletedAt: '2026-11-08' }]) },
  ],
  ledger: [{ walletId: former.id, data: { walletName: former.name }, occurredAt: '2026-11-08' }],
}));
assert.equal(deleted.recovered.length, 0, 'later soft-delete must not be undone');

const imported = recoverWalletCandidates(args({
  transfers: [{ targetId: 'transfer-original', input: { name: 'Импортированный' } }],
}));
assert.equal(imported.recovered[0].id, 'transfer-original');

const unresolved = recoverWalletCandidates(args({
  ledger: [{ walletId: 'unknown-id', data: {}, occurredAt: '2026-11-08' }],
}));
assert.deepEqual(unresolved.recovered, []);
assert.deepEqual(unresolved.unresolvedIds, ['unknown-id'], 'never invent a wallet name');

assert.deepEqual(recoverWalletCandidates(args()).recovered, [], 'no evidence -> no invented wallets');
assert.deepEqual(recoverWalletCandidates(args({ wallets: [...system, former], sessions: [{ before: snapshot([former]), after: snapshot([former]) }] })).recovered, [], 'already present -> no duplication');

console.log('Server wallet recovery: partial PUT, archived test-wallet IDs, no invented wallets: OK');
