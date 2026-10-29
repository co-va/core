DROP INDEX IF EXISTS "WebPushSubscription_tenantId_accountId_idx";

ALTER TABLE "WebPushSubscription"
  DROP CONSTRAINT IF EXISTS "WebPushSubscription_tenantId_fkey";

ALTER TABLE "WebPushSubscription"
  DROP COLUMN IF EXISTS "tenantId";

CREATE INDEX IF NOT EXISTS "WebPushSubscription_accountId_idx"
  ON "WebPushSubscription"("accountId");
