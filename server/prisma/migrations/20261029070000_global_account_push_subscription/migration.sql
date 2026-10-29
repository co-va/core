ALTER TABLE "WebPushSubscription"
  ALTER COLUMN "tenantId" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "WebPushSubscription_accountId_idx"
  ON "WebPushSubscription"("accountId");
