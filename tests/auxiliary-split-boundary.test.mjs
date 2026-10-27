import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../core/runtime/auxiliary-state.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../server/src/auxiliary-state/auxiliary-state.controller.ts', import.meta.url), 'utf8');
const deposit = fs.readFileSync(new URL('../core/loyalty/deposit/data.js', import.meta.url), 'utf8');

for (const [scope, datasets] of Object.entries({
  people: ['tags', 'cardAppearanceTemplates'],
  loyalty: ['wallets', 'cardAppearanceTemplates', 'depositPrograms'],
  service: ['products', 'productHistory', 'cardAppearanceTemplates'],
  finance: ['wallets', 'investments', 'loans'],
  tags: ['tags'],
})) {
  assert.match(controller, new RegExp(`${scope}: \\[${datasets.map((key) => `'${key}'`).join(', ')}\\]`), `server scope ${scope} must expose only its owned auxiliary read datasets`);
}

assert.match(runtime, /const auxiliaryStateLoads = new Map\(\)/, 'auxiliary cache must be split by scope');
assert.match(runtime, /\/auxiliary-state\/\$\{encodeURIComponent\(key\)\}/, 'scoped reads must use scoped auxiliary endpoint');
assert.match(runtime, /if\(owns\(remote,'wallets'\)\)/, 'partial bundles must not clear wallets when wallets were not returned');
assert.match(runtime, /if\(owns\(remote,'tags'\)\)/, 'partial bundles must not clear tags when tags were not returned');
assert.match(runtime, /if\(owns\(remote,'products'\)\|\|owns\(remote,'productHistory'\)\)/, 'partial bundles must hydrate products only when returned');
assert.match(runtime, /if\(hash==='people'\)return 'people'/, 'People must resolve to the People auxiliary scope');
assert.match(runtime, /if\(hash==='loyalty'\)return 'loyalty'/, 'Loyalty must resolve to the Loyalty auxiliary scope');
assert.match(runtime, /if\(hash==='service'\)return 'service'/, 'Service must resolve to the Service auxiliary scope');
assert.match(runtime, /if\(hash==='finance'\)return 'finance'/, 'Finance must resolve to the Finance auxiliary scope');
assert.match(runtime, /if\(hash==='settings'\)return 'tags'/, 'Settings Tags must resolve to the Tags auxiliary scope');

assert.match(deposit, /apiRequest\('\/auxiliary-state\/loyalty'\)/, 'deposit program reads must use the Loyalty scoped bundle');
assert.doesNotMatch(deposit, /apiRequest\('\/auxiliary-state'\)/, 'deposit program reads must not request the full auxiliary bundle');

console.log('Auxiliary split boundary: scoped owner reads protected');
