import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { postboxSmtpPassword } from '../server/src/transactional-email/postbox-smtp-password.ts';

// This test vector was independently calculated from Yandex's Python reference.
const staticId = 'YCA-test-static-key-id';
const staticSecret = 'YCN-test-fixture-only-never-real';
assert.equal(
  postboxSmtpPassword(staticId, staticSecret),
  'BOYQlW5QEP7tyapClTTtVppIpse+HE7UMunwkRz54BYD',
  'static access keys must use Postbox SMTP HMAC derivation',
);

const derivedPassword = Buffer.from(postboxSmtpPassword(staticId, staticSecret), 'base64');
assert.equal(derivedPassword.length, 33, 'Postbox SMTP password has version byte plus 32-byte HMAC');
assert.equal(derivedPassword[0], 0x04, 'Postbox SMTP password is version 4');
assert.equal(postboxSmtpPassword('aje-api-key-id', 'api-key-secret'), 'api-key-secret',
  'Postbox API keys must continue using their raw secret as the password');

const service = readFileSync('server/src/transactional-email/transactional-email.service.ts', 'utf8');
assert.match(service, /pass:\s*postboxSmtpPassword\(apiKeyId, apiKeySecret\)/,
  'the actual SMTP transporter must use the selected password');
console.log('Postbox SMTP static-key derivation and API-key compatibility: PASS');
