import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual ProcedureService methods before the server dependencies are installed in CI.
const source = readFileSync('server/src/procedure/procedure.service.ts', 'utf8');
const start = source.indexOf('  private assignmentFor(');
const end = source.indexOf('  private async catalogAt(', start);
const snapshotsStart = source.indexOf('  async snapshots(');
const snapshotsEnd = source.lastIndexOf('\n}');
assert.ok(start >= 0 && end > start && snapshotsStart > end && snapshotsEnd > snapshotsStart,
  'Keep one canonical ProcedureService owner for booking and snapshots');

const methods = (source.slice(start, end) + '\n' + source.slice(snapshotsStart, snapshotsEnd))
  .replace(/\bprivate\s+/g, '')
  .replace(/:\s*item is JsonObject/g, '')
  .replace(/:\s*(?:JsonObject\[\]|JsonObject|BookingPrice|string\[\]|string|unknown)/g, '');

const ProcedureContract = new Function(
  'arrayValue', 'text', 'hasPriceValue', 'priceNumber', 'BadRequestException', 'objectValue',
  'return class ProcedureContract {' + methods + '}',
)(
  value => Array.isArray(value) ? value : [],
  value => String(value ?? '').trim(),
  value => value !== '' && value != null,
  value => {
    const numeric = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
  },
  class BadRequestException extends Error {},
  value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
);

const procedure = {
  id: 'shared', name: 'Услуга', duration: 60,
  cost: { mode: 'amount', amount: 3000 },
  workplaces: [
    { workplaceId: 'salon-a', cost: { free: true } },
    { workplaceId: 'salon-b', cost: { mode: 'amount', amount: 5000 } },
  ],
};
const deleted = {
  id: 'deleted', name: 'Удалённая услуга', deletedAt: '2026-11-10T00:00:00.000Z',
  cost: { amount: 2500 }, workplaces: [{ workplaceId: 'salon-a' }],
};
const fallback = {
  id: 'base', name: 'Обычная услуга', cost: { amount: 1200 },
  workplaces: [{ workplaceId: 'salon-a', cost: { free: false } }],
};
const records = [procedure, deleted, fallback];
const service = new ProcedureContract();
service.prisma = { businessOperationalState: { findUnique: async () => ({ data: { procedures: records } }) } };
service.catalogAt = async () => null;

const catalog = service.publicBookingCatalog(records, ['salon-a', 'salon-b']);
assert.deepEqual(catalog.map(item => item.id), ['shared', 'base'],
  'A deleted service must not be advertised for new bookings');
const shared = catalog[0];
assert.deepEqual(shared.workplaces.map(item => item.bookingPrice.minimum), [0, 5000]);
assert.deepEqual(shared.workplaces.map(item => item.bookingPrice.free), [true, false]);
assert.equal(catalog[1].workplaces[0].bookingPrice.minimum, 1200,
  'An unconfigured workspace price inherits the base cost');

await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['deleted']), /недоступна/,
  'A removed service must be rejected at Record creation, not only hidden in the UI');
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['shared']))[0].cost, '',
  'A free workspace must override a paid global service');
assert.equal((await service.snapshots('tenant-a', 'salon-b', ['shared']))[0].cost, 5000,
  'The paid workspace must retain its own tariff');
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['base']))[0].cost, 1200);
await assert.rejects(service.snapshots('tenant-a', 'missing', ['shared']), /недоступна/);

// A historical snapshot from before deletion remains usable for past Record reconstruction.
service.catalogAt = async () => [{ ...deleted, deletedAt: undefined }];
const historical = await service.snapshots('tenant-a', 'salon-a', ['deleted'], '2026-10-01');
assert.equal(historical[0].id, 'deleted');

console.log('PASS: canonical Procedure catalog, soft deletion, workplace free prices, historical Record snapshot');
