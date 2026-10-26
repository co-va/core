import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const guard = readFileSync(new URL('../scripts/check-browser-storage-ownership.mjs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../core.js', import.meta.url), 'utf8');
const auth = readFileSync(new URL('../core/auth.js', import.meta.url), 'utf8');
const bookingDraft = readFileSync(new URL('../core/booking-draft.js', import.meta.url), 'utf8');
const bookingEntry = readFileSync(new URL('../online-booking/booking-entry.js', import.meta.url), 'utf8');
const rootIndex = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const adminIndex = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
const resetRequest = readFileSync(new URL('../core/password-reset-request.js', import.meta.url), 'utf8');
const resetPage = readFileSync(new URL('../core/password-reset-page.js', import.meta.url), 'utf8');
const resetController = readFileSync(new URL('../server/src/password-reset/password-reset.controller.ts', import.meta.url), 'utf8');
const resetService = readFileSync(new URL('../server/src/password-reset/password-reset.service.ts', import.meta.url), 'utf8');

assert.equal(existsSync(new URL('../core/legacy-browser-business.js', import.meta.url)), false);
assert.equal(existsSync(new URL('../core/workspace-sync.js', import.meta.url)), false);

for (const key of [
  'book.profile',
  'book.workplaces',
  'book.people',
  'book.uei',
  'book.records',
  'book.recordEvents',
  'book.procedures',
  'book.documents.consents.v1',
  'book.dds',
  'book.wallets',
  'book.products',
]) {
  assert.equal(core.includes(key), false, 'business browser key must not return to core runtime');
}

assert.match(guard, /browser storage is forbidden outside technical\/UI owners/);
assert.match(guard, /core\/auth\.js/);
assert.match(guard, /core\/account\/index\.js/);
assert.match(guard, /core\/workplace-context\.js/);
assert.match(guard, /core\/people\/view-state\.js/);
assert.match(guard, /core\/booking-draft\.js/);
assert.doesNotMatch(core, /clearLegacyBusinessStorage|workspace-sync/);

assert.match(bookingDraft, /localStorage\.getItem\(key\(id\)\)/, 'public Booking draft must be recoverable across page openings');
assert.match(bookingDraft, /localStorage\.setItem\(key\(id\), JSON\.stringify/, 'public Booking draft must persist only through its technical owner');
assert.match(bookingDraft, /localStorage\.removeItem\(key\(id\)\)/, 'completed Booking must clear its technical draft');
assert.match(bookingEntry, /loadBookingDraft/);
assert.match(bookingEntry, /pagehide/);
assert.match(bookingEntry, /visibilitychange/);

assert.match(auth, /localStorage\.getItem\(TOKEN_KEY\)/, 'professional auth must survive Safari/browser session closure');
assert.match(auth, /localStorage\.setItem\(TOKEN_KEY, value\)/, 'professional auth token must use persistent browser storage');
assert.match(auth, /sessionStorage\.getItem\(TOKEN_KEY\)/, 'legacy session token must be migrated without forcing a new login');
assert.match(auth, /sessionStorage\.removeItem\(TOKEN_KEY\)/, 'legacy session token must be cleaned after migration/logout');

assert.match(rootIndex, /core\/password-reset-request\.js/, 'app and account entry must load password recovery');
assert.match(adminIndex, /core\/password-reset-request\.js/, 'admin entry must load password recovery');
assert.equal(existsSync(new URL('../reset-password.html', import.meta.url)), true, 'shared password reset page must exist');
assert.equal(existsSync(new URL('../admin/reset-password.html', import.meta.url)), true, 'admin password reset page must exist');
assert.match(resetRequest, /\/auth\/password-reset\/request/, 'professional password reset request endpoint must be wired');
assert.match(resetRequest, /\/online-booking\/account\/password-reset\/request/, 'account password reset request endpoint must be wired');
assert.match(resetPage, /\/auth\/password-reset\/confirm/, 'professional reset confirmation must be wired');
assert.match(resetPage, /\/online-booking\/account\/password-reset\/confirm/, 'account reset confirmation must be wired');
assert.doesNotMatch(resetPage, /localStorage\.|sessionStorage\./, 'reset page must use canonical auth storage owners');
assert.match(resetController, /auth\/password-reset\/request/);
assert.match(resetController, /online-booking\/account\/password-reset\/confirm/);
assert.match(resetService, /RESET_TTL_MS = 30 \* 60 \* 1000/, 'reset tickets must expire after 30 minutes');
assert.match(resetService, /randomBytes\(32\)/, 'reset token must use cryptographic randomness');
assert.match(resetService, /sha256\(token\)/, 'only a reset token hash may be stored');
assert.match(resetService, /FOR UPDATE/, 'reset confirmation must serialize one-time ticket consumption');

console.log('browser storage autonomy tests: OK');
