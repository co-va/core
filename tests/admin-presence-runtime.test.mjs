import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../admin/presence.js', import.meta.url), 'utf8')
  .replace(/^import [^\n]+\n/, '')
  .replaceAll('export const', 'const')
  .replaceAll('export function', 'function');
const listeners = new Map();
let visibilityState = 'visible';
let currentTime = 100_000;
let token = 'authenticated';
let timer = null;
let timerStarts = 0;
let responded = 0;
let accepted = 0;
const calls = [];
const window = {
  setInterval(fn, ms) { assert.equal(ms, 45_000); timer = fn; timerStarts++; return 17; },
  clearInterval() { timer = null; },
  addEventListener(event, cb) { listeners.set('window:' + event, cb); },
  removeEventListener(event) { listeners.delete('window:' + event); },
};
const document = {
  get visibilityState() { return visibilityState; },
  addEventListener(event, cb) { listeners.set('document:' + event, cb); },
  removeEventListener(event) { listeners.delete('document:' + event); },
};
const apiRequest = (path, options) => {
  calls.push({ path, options });
  return Promise.resolve({ ok: true, status: 200 });
};
const callbacks = runInNewContext(source + '\n({ startAccountPresence, stopAccountPresence })', {
  Date: { now: () => currentTime }, window, document,
  apiRequest, getAuthToken: () => token,
});
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
callbacks.startAccountPresence({ onForegroundReport: () => { responded++; } });
await settle();
assert.equal(calls.length, 1, 'Authenticated Admin sends immediate presence once');
assert.equal(calls[0].path, '/auth/presence');
assert.deepEqual({ ...calls[0].options }, { method: 'POST', timeoutMs: 5000 });
assert.equal(responded, 1, 'First confirmed signal refreshes network state');
callbacks.startAccountPresence();
assert.equal(timerStarts, 1, 'No duplicate interval after repeat Admin load');
currentTime += 45_000;
timer();
await settle();
assert.equal(calls.length, 2, 'Routine 45s heartbeat stays active');
assert.equal(responded, 1, 'Routine heartbeats do not force extra table reloads');
visibilityState = 'hidden';
currentTime += 45_000;
timer();
await settle();
assert.equal(calls.length, 2, 'Background Admin does not report active');
visibilityState = 'visible';
currentTime += 45_000;
listeners.get('document:visibilitychange')();
await settle();
assert.equal(calls.length, 3);
assert.equal(responded, 2, 'Foreground return updates status without manual reload');
callbacks.stopAccountPresence();
assert.equal(timer, null, 'Logout removes timer');
assert.equal(listeners.size, 0, 'Logout removes listeners');
token = '';
callbacks.startAccountPresence();
await settle();
assert.equal(calls.length, 3, 'No requests without authentication');
assert.equal(timer, null);
console.log('Admin: canonical foreground heartbeat, online refresh and logout cleanup PASS');
