import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../core/business-persistence.js', import.meta.url), 'utf8');
const testableSource = source.replace(
  "import { apiRequest } from './auth.js';",
  'const apiRequest = (...args) => globalThis.__businessPersistenceApiRequest(...args);',
);

function response(payload = {}, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() { return payload; },
  };
}

async function waitFor(predicate, timeoutMs = 500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for persistence request');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let releaseRecord;
const calls = [];
globalThis.__businessPersistenceApiRequest = async (path) => {
  calls.push(path);
  if (path === '/business-state/records/record-1') {
    return new Promise((resolve) => {
      releaseRecord = () => resolve(response({ id: 'record-1' }));
    });
  }
  return response({ ok: true });
};

const moduleUrl = `data:text/javascript;base64,${Buffer.from(testableSource).toString('base64')}#${Date.now()}`;
const persistence = await import(moduleUrl);
persistence.setBusinessServerReady(true);

const recordWrite = persistence.queueRecordUpsert({ id: 'record-1' }, 0);
const recordEventWrite = persistence.queueRecordEventUpsert({ id: 'record-event-1', recordId: 'record-1' }, 0);
const noteWrite = persistence.queueNoteUpsert({ id: 'note-1' });

await waitFor(() => calls.includes('/notes/note-1'));
assert.equal(
  calls.includes('/business-state/record-events/record-event-1'),
  false,
  'RecordEvent must not overtake its Record in the same record lane',
);
await noteWrite;

let flushCompleted = false;
const flush = persistence.flushBusinessPersistence({ timeoutMs: 2000 }).then(() => {
  flushCompleted = true;
});
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(flushCompleted, false, 'flush must wait for every active lane');

releaseRecord?.();
await Promise.all([recordWrite, recordEventWrite, flush]);

const recordIndex = calls.indexOf('/business-state/records/record-1');
const eventIndex = calls.indexOf('/business-state/record-events/record-event-1');
const noteIndex = calls.indexOf('/notes/note-1');
assert.ok(recordIndex >= 0 && eventIndex > recordIndex, 'RecordEvent must be sent after Record');
assert.ok(noteIndex >= 0 && noteIndex < eventIndex, 'Independent Note lane must not wait behind the Record lane');
assert.equal(flushCompleted, true, 'flush must resolve after all lanes are idle');

delete globalThis.__businessPersistenceApiRequest;
console.log('business persistence lanes: OK');
