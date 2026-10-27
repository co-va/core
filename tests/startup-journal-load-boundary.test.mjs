import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [controller, profileRuntime, profileView, financeView] = await Promise.all([
  readFile(new URL('../server/src/business-state/business-state.controller.ts', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/profile/profile.js', import.meta.url), 'utf8'),
  readFile(new URL('../core/finance/finance.js', import.meta.url), 'utf8'),
]);

assert.equal(controller.includes('journalFinanceProjection'), false, 'Journal bootstrap must not compute the full Finance projection');
assert.match(controller, /const \[journal, profileContext, operational, access\] = await Promise\.all/);
assert.match(controller, /return \{ journal, profileContext, operational, finance: \{\}, access \};/);
assert.match(controller, /private async journalProfileContext/);
assert.doesNotMatch(controller, /profileContext[^]*professionCatalog/);

assert.match(profileRuntime, /consumeJournalBootstrap\('profileContext'\)/);
assert.match(profileRuntime, /loadProfileState\(\{full=false\}=\{\}\)/);
assert.match(profileRuntime, /if\(!full\)/);
assert.match(profileRuntime, /apiRequest\('\/profile'\)/);

assert.match(profileView, /loadProfileState\(\{full:true\}\)/, 'Opening Profile must load the full Profile state');
assert.match(financeView, /loadFinanceState\(\{ full: true \}\)/, 'Opening Finance must load the full Finance state');

console.log('startup Journal load boundary: PASS');
