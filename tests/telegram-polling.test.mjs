import assert from 'node:assert/strict';
import fs from 'node:fs';

const service = fs.readFileSync('server/src/communication/telegram-bot.service.ts', 'utf8');
const migration = fs.readFileSync('server/prisma/migrations/20261010224500_telegram_polling_cursor/migration.sql', 'utf8');

assert.match(service, /TELEGRAM_INBOUND_POLL_MS = 2_000/);
assert.match(service, /pollAllTenantsInBackground/);
assert.match(service, /telegramApi\(token, 'deleteWebhook'/);
assert.match(service, /telegramApi\(token, 'getUpdates'/);
assert.match(service, /const storedOffset = Number\(row\.inboundOffset \|\| 0\)/);
assert.match(service, /const offset = Number\.isFinite\(storedOffset\) && storedOffset > 0 \? storedOffset : 0/);
assert.match(service, /offset,\s*limit: 100/);
assert.match(service, /SET "inboundOffset" = \$\{BigInt\(nextOffset\)\}/);
assert.doesNotMatch(service, /offset:\s*-1/);
assert.match(service, /"inboundOffset"/);
assert.match(service, /transport: 'polling'/);
assert.match(service, /inboundActive: true/);
assert.doesNotMatch(service, /telegramApi\(token, 'setWebhook'/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS "inboundOffset" BIGINT NOT NULL DEFAULT 0/);

console.log('Telegram inbound polling transport contract tests passed');
