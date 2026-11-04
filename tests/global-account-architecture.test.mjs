import assert from 'node:assert/strict';
import fs from 'node:fs';

const schema = fs.readFileSync('server/prisma/schema.prisma', 'utf8');
const migration = fs.readFileSync('server/prisma/migrations/20260921130000_global_account_identity/migration.sql', 'utf8');
const relationshipMigration = fs.readFileSync('server/prisma/migrations/20260925170000_global_account_tenant_link/migration.sql', 'utf8');
const accountApi = fs.readFileSync('core/account/index.js', 'utf8');
const guard = fs.readFileSync('server/src/online-booking/account.guard.ts', 'utf8');
const booking = fs.readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const auxiliaryState = fs.readFileSync('server/src/auxiliary-state/auxiliary-state.service.ts', 'utf8');
const communication = fs.readFileSync('server/src/communication/communication.service.ts', 'utf8');
const consentController = fs.readFileSync('server/src/online-booking/booking-consent.controller.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const reset = fs.readFileSync('server/scripts/reset-test-account-before-global-migration.mjs', 'utf8');

const accountStart = schema.indexOf('model Account {');
const accountEnd = schema.indexOf('model AccountTenantLink {', accountStart);
const accountModel = schema.slice(accountStart, accountEnd);

assert.doesNotMatch(accountModel, /\btenantId\s+String\b/, 'End-human Account must not be owned by one Tenant');
assert.match(accountModel, /createdViaTenantId\s+String\?/, 'Account may retain only provenance of the Tenant where it was first created');
assert.match(schema, /model AccountContact \{/);
assert.match(schema, /model AccountTenantLink \{/, 'Global Account must have an explicit relationship to every connected tenant');
assert.match(schema, /@@unique\(\[accountId, tenantId\]\)/, 'One Account/Tenant relationship must not duplicate');
assert.match(relationshipMigration, /INSERT INTO "AccountTenantLink"[\s\S]*"createdViaTenantId"/, 'Existing first-tenant provenance must backfill relationship links');
assert.match(relationshipMigration, /INSERT INTO "AccountTenantLink"[\s\S]*FROM "BookingRequest"/, 'Existing booking history must backfill relationship links');
assert.match(schema, /@@unique\(\[type, value\]\)/, 'Every concrete contact must be globally unique');
assert.match(schema, /enum AccountContactType \{[\s\S]*EMAIL[\s\S]*PHONE[\s\S]*TELEGRAM[\s\S]*\}/);

assert.match(migration, /Global Account migration found one contact assigned to multiple Accounts/);
assert.match(migration, /CREATE UNIQUE INDEX "AccountContact_type_value_key"/);
assert.match(migration, /'TELEGRAM'::"AccountContactType"/);

assert.match(accountApi, /const ACCOUNT_TOKEN_KEY = 'book\.account\.token'/);
assert.doesNotMatch(accountApi, /function tokenKey\(tenantId\)/);
assert.doesNotMatch(accountApi, /resolveAccountTelegramEntry|bindAccountTelegramEntry|telegram-entry/, 'Global Account API must not contain Telegram browser entry');
assert.match(accountApi, /export async function deleteGlobalAccountRelationship\(tenantId\)/, 'Global Account must expose contact removal through the shared account API');

assert.doesNotMatch(guard, /payload\.tenantId/, 'Account token must be global and Tenant context must come from the requested route');
assert.match(guard, /request\.params\?\.tenantId/);
assert.doesNotMatch(guard, /missing tenant context/, 'Global client account routes must authenticate without a tenant context');

assert.match(booking, /accountContact\.findUnique/);
assert.match(booking, /AccountContactType\.EMAIL/);
assert.match(booking, /AccountContactType\.PHONE/);
assert.match(booking, /AccountContactType\.TELEGRAM/);
assert.match(booking, /function accountLoginContact/);
assert.match(booking, /AccountContactType\.EMAIL/);
assert.match(booking, /AccountContactType\.PHONE/);
assert.match(booking, /async loginAccount\(tenantId: string, identifierValue: unknown/);
assert.doesNotMatch(booking, /tenantId_email/, 'Account lookup must never return to tenant-scoped email uniqueness');
const issueTokenBlock = booking.slice(
  booking.indexOf('private async issueAccountToken'),
  booking.indexOf('private async bindAccountTenant'),
);
assert.doesNotMatch(issueTokenBlock, /tenantId:/, 'Global Account token must not encode one Tenant as identity owner');

assert.doesNotMatch(communication, /resolveTelegramEntryAccount|bindTelegramEntry|TelegramEntryTicket|AccountContactType\.TELEGRAM/, 'Communication must not bind Telegram bot chats to Account identity');
assert.match(communication, /ensureTelegramThreadIdentity/, 'Telegram may retain only technical external-thread identity');

assert.doesNotMatch(controller, /account\/telegram-entry/, 'Online Booking controller must not expose Telegram Account entry endpoints');

assert.match(controller, /@Get\('account\/me'\)/, 'Global client app must expose a tenant-free Account route');
assert.match(controller, /@Get\('account\/relationships'\)/, 'Global client app must expose Account relationships');
assert.match(controller, /@Delete\('account\/relationships\/:tenantId'\)/, 'Global client app must expose Account relationship removal');
assert.match(controller, /@Get\('account\/records'\)/, 'Global client app must expose cross-tenant history');
assert.match(controller, /@Post\('account\/investments\/:tenantId\/:investmentId\/decision'\)/, 'Global Account must expose linked investment decision route');
assert.match(booking, /private async accountInvestmentRelationships\(/, 'Linked investor card must project from the professional investment entity');
assert.match(booking, /acceptedIds/, 'Pending investment proposals must not project operational history');
assert.match(booking, /text\(terms\.participantStatus\) === 'accepted'[\s\S]*investmentEvents/, 'Investment events must be shared with the linked investor only after acceptance');
const investmentDecisionStart = booking.indexOf('async decideGlobalAccountInvestment');
const investmentDecisionEnd = booking.indexOf('async globalAccountRelationships', investmentDecisionStart);
const investmentDecisionBlock = booking.slice(investmentDecisionStart, investmentDecisionEnd);
assert.match(investmentDecisionBlock, /participantStatus\) !== 'pending'/, 'Investment proposal can be decided only once');
assert.match(investmentDecisionBlock, /finance\.investment\.raise\.access/, 'Investment acceptance must respect the administrator capability');
assert.match(auxiliaryState, /protectInvestmentAgreements/, 'Auxiliary investment writes must preserve server-owned agreement state');
assert.match(auxiliaryState, /previousStatus === 'accepted'[\s\S]*entity\.investmentTerms = clone\(previousTerms\)/, 'Accepted investment terms must remain immutable without blocking unrelated auxiliary writes');
assert.match(auxiliaryState, /participantStatus: participantAccountId \? 'pending' : ''/, 'A new linked investment proposal must start pending instead of self-accepting');
const deleteRelationshipStart = booking.indexOf('async deleteGlobalAccountRelationship');
const deleteRelationshipEnd = booking.indexOf('async globalAccountRecords', deleteRelationshipStart);
const deleteRelationshipBlock = booking.slice(deleteRelationshipStart, deleteRelationshipEnd);
assert.match(deleteRelationshipBlock, /revokeAllForAccount/, 'Removing a contact must revoke all active consent for that professional relationship');
assert.match(deleteRelationshipBlock, /accountTenantLink\.delete/, 'Removing a contact must delete only the Account/Tenant relationship');
assert.doesNotMatch(deleteRelationshipBlock, /bookingRequest\.delete|records\.delete|record\.delete/i, 'Removing a contact must preserve historical records');

assert.match(consentController, /accountTenantLink\.upsert/, 'A tenant relationship must be persisted only after tenant consent becomes active');
assert.match(consentController, /consentState\?\.pdnActive/, 'Tenant relationship must be gated by active tenant PDN');
// User UI assertions belong to the independent User repository.

console.log('global account architecture tests passed');
