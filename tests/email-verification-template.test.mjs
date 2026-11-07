import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verificationEmail } from '../server/src/email-verification/verification-email-template.ts';

const cases = [
  { kind: 'ACCOUNT', label: 'Запись', url: 'https://user.va-tools.ru/verify-email.html?kind=account&token=demo-token' },
  { kind: 'PLATFORM', label: 'Кабинет', url: 'https://prof.va-tools.ru/verify-email.html?kind=platform&token=demo-token' },
];
const icons = [];
for (const fixture of cases) {
  const address = 'test+escaped@example.com';
  const msg = verificationEmail(fixture.kind, address, fixture.url);
  assert.equal(msg.subject, 'Подтвердите email — ' + fixture.label);
  assert.ok(msg.text.includes(fixture.url), 'text/plain version must contain the confirmation URL');
  assert.ok(msg.html.includes('href="' + fixture.url.replaceAll('&', '&amp;') + '"'), 'email button must use the safely encoded signed confirmation link');
  assert.ok(msg.html.includes('Подтвердить email'), 'confirmation CTA must be present');
  assert.ok(msg.html.includes('Ссылка действует 24 часа'), 'expiry notice must be present');
  assert.ok(msg.html.includes('max-width:640px'), 'card must be narrow and responsive');
  assert.ok(msg.html.includes('border-radius:23px'), 'content must remain a rounded rectangular card');
  assert.equal(msg.attachments.length, 1);
  const img = msg.attachments[0];
  assert.equal(img.contentType, 'image/png');
  assert.equal(img.contentDisposition, 'inline');
  assert.ok(img.cid && msg.html.includes('cid:' + img.cid), 'logo must be referenced as CID');
  assert.equal(img.content.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'logo must be a real PNG');
  assert.ok(img.content.length > 1000 && img.content.length < 40000, 'reasonable email MIME image size');
  icons.push(img.content);
}
assert.notDeepEqual(icons[0], icons[1], 'User and Professional must have different PWA marks');

const escapeCase = verificationEmail('ACCOUNT', 'a&<test>"@example.com', 'https://user.va-tools.ru/verify-email.html?token=ok&kind=account');
assert.ok(escapeCase.html.includes('a&amp;&lt;test&gt;&quot;@example.com'));
assert.ok(escapeCase.html.includes('token=ok&amp;kind=account'));
assert.ok(!escapeCase.html.includes('a&<test>'));

const service = readFileSync('server/src/email-verification/email-verification.service.ts', 'utf8');
const provider = readFileSync('server/src/transactional-email/transactional-email.service.ts', 'utf8');
assert.match(service, /verificationEmail\(kind, email, url\)/);
assert.match(service, /PLATFORM_ORIGIN = 'https:\/\/prof\.va-tools\.ru'/);
assert.match(service, /ACCOUNT_ORIGIN = 'https:\/\/user\.va-tools\.ru'/);
assert.doesNotMatch(service, /PLATFORM_ORIGIN = 'https:\/\/app\.va-tools\.ru'/);
assert.match(provider, /cid: attachment\.cid/);
assert.match(provider, /contentDisposition: attachment\.contentDisposition/);
console.log('Branded verification email, PNG logos, safe link and CID transport: PASS');
