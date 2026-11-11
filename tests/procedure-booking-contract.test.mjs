import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const accountContext = readFileSync('server/src/account/account-contact-record.service.ts', 'utf8');
assert.match(accountContext, /this\.procedures\.publicBookingCatalog\(operational\.procedures, \[\.\.\.allowedKeys\]\)/,
  'The account booking path must reuse the canonical ProcedureService');
assert.doesNotMatch(accountContext, /function procedurePrice\(/,
  'No second account-specific implementation of service pricing');

// Exercise the actual ProcedureService methods before the server dependencies are installed in CI.
const source = readFileSync('server/src/procedure/procedure.service.ts', 'utf8');
const start = source.indexOf('  private assignmentFor(');
const end = source.indexOf('  async importProcedure(', start);
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
const from = {
  id: 'from', name: 'От', cost: { mode: 'from', amount: '2200', from: '2200' },
  workplaces: [{ workplaceId: 'salon-a' }],
};
const range = {
  id: 'range', name: 'Диапазон', cost: { mode: 'from-to', from: '1500', to: '3500', amount: '3000' },
  workplaces: [{ workplaceId: 'salon-a' }],
};
const assignedRange = {
  id: 'assigned-range', name: 'Разный прайс',
  cost: { mode: 'amount', amount: 4000 },
  workplaces: [
    { workplaceId: 'salon-a', cost: { mode: 'from-to', from: '1700', to: '4200' } },
    { workplaceId: 'salon-b' },
  ],
};
const records = [procedure, deleted, fallback, from, range, assignedRange];
const service = new ProcedureContract();
service.prisma = { businessOperationalState: { findUnique: async () => ({ data: { procedures: records } }) } };
service.prisma.$queryRaw = async () => { throw new Error('Record creation must never read the historical price catalog'); };

const catalog = service.publicBookingCatalog(records, ['salon-a', 'salon-b']);
assert.deepEqual(catalog.map(item => item.id), ['shared', 'base', 'from', 'range', 'assigned-range'],
  'A deleted service must not be advertised for new bookings');
const shared = catalog[0];
assert.deepEqual(shared.workplaces.map(item => item.bookingPrice.minimum), [0, 5000]);
assert.deepEqual(shared.workplaces.map(item => item.bookingPrice.free), [true, false]);
assert.equal(catalog[1].workplaces[0].bookingPrice.minimum, 1200,
  'An unconfigured workspace price inherits the base cost');
assert.equal(catalog[0].workplaces[0].bookingPrice.display, 'Бесплатно');
assert.equal(catalog[0].workplaces[1].bookingPrice.display, '5 000 ₽'.replace(/\u00a0/g, ' '));
assert.equal(catalog[1].workplaces[0].bookingPrice.display, '1 200 ₽'.replace(/\u00a0/g, ' '));
assert.equal(catalog[2].workplaces[0].bookingPrice.display.startsWith('от 2'), true,
  'Mode from with both amount and from must retain «от»');
assert.equal(catalog[3].workplaces[0].bookingPrice.minimum, 1500,
  'The range minimum is always from, not an optional stale amount');
assert.match(catalog[3].workplaces[0].bookingPrice.display, /^от 1[\s\u00a0]500 ₽$/,
  'Mode from-to must expose the first price with prefix «от»');
assert.match(catalog[4].workplaces[0].bookingPrice.display, /^от 1[\s\u00a0]700 ₽$/,
  'Workspace range supersedes global fixed price');
assert.match(catalog[4].workplaces[1].bookingPrice.display, /^4[\s\u00a0]000 ₽$/,
  'Workspace without its own price inherits global fixed display');

await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['deleted']), /недоступна/,
  'A removed service must be rejected at Record creation, not only hidden in the UI');
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['shared']))[0].cost, '',
  'A free workspace must override a paid global service');
assert.equal((await service.snapshots('tenant-a', 'salon-b', ['shared']))[0].cost, 5000,
  'The paid workspace must retain its own tariff');
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['base']))[0].cost, 1200);
const rangeSnapshot = (await service.snapshots('tenant-a', 'salon-a', ['range']))[0];
assert.equal(rangeSnapshot.cost, 1500);
assert.match(rangeSnapshot.priceText, /^от 1[\s\u00a0]500 ₽$/,
  'Record snapshot should preserve canonical display without recomputing it in the frontend');
