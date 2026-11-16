import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the real tariff renderer with a DOM-like content host. The error
// reported by Safari happens before any click, when selectedKey is empty.
const source = readFileSync(new URL('../admin/tariff-workbench.js', import.meta.url), 'utf8')
  .replace('export function renderTariffWorkbench(', 'function renderTariffWorkbench(');
const renderTariffWorkbench = runInNewContext(source + '\nrenderTariffWorkbench;', {
  location: { hostname: 'va-app-volokovykh.msk1.amvera.tech' },
  console,
});

let html = '';
const contentHost = {
  get innerHTML() { return html; },
  set innerHTML(next) { html = String(next); },
  querySelectorAll() { return []; },
  querySelector() { return null; },
};
const tiers = [
  { key: 'tariff.start', name: 'Start', priceMinor: 0, isFree: true, isSaleable: true, periods: [] },
  { key: 'tariff.start-plus', name: 'Start+', priceMinor: 120000, isFree: false, isSaleable: false, periods: [] },
  { key: 'tariff.pro', name: 'Pro', priceMinor: 250000, isFree: false, isSaleable: false, periods: [] },
];

const render = (selectedKey) => renderTariffWorkbench({
  content: contentHost, tiers, selectedKey,
  readinessFor: () => ({ rows: [] }),
  onSelect() {}, onPublish() {}, onTools() {}, onSave() {},
});

assert.doesNotThrow(() => render(''), 'No selected tariff must not dereference undefined.published');
assert.equal((html.match(/class="admin-overview-metric tw-card/g) || []).length, 3,
  'The three approved tariff cards appear before opening any editor');
for (const label of ['Start', 'Start+', 'Pro']) assert.ok(html.includes(label));

assert.doesNotThrow(() => render('tariff.start'), 'An existing published tariff opens');
assert.match(html, /Публикация тарифа/);
assert.match(html, /Опубликовать изменения|Снять с публикации/);
assert.doesNotThrow(() => render('tariff.start-plus'), 'An unpublished tariff opens');
assert.match(html, /Опубликовать/);
assert.doesNotThrow(() => render(''), 'Closing the editor preserves the tariff cards');
assert.equal((html.match(/class="admin-overview-metric tw-card/g) || []).length, 3);
console.log('Tariff workbench: empty selection and approved three-tier display PASS');
