import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Exercise the actual getContext implementation in isolation. The access
// decision lives in Core and cannot be supplied by an untrusted client.
const online = readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const controller = readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const flow = readFileSync('server/src/online-booking/booking-flow.service.ts', 'utf8');
const record = readFileSync('server/src/record/record.service.ts', 'utf8');
const signature = "getContext(tenantId: string, workplaceKey = '', directRoute: Record<string, any> = {})";
const start = online.indexOf('  async ' + signature);
const end = online.indexOf('  async prepareAccount(', start);
assert.ok(start >= 0 && end > start);
const method = online.slice(start, end).replace(signature, "getContext(tenantId, workplaceKey = '', directRoute = {})");
const ContextContract = new Function('text', 'objectValue', 'arrayValue',
  'NotFoundException', 'BookingRequestStatus',
  'return class ContextContract {' + method + '}',
)(
  value => String(value ?? '').trim(),
  value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
  value => Array.isArray(value) ? value : [],
  class NotFoundException extends Error {},
  { PENDING: 'PENDING' },
);
const svc = new ContextContract();
const tenantId = 'tenant-one';
svc.access = { assertRealOperationsAllowed: async () => {} };
svc.prisma = {
  workplace: { findMany: async () => [
    { key: 'public', name: 'Публичное', visibleInPublicBooking: true },
    { key: 'private', name: 'По отдельной ссылке', visibleInPublicBooking: false },
  ] },
  event: { findMany: async () => [] },
  bookingRequest: { findMany: async () => [] },
};
svc.businessState = { publicOperational: async () => ({
  procedures: [{ id: 'service' }], days: [
    { workplaceId: 'public', date: '2026-11-20' },
    { workplaceId: 'private', date: '2026-11-20' },
  ], bookingSettings: {},
}) };
svc.tenantDocumentArchive = { publicDocuments: async () => [] };
svc.records = { publicOccupancy: async () => [] };
svc.procedures = { publicBookingCatalog: (_values, keys) => keys.map(key => ({
  id: 'service-' + key, workplaces: [{ workplaceId: key }],
})) };
let verified = [];
svc.resolvePublicRoute = async (profileSlug, workplaceSlug) => {
  verified.push([profileSlug, workplaceSlug]);
  if (profileSlug === 'stylist' && workplaceSlug === 'private-room') {
    return { tenantId, workplaceKey: 'private' };
  }
  throw new Error('invalid route');
};
const all = await svc.getContext(tenantId);
assert.deepEqual(all.workplaces.map(w => w.key), ['public']);
assert.deepEqual(all.procedures.map(p => p.id), ['service-public']);
assert.equal(all.directWorkplaceAccess, false);
assert.deepEqual((await svc.getContext(tenantId, 'public')).workplaces.map(w => w.key), ['public']);
await assert.rejects(svc.getContext(tenantId, 'private'), /не найдено/);
await assert.rejects(svc.getContext(tenantId, 'private', { profileSlug: '', workplaceSlug: '' }), /не найдено/);
const direct = await svc.getContext(tenantId, 'private', { profileSlug: 'stylist', workplaceSlug: 'private-room' });
assert.deepEqual(direct.workplaces.map(w => w.key), ['private']);
assert.deepEqual(direct.procedures.map(p => p.id), ['service-private']);
assert.equal(direct.directWorkplaceAccess, true);
assert.deepEqual(verified, [['stylist', 'private-room']]);
await assert.rejects(svc.getContext('another-tenant', 'private', {
  profileSlug: 'stylist', workplaceSlug: 'private-room',
}), /не найдено/, 'Cross-tenant route cannot unlock another workplace');

assert.match(controller, /getContext\(tenantId, workplace, \{ profileSlug, workplaceSlug \}\)/);
assert.match(flow, /getContext\(tenantId, workplaceKey, objectValue\(source\.directRoute\)\)/);
assert.match(flow, /allowDirectWorkplaceLink: context\.directWorkplaceAccess === true/);
assert.match(flow, /snapshots\(tenantId, workplaceKey, participant\.procedureIds, true\)/);
assert.match(record, /allowDirectWorkplaceLink = false/);
assert.match(record, /text\(input\.source\) === 'online-booking' && allowDirectWorkplaceLink/);
console.log('PASS: individual verified workplace route, general public filtering, tenant isolation');
