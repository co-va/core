import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [controller, financeProjection, profileRuntime, profileView, financeView] = await Promise.all([
  readFile(new URL('../server/src/business-state/business-state.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/src/finance/journal-finance-projection.ts', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/profile.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/finance/finance.js', import.meta.url), 'utf8'),
]);

assert.match(controller, /const \[journal, profileContext, operational, finance, access\] = await Promise\.all/);
assert.match(controller, /journalFinanceProjection\(this\.prisma, auth\.tenantId\)/,
  'Journal must receive the minimal payment projection required for payment state');
assert.match(controller, /return \{ journal, profileContext, operational, finance, access \};/);
assert.match(financeProjection, /sourceType: 'record'/);
assert.match(financeProjection, /kind: \{ in: \['payment', 'refund'\] \}/);
assert.match(financeProjection, /ledger: \[\]/,
  'Journal projection must not hydrate the full Finance ledger');
assert.match(controller, /private async journalProfileContext/);
assert.doesNotMatch(controller, /profileContext[^]*professionCatalog/);

assert.match(profileRuntime, /consumeJournalBootstrap\('profileContext'\)/);
assert.match(profileRuntime, /loadProfileState\(\{full=false\}=\{\}\)/);
assert.match(profileRuntime, /if\(!full\)/);
assert.match(profileRuntime, /apiRequest\('\/profile'\)/);

assert.match(profileView, /loadProfileState\(\{full:true\}\)/, 'Opening Profile must load the full Profile state');
assert.match(financeView, /loadFinanceState\(\{ full: true \}\)/, 'Opening Finance must load the full Finance state');

console.log('startup Journal load boundary: PASS');