await assert.rejects(service.snapshots('tenant-a', 'missing', ['shared']), /недоступна/);

// A new Record uses the same live catalog regardless of its appointment date.
const recordSource = readFileSync('server/src/record/record.service.ts', 'utf8');
assert.doesNotMatch(source, /catalogAt\(|historicalMoment\(/);
assert.doesNotMatch(recordSource, /procedureSnapshotsForDate\(/);
assert.match(recordSource, /this\.procedures\.snapshots\(tenantId, workplaceId, procedureIds, publicBooking\)/);
assert.match(recordSource, /this\.procedures\.snapshots\(tenantId, incomingWorkplaceId, newIds\)/);
assert.doesNotMatch(recordSource, /this\.procedures\.snapshots\([^;\n]*,\s*date\)/);
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['base']))[0].cost, 1200);
const saved = (await service.snapshots('tenant-a', 'salon-a', ['range']))[0];
range.cost = { mode: 'amount', amount: 4000 };
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['range']))[0].cost, 4000);
assert.equal(saved.cost, 1500, 'Changing the single current price cannot mutate an existing Record snapshot');
assert.match(saved.priceText, /^от 1[\s\u00a0]500 ₽$/);
await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['deleted']), /недоступна/);
await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['unknown']), /недоступна/);
// Existing bookings survive removal of their catalog service. Execute the
// actual update block, including manual price changes and new additions.
const updateStart = recordSource.indexOf('    let procedures = arrayValue(current.procedures)', recordSource.indexOf('  async upsertFromOwner('));
const updateEnd = recordSource.indexOf('\n    const from = text(incoming.from);', updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart);
const updateCode = recordSource.slice(updateStart, updateEnd).replace(/canonicalById\.get\(id\)!/g, 'canonicalById.get(id)');
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const runUpdate = new AsyncFunction('current', 'incoming', 'rawProceduresChanged', 'refreshProcedures',
  'tenantId', 'incomingWorkplaceId', 'arrayValue', 'objectValue', 'clone', 'text',
  updateCode + '\nreturn procedures;');
const booked = { id: 'deleted', name: 'Укладка', duration: 45, cost: 2500, priceText: 'от 2 500 ₽' };
const active = { id: 'base', name: 'Стрижка', duration: 60, cost: 1200, priceText: '1 200 ₽' };
const catalogRequests = [];
const owner = { procedures: { snapshots: async (_tenant, _space, ids) => {
  catalogRequests.push(ids);
  if (ids.includes('deleted')) throw new Error('Deleted catalog service');
  return ids.map(id => ({ ...active, id }));
} } };
const edit = (items, changed = true) => runUpdate.call(owner, { procedures: [booked] },
  { procedures: items }, changed, true, 'tenant-a', 'salon-a',
  v => Array.isArray(v) ? v : [], v => v || {}, v => JSON.parse(JSON.stringify(v)), v => String(v ?? '').trim());
