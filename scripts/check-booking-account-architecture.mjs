import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const exists = (path) => existsSync(path);

const guest = read('online-booking/access.js');
const entry = read('online-booking/booking-entry.js');
const model = read('online-booking/model.js');
const bookingSettings = read('settings/online-booking/online-booking.js');
const server = read('server/src/online-booking/booking-flow.controller.ts');
const shell = read('core.js');
const html = read('index.html');

for (const file of [
  'online-booking/booking.js',
  'online-booking/account-shell.js',
  'online-booking/account-runtime.js',
  'core/account-transition-runtime.js',
]) assert.equal(exists(file), false, `Retired User frontend must not return to Core: ${file}`);

assert.match(guest, /export async function renderAccess\(/);
assert.match(guest, /from '\.\/model\.js'/);
assert.match(guest, /\/booking-state/);
assert.match(guest, /\/confirm/);
assert.match(guest, /getBookingSlots\(/);
assert.match(guest, /getBookingTimeRows\(/);
assert.match(guest, /renderWorkplace\(/);
assert.match(guest, /renderServices\(/);
assert.match(guest, /renderDate\(/);
assert.match(guest, /renderTime\(/);
assert.match(guest, /renderConsent/);
assert.match(entry, /import \{ renderAccess \} from '\.\/access\.js'/);
assert.match(entry, /online-booking\/route/);
assert.doesNotMatch(entry, /account-shell|account-runtime|renderGlobalAccount/);
assert.match(model, /getBookingSlots/);
assert.match(bookingSettings, /from '\.\.\/\.\.\/core\/booking-settings\/index\.js'/);
assert.match(bookingSettings, /\/online-booking\/owner\/route/);
assert.match(bookingSettings, /openSharedProfileSettingsMenu/);
assert.doesNotMatch(shell, /renderGlobalClient|isEndUserAppHost|online-booking\/booking\.js/);
assert.match(html, /src="core\.js"/);
assert.doesNotMatch(html, /account-transition-runtime/);
assert.match(server, /confirm/);

console.log('booking/account architecture check: OK (guest Booking + Professional Core only)');
