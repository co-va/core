import assert from 'node:assert/strict';
import fs from 'node:fs';

const identity = fs.readFileSync('server/src/online-booking/person-identity.service.ts', 'utf8');
const booking = fs.readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const business = fs.readFileSync('server/src/business-state/business-state.service.ts', 'utf8');
const people = fs.readFileSync('core/people/data.js', 'utf8');

assert.match(identity, /accountContact\.findMany\(/, 'Person identity must read the canonical global AccountContact set');
assert.match(identity, /String\(row\.type\) === 'PHONE'/);
assert.match(identity, /String\(row\.type\) === 'EMAIL'/);
assert.match(identity, /String\(row\.type\) === 'TELEGRAM'/);

assert.match(identity, /const matchedBy = this\.matchPerson\(person, contacts\)/);
assert.match(identity, /matchedBy\.phones\.length/);
assert.match(identity, /matchedBy\.emails\.length/);
assert.match(identity, /matchedBy\.telegrams\.length/);
assert.doesNotMatch(identity, /personState\(tenantId, account\.phone\)/, 'Account-to-Person resolution must not fall back to phone-only matching');
assert.doesNotMatch(identity, /owner: members\[0\]/, 'Person resolution must not silently choose the first phone match');

assert.match(identity, /if \(matchedKeys\.length !== 1\)/, 'Multiple Person matches must enter the explicit ambiguity path');
assert.match(identity, /status: 'CONTACT_CONFLICT'/);
assert.match(identity, /matchedPersonKeys: uniqueStrings\(matchedPersonKeys\)/);
assert.match(identity, /const person = await this\.createBoundPerson\(tenantId, account, contacts, matchedKeys\)/);
assert.doesNotMatch(identity, /updateUEI\(/, 'Contact conflict handling must not mutate UEI automatically');

assert.match(identity, /async syncLinkedPeople\(account:/);
assert.match(identity, /accountIds\(objectValue\(row\.data\)\)\.includes\(accountId\)/);
assert.match(identity, /this\.enrichPerson\(row\.data, accountId, contacts\)/);
assert.match(identity, /photo: contacts\.profilePhoto/);
assert.match(identity, /profilePhoto: text\(profileData\.photo\)/);
assert.doesNotMatch(identity, /accountContact\.(?:create|update|upsert|delete)/, 'Person synchronization must never write back into global Account contacts');

const updateBlock = booking.slice(
  booking.indexOf('async updateAccount('),
  booking.indexOf('async changeAccountPassword('),
);
assert.match(updateBlock, /replaceAccountContacts/);
assert.match(updateBlock, /bindAccountTenant/);
const bindAccountTenantBlock = booking.slice(
  booking.indexOf('private async bindAccountTenant'),
  booking.indexOf('private async globalAccountView'),
);
assert.match(bindAccountTenantBlock, /personIdentity\.bindFirstAccess/, 'Tenant Account binding must still delegate to the canonical Person identity owner.');
assert.match(updateBlock, /personIdentity\.syncLinkedPeople/);

assert.doesNotMatch(controller, /bindTelegramEntry|resolveTelegramEntry|syncAccountPersonContacts/, 'Telegram bot transport must not bind Account identity in Online Booking.');

assert.doesNotMatch(business, /async upsertPersonFromAccount\(/, 'BusinessState must not keep a parallel Account-to-Person mapper');
assert.match(people, /identityReview:/, 'Browser Person normalization must preserve hidden identity review state');

console.log('Person Account-contact identity tests passed');
