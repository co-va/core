DROP TABLE IF EXISTS "TelegramEntryTicket";

ALTER TABLE "TelegramBotConnection"
    DROP COLUMN IF EXISTS "webhookKey",
    DROP COLUMN IF EXISTS "webhookSecretHash";
