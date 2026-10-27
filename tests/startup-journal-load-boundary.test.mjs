import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [controller, financeProjection, profileRuntime, operationalRuntime, profileView, financeView, serviceView, bookingSettingsView, creationFlow] = await Promise.all([
  readFile(new URL('../server/src/business-state/business-state.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/src/finance/journal-finance-projection.ts', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/runtime/operational-state.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/profile.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/finance/finance.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/service/service.js', import.meta.url), 'utf8'),
  readFile(new URL('../settings/online-booking/online-booking.js', import.meta.url), 'utf8'),
  readFile(new URL('../journal/creation-flow.js', import.meta.url), 'utf8'),
]);

assert.match(controller, /const \[journal, profileContext, operationalContext, finance, access\] = await Promise\.all/);
assert.match(controller, /journalFinanceProjection\(this\.prisma, auth\.tenantId\)/,
  'Journal must receive the minimal payment projection required for payment state');
assert.match(controller, /return \{ journal, profileContext, operationalContext, finance, access \};/);
assert.match(financeProjection, /sourceType: 'record'/);
assert.match(financeProjection, /kind: \{ in: \['payment', 'refund'\] \}/);
assert.match(financeProjection, /ledger: \[\]/,
  'Journal projection must not hydrate the full Finance ledger');
assert.match(controller, /private async journalProfileContext/);
assert.doesNotMatch(controller, /profileContext[^]*professionCatalog/);
assert.match(controller, /private async journalOperationalContext/);
assert.match(controller, /return \{ days: Array\.isArray\(operational\?\.days\) \? operational\.days : \[\] \};/,
  'Journal startup operational context must contain only Days');

assert.match(profileRuntime, /consumeJournalBootstrap\('profileContext'\)/);
assert.match(profileRuntime, /loadProfileState\(\{full=false\}=\{\}\)/);
assert.match(profileRuntime, /apiRequest\('\/profile'\)/);
assert.match(profileView, /loadProfileState\(\{full:true\}\)/, 'Opening Profile must load the full Profile state');

assert.match(operationalRuntime, /consumeJournalBootstrap\('operationalContext'\)/);
assert.match(operationalRuntime, /function hydrateDays\(/);
assert.match(operationalRuntime, /function hydrateFull\(/);
assert.match(operationalRuntime, /loadOperationalState\(\{full=false\}=\{\}\)/);
assert.match(operationalRuntime, /apiRequest\('\/business-state\/operational'\)/,
  'Full operational data must remain available on demand');
assert.match(serviceView, /loadOperationalState\(\{ full: true \}\)/,
  'Service must load Procedures on demand');
assert.match(bookingSettingsView, /loadOperationalState\(\{ full: true \}\)/,
  'Online Booking settings must load BookingSettings on demand');
assert.match(creationFlow, /loadOperationalState\(\{ full: true \}\)/,
  'Record creation must preserve Procedures by loading full operational data on demand');

assert.match(financeView, /loadFinanceState\(\{ full: true \}\)/, 'Opening Finance must load the full Finance state');

console.log('startup Journal load boundary: PASS');
