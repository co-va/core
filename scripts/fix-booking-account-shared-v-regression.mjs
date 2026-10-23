import fs from 'node:fs';

const path = 'tests/booking-account-ui.test.mjs';
const source = fs.readFileSync(path, 'utf8');
const from = 'assert.match(headerUi, /actionData/);';
const to = "assert.match(headerUi, /data-workspace-a-context/);\nassert.match(headerUi, /data-workspace-v-action/);\nassert.doesNotMatch(headerUi, /actionData/);";
const count = source.split(from).length - 1;
if (count !== 1) throw new Error(`${path}: expected one stale actionData assertion, found ${count}`);
fs.writeFileSync(path, source.replace(from, to));
console.log('booking account Shared V regression aligned');
