import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const canonicalGuard = read('server/src/account/account.guard.ts');
const bookingGuard = read('server/src/online-booking/account.guard.ts');
const verification = read('server/src/email-verification/email-verification.service.ts');
const canonicalController = read('server/src/account/account-runtime.controller.ts');
const bookingController = read('server/src/online-booking/account-email-verification.controller.ts');

for (const [label, guard] of [['canonical', canonicalGuard], ['online booking', bookingGuard]]) {
  assert.doesNotMatch(guard, /requestAccount\(|emailVerification\.request|EmailVerificationService/,
    label + ' authentication must never issue an email verification ticket');
  assert.match(guard, /request\.accountAuth\s*=/, label + ' authentication must still supply identity');
}
assert.match(canonicalController, /@UseGuards\(AccountGuard\)\s*@Post\('email-verification\/request'\)/,
  'explicit request endpoint remains authenticated');
assert.match(bookingController, /@UseGuards\(AccountGuard\)\s*@Post\('request'\)/,
  'online-booking request endpoint remains authenticated');
assert.match(verification, /private async createAndSend\(kind: Kind, id: string, targetEmail: string, replacePending = false\)/);
assert.match(verification, /if \(replacePending\)\s*\{\s*await tx\.\$executeRawUnsafe\(/,
  'only explicit address changes may invalidate pending confirmation links');
assert.match(verification, /return this\.createAndSend\(kind, id, subject\.email\);/,
  'manual resend must not invalidate still-valid earlier links');
assert.match(verification, /return this\.createAndSend\(kind, id, candidate, true\);/,
  'changing the address must supersede outstanding links');
assert.match(verification, /const VERIFY_TTL_MS = 24 \* 60 \* 60 \* 1000;/,
  'verification links still expire after 24 hours');
assert.match(verification, /tokenHash\(token\)/, 'verification tokens stay hashed in storage');
assert.match(verification, /await this\.emailAvailable\(kind, id, email\)/,
  'address uniqueness is still enforced');
console.log('Explicit-only email verification, no auth-side mail, resend link validity: PASS');
