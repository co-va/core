import assert from 'node:assert/strict';
import fs from 'node:fs';

const professionalEmail = fs.readFileSync('server/src/integrations/professional-email.service.ts', 'utf8');
const emailChannel = fs.readFileSync('server/src/communication/email-channel.service.ts', 'utf8');
const transactionalEmail = fs.readFileSync('server/src/integrations/transactional-email.service.ts', 'utf8');
const communicationController = fs.readFileSync('server/src/communication/communication.controller.ts', 'utf8');
const emailMigration = fs.readFileSync('server/prisma/migrations/20261011213000_professional_email/migration.sql', 'utf8');
const inputs = fs.readFileSync('ui/inputs/index.js', 'utf8');
const v2Css = fs.readFileSync('ui/v2/v2.css', 'utf8');

assert.match(professionalEmail, /PROFESSIONAL_EMAIL_OAUTH_ENABLED/);
assert.match(professionalEmail, /aes-256-gcm/);
assert.match(professionalEmail, /replyTo: row\.email/);
assert.doesNotMatch(professionalEmail, /mail:imap|imap\.yandex/);
assert.match(emailChannel, /ProfessionalEmailService/);
assert.doesNotMatch(emailChannel, /TransactionalEmailService/);
assert.doesNotMatch(emailChannel, /hasActivePdnConsentForContact/);
assert.match(emailChannel, /purpose === 'MARKETING'/);
assert.match(emailChannel, /canSendMarketing/);
assert.match(transactionalEmail, /yandex-postbox/);
assert.match(transactionalEmail, /transporter\(\)\.verify\(\)/);
assert.match(communicationController, /integrations\/email\/connect/);
assert.match(communicationController, /integrations\/email\/oauth\/yandex\/callback/);
assert.match(communicationController, /https:\/\/app\.va-tools\.ru/);
assert.doesNotMatch(communicationController, /https:\/\/book\.va-tools\.ru/);
assert.match(emailMigration, /ProfessionalEmailConnection/);
assert.match(emailMigration, /ProfessionalEmailOAuthState/);

assert.match(inputs, /disabled = false/);
assert.match(inputs, /disabled \? ' disabled'/);
assert.match(v2Css, /--v2-danger:#FF1111/);
assert.match(v2Css, /v2-header__slot--c \.v2-header__control--danger\{border-color:var\(--v2-danger\);background:var\(--v2-danger\);color:#fff\}/);
assert.doesNotMatch(v2Css, /#FDD2D2|#EB4C42/);

console.log('Email and Telegram integrations UI architecture tests: OK');