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
const runtime = fs.readFileSync('online-booking/account-runtime.js', 'utf8');
const transitionRuntime = fs.readFileSync('core/account-transition-runtime.js', 'utf8');
const bookingUi = fs.readFileSync('online-booking/booking.js', 'utf8');
const accountShell = fs.readFileSync('online-booking/account-shell.js', 'utf8');
const consentController = fs.readFileSync('server/src/online-booking/booking-consent.controller.ts', 'utf8');
const controller = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const core = fs.readFileSync('core.js', 'utf8');
const rootHtml = fs.readFileSync('index.html', 'utf8');
const authCss = fs.readFileSync('ui/auth/auth.css', 'utf8');
const dockerfile = fs.readFileSync('Dockerfile', 'utf8');
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
assert.match(accountApi, /resolveAccountTelegramEntry/);
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

assert.match(communication, /resolveTelegramEntryAccount/);
assert.match(communication, /AccountContactType\.TELEGRAM/);
assert.match(communication, /Этот Telegram уже зарегистрирован в другом аккаунте/);

assert.match(runtime, /resolveAccountTelegramEntry/);
assert.match(runtime, /clearAccount,/);
assert.match(runtime, /let telegramReadyForBind = false;/);
assert.match(runtime, /clearAccount\(tenant\);/, 'Unknown Telegram entry must not inherit whichever Account is already authenticated in the browser');
assert.match(runtime, /!telegramReadyForBind \|\| !getAccountToken\(tenant\)/, 'Telegram may bind only after the entry has been resolved and the user explicitly authenticates');
assert.doesNotMatch(runtime, /if \(entry && !getAccountToken\(tenant\)\)/, 'Telegram entry resolution must not be skipped just because a stale Account token exists');

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
assert.match(accountShell, /data-account-investment=/, 'Accepted investment must appear as an Entity Card in the end-user Overview');
assert.match(accountShell, /data-account-investment-chat/, 'Linked investment must expose the shared Header D chat');
assert.match(accountShell, /v2Section\('История', accountInvestmentHistory\(investment\)\)/, 'Linked investor card must expose the same investment history');
assert.match(accountShell, /await getGlobalAccountRelationships\(\)/, 'Accepting an investment must refresh the linked projection immediately');
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
assert.match(bookingUi, /export async function renderGlobalClient\(/, 'Client host must have a global Account entry flow');
assert.match(bookingUi, /state\.platformOnlyLegal = state\.identityDestination === 'profile'/, 'Profile entry must keep platform terms separate from tenant legal documents');
assert.match(bookingUi, /onExitToAccount/, 'Booking context must be escapable back to the global client profile');
assert.match(accountShell, /export async function renderGlobalAccount\(/, 'Global Account must reuse the shared client shell');
assert.match(accountShell, /async function renderGlobalMessages\(/, 'Global Account must expose the shared chat list');
assert.match(accountShell, /data-account-open-chat-root/, 'Global Account header must expose chat directly');
assert.match(accountShell, /state\.accountSelectedChatTenantId/, 'Global Account must own selected chat contact state directly');
assert.doesNotMatch(accountShell, /onOpenChat: callbacks\.onOpenChat/, 'Global Account chat must not bridge into a second tenant account UI');
assert.doesNotMatch(bookingUi, /params\.set\('entry', 'chat'\)/, 'Global chat must not navigate through a tenant chat route');
const bookingHeaderStart = bookingUi.indexOf('function bookingHeaderMarkup');
const bookingHeaderEnd = bookingUi.indexOf('function bookingActionForStep', bookingHeaderStart);
const bookingHeader = bookingUi.slice(bookingHeaderStart, bookingHeaderEnd);
assert.match(bookingHeader, /d:\s*null/, 'Online booking itself must keep Header D absent on booking steps.');
assert.match(accountShell, /async function renderGlobalMessages\(/, 'Chat remains owned by the single global Account chat surface.');
assert.doesNotMatch(bookingHeader, /data-booking-flow-chat|kind:\s*'chat'/, 'Online booking must not restore a parallel Chat control inside booking Header.');
assert.match(core, /isEndUserAppHost\(\)/);
assert.match(core, /renderGlobalClientRoot\(\)/);
assert.match(core, /params\.get\('entry'\)/, 'Global profile must distinguish account entry from an external booking link');

assert.match(rootHtml, /core\/account-transition-runtime\.js/, 'End-user app must load the single session transition runtime before the main application runtime.');
assert.match(rootHtml, /classList\.toggle\('end-user-app'/, 'End-user host must be marked before styles load so startup never flashes the legacy loading sticker.');
assert.match(transitionRuntime, /getGlobalAccountPlatformState/, 'Fast account reveal must preserve the platform legal gate.');
assert.match(transitionRuntime, /renderGlobalAccount\(root, state/, 'Successful login must reveal the existing Shared Account shell before heavy relationship and record loading finishes.');
assert.match(transitionRuntime, /LOGOUT_ACTION/, 'Logout must have an explicit UI transition guard.');
assert.match(transitionRuntime, /waitForLoginResult/, 'Login must expose an immediate visible transition instead of leaving the old form frozen.');
assert.match(authCss, /account-transition-splash/, 'End-user session transitions must use the H-background splash presentation.');
assert.match(authCss, /app-icon\.svg/, 'The splash must show the existing application mark instead of loading text or a white loading card.');

console.log('global account architecture tests passed');
