import fs from 'node:fs';

function read(path) { return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
const failures = [];
const core = read('core.js');
const day = read('core/day/data.js');
const procedures = read('core/service/procedures/data.js');
const booking = read('core/booking-settings/index.js');
const online = read('server/src/online-booking/online-booking.service.ts');
const runtime = read('core/runtime/operational-state.js');
const server = read('server/src/business-state/business-state.service.ts');
const schema = read('server/prisma/schema.prisma');
const authenticatedRuntime = core.slice(
  core.indexOf('async function renderAuthenticated'),
  core.indexOf('\nfunction renderLogin'),
);

if (!/await Promise\.all\(\[[\s\S]*loadOperationalState\(\)[\s\S]*\]\);[\s\S]*renderWorkspace\(\)/.test(authenticatedRuntime)) failures.push('Runtime must hydrate operational booking facts before rendering.');
if (!day.includes('hydrateDaysFromServer') || !day.includes("queueOperationalDataset('days'")) failures.push('Day must become server-owned after migration.');
if (!procedures.includes('hydrateProceduresFromServer') || !procedures.includes("queueOperationalDataset('procedures'")) failures.push('Procedures must become server-owned after migration.');
if (!booking.includes('hydrateBookingSettingsFromServer') || !booking.includes("queueOperationalDataset('bookingSettings'")) failures.push('Booking settings must become server-owned after migration.');
if (!online.includes('this.businessState.publicOperational(tenantId)')) failures.push('Public online booking must consume canonical server operational facts directly.');
if (!online.includes('this.prisma.event.findMany') || !online.includes("type: 'event'")) failures.push('Public online booking occupancy must consume canonical server Event rows.');
if (/data\.breaks|type: 'break'/.test(online)) failures.push('Public online booking must not consume legacy Break runtime state.');
if (/breaks|hydrateBreaksFromServer|queueOperationalDataset\('breaks'/.test(runtime)) failures.push('Operational runtime must not hydrate or persist legacy Break.');
if (/\bbreaks\b/.test(server)) failures.push('Operational server state must not expose legacy Break dataset.');
if (!server.includes('businessOperationalState') || /verifyOperationalMigration|migrationVerifiedAt|bootstrapOperational/.test(server)) failures.push('Operational state must be canonical server state without transition bridge.');
if (!schema.includes('model BusinessOperationalState')) failures.push('Prisma must define BusinessOperationalState.');
if (!schema.includes('model Event')) failures.push('Prisma must define canonical Event outside operational state.');

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log('operational server ownership check: OK');