assert.deepEqual(await edit([booked], false), [booked], 'Moving a booking retains the saved service without checking the current catalog');
const corrected = await edit([{ ...booked, cost: 3100 }]);
assert.equal(corrected[0].cost, 3100, 'Professional can manually change the price of a saved, deleted-from-catalog service');
assert.deepEqual(catalogRequests, [], 'Existing booked services never require the current catalog');
const combined = await edit([booked, active]);
assert.deepEqual(catalogRequests, [['base']], 'Only newly added service IDs are checked');
assert.equal(combined[0].cost, 2500);
assert.equal(combined[1].cost, 1200);
assert.deepEqual(await edit([]), [], 'Removing an item from the Record is an explicit edit');
// One canonical owner computes overrides for each workplace, including zero/empty
// values, while the public-only visibility policy never affects Journal snapshots.
procedure.breakDuration = 15;
procedure.description = 'Общее описание';
procedure.groupBooking = { enabled: false, capacity: 2 };
procedure.workplaces[0].duration = 35;
procedure.workplaces[0].breakDuration = 0;
procedure.workplaces[0].description = '';
procedure.workplaces[0].groupBooking = { enabled: true, capacity: 4 };
procedure.workplaces[1].duration = 75;
procedure.workplaces[1].breakDuration = 20;
procedure.workplaces[1].groupBooking = { enabled: false, capacity: 7 };
const multi = service.publicBookingCatalog(records, ['salon-a', 'salon-b']).find(item => item.id === 'shared');
assert.deepEqual(multi.workplaces.map(item => item.duration), [35, 75]);
assert.deepEqual(multi.workplaces.map(item => item.breakDuration), [0, 20]);
assert.equal(multi.workplaces[0].description, '');
assert.equal(multi.workplaces[1].description, 'Общее описание');
assert.deepEqual(multi.workplaces[0].groupBooking, { enabled: true, capacity: 4 });
assert.deepEqual(multi.workplaces[1].groupBooking, { enabled: false, capacity: 1 });
const single = service.publicBookingCatalog(records, ['salon-b']).find(item => item.id === 'shared');
assert.equal(single.duration, 75, 'One-workplace guest context receives the effective top-level duration');
const snapshotA = (await service.snapshots('tenant-a', 'salon-a', ['shared']))[0];
const snapshotB = (await service.snapshots('tenant-a', 'salon-b', ['shared']))[0];
assert.equal(snapshotA.duration, 35);
assert.equal(snapshotA.breakDuration, 0);
assert.equal(snapshotA.description, '');
assert.deepEqual(snapshotA.groupBooking, { enabled: true, capacity: 4 });
assert.equal(snapshotB.duration, 75);
assert.equal(snapshotB.breakDuration, 20);
assert.deepEqual(snapshotB.groupBooking, { enabled: false, capacity: 1 });

const hiddenGlobal = { id: 'hidden-global', name: 'Внутренняя услуга', duration: 60,
  visibleInPublicBooking: false, workplaces: [{ workplaceId: 'salon-a', visibleInPublicBooking: true }] };
const hiddenLocal = { id: 'hidden-local', name: 'Индивидуальная видимость', duration: 50,
  workplaces: [
    { workplaceId: 'salon-a', visibleInPublicBooking: false },
    { workplaceId: 'salon-b', visibleInPublicBooking: true },
  ] };
records.push(hiddenGlobal, hiddenLocal);
const visiblePublic = service.publicBookingCatalog(records, ['salon-a', 'salon-b']);
assert.equal(visiblePublic.some(item => item.id === 'hidden-global'), false,
  'The global flag must prevent public publication even with an explicit local true');
assert.deepEqual(visiblePublic.find(item => item.id === 'hidden-local').workplaces.map(item => item.workplaceId), ['salon-b']);
await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['hidden-global'], true), /недоступна/);
await assert.rejects(service.snapshots('tenant-a', 'salon-a', ['hidden-local'], true), /недоступна/);
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['hidden-global']))[0].duration, 60,
  'A hidden public service remains available for internal Journal Records');
assert.equal((await service.snapshots('tenant-a', 'salon-a', ['hidden-local']))[0].duration, 50);
assert.equal((await service.snapshots('tenant-a', 'salon-b', ['hidden-local'], true))[0].duration, 50);

const guestSource = readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const accountSource = readFileSync('server/src/account/account-contact-record.service.ts', 'utf8');
assert.match(guestSource, /this\.procedures\.publicBookingCatalog\(operational\.procedures, \[\.\.\.allowedKeys\]\)/);
assert.match(guestSource, /this\.procedures\.snapshots\(tenantId, workplaceKey, requestedIds, true\)/);
assert.match(accountSource, /this\.procedures\.publicBookingCatalog\(operational\.procedures, \[\.\.\.allowedKeys\]\)/);
assert.match(recordSource, /this\.procedures\.snapshots\(tenantId, workplaceId, procedureIds, publicBooking\)/);
assert.match(recordSource, /text\(input\.source\) === 'online-booking' \|\| text\(input\.source\) === 'account-journal'/);
assert.match(guestSource, /selected\.visibleInPublicBooking === false/);
assert.match(accountSource, /selected\.visibleInPublicBooking === false/);
console.log('PASS: canonical Service overrides, public visibility and internal Record isolation');
