import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const controller = readFileSync(new URL('../server/src/saas-admin/commercial-self-service.controller.ts', import.meta.url), 'utf8');
assert.match(controller, /@Post\('confirm-tariff'\)/);
assert.match(controller, /@Get\('me'\)/);
assert.doesNotMatch(controller, /confirm-live|normalizedSelection|stageFreeLiveSelection|productKeys\(/);
assert.match(controller, /createTariffOrder\(/);
assert.match(controller, /sendPendingInvoice\(/);
console.log('Commercial tariff-only flow: PASS');
