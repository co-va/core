import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('server/prisma/migrations/20260921143000_account_terms/migration.sql', 'utf8');
const accountDocuments = fs.readFileSync('server/src/document-registry/account-document.service.ts', 'utf8');
const registry = fs.readFileSync('server/src/document-registry/document-registry.service.ts', 'utf8');
const bookingService = fs.readFileSync('server/src/online-booking/online-booking.service.ts', 'utf8');
const bookingController = fs.readFileSync('server/src/online-booking/online-booking.controller.ts', 'utf8');
const bookingUi = fs.readFileSync('online-booking/booking.js', 'utf8');
const accountApi = fs.readFileSync('core/account/index.js', 'utf8');
const workflow = fs.readFileSync('.github/workflows/check.yml', 'utf8');

const termsMatch = migration.match(/\$terms\$([\s\S]*?)\$terms\$/);
assert.ok(termsMatch, 'Account terms content must be stored in the platform document migration');
const terms = termsMatch[1];

assert.match(terms, /Условия использования учетной записи/);
assert.match(terms, /Платформа фиксирует редакцию документа/);
assert.match(terms, /изменение отображаемого наименования платформы[\s\S]*не требуют повторного акцепта/);
assert.doesNotMatch(terms, /\bBook\b/i, 'Account terms must not depend on the technical project name');

assert.match(migration, /"changeType" TEXT NOT NULL DEFAULT 'MATERIAL'/);
assert.match(migration, /"requiresAcceptance" BOOLEAN NOT NULL DEFAULT true/);
assert.match(migration, /CHECK \("changeType" IN \('MATERIAL', 'BRAND_ONLY', 'EDITORIAL'\)\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS "AccountDocumentEvent"/);
assert.match(migration, /AccountDocumentEvent_append_only/);
assert.match(migration, /BEFORE UPDATE OR DELETE ON "AccountDocumentEvent"/);

assert.match(accountDocuments, /async publicTerms\(/);
assert.match(accountDocuments, /async state\(accountIdValue: unknown\)/);
assert.match(accountDocuments, /acceptedVersion >= requiredVersion/);
assert.match(accountDocuments, /INSERT INTO "AccountDocumentEvent"/);
assert.match(accountDocuments, /ON CONFLICT \("accountId", "documentVersionId", "action"\) DO NOTHING/);
assert.match(registry, /FROM "AccountDocumentEvent"/);
assert.match(registry, /'ACCOUNT'::text AS "subjectType"/);

const registerBlock = bookingService.slice(
  bookingService.indexOf('async registerAccount('),
  bookingService.indexOf('async loginAccount('),
);
assert.match(registerBlock, /const accountTerms = objectValue\(body\.accountTerms\)/);
assert.match(registerBlock, /this\.accountDocuments\.publicTerms\(\)/);
assert.match(registerBlock, /this\.accountDocuments\.accept\(/);
assert.doesNotMatch(registerBlock, /acceptAccountConsents/);
assert.doesNotMatch(registerBlock, /messages-consent/);
assert.doesNotMatch(registerBlock, /ensurePdnConsent/);

assert.match(bookingController, /@Get\('account-terms'\)/);
assert.match(bookingController, /@Get\(':tenantId\/account\/platform-state'\)/);
assert.match(bookingController, /@Post\(':tenantId\/account\/platform-terms'\)/);

assert.match(accountApi, /export async function getAccountTerms\(/);
assert.match(accountApi, /export async function getAccountPlatformState\(/);
assert.match(accountApi, /export async function acceptAccountTerms\(/);

assert.match(bookingUi, /function renderLegalSticker\(/);
assert.doesNotMatch(bookingUi, /function renderAccountTerms\(/);
assert.doesNotMatch(bookingUi, /function renderTenantAgreements\(/);
assert.match(bookingUi, /accountTerms: currentAccountTermsFact\(state\)/);
assert.match(bookingUi, /const platformState = await getAccountPlatformState\(state\.tenantId\)/);
assert.match(bookingUi, /const consentState = await refreshTenantConsentState\(state\)/);
assert.ok(
  bookingUi.indexOf('const platformState = await getAccountPlatformState(state.tenantId)')
    < bookingUi.indexOf('const consentState = await refreshTenantConsentState(state)'),
  'Platform terms must be checked before Tenant consent',
);

assert.match(workflow, /online-booking\/account-terms/);
assert.match(workflow, /accountTerms:JSON\.parse/);
assert.match(workflow, /online-booking\/\$tenant_id\/booking-state/);
assert.match(workflow, /online-booking\/\$tenant_id\/confirm/);
assert.doesNotMatch(workflow, /online-booking\/\$tenant_id\/requests/);
assert.doesNotMatch(
  workflow,
  /account\/register[^\n]*[\s\S]{0,500}consents\s*:/,
  'Staging smoke must not put Tenant consent back into Account registration',
);

console.log('account terms architecture tests passed');
