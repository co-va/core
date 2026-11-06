-- #844: anonymous and Account login audits are PLATFORM security events.
-- Reuse PlatformActivityEvent rather than introducing a shadow login log.
BEGIN;
ALTER TABLE "PlatformActivityEvent" ALTER COLUMN "tenantId" DROP NOT NULL;
ALTER TABLE "PlatformActivityEvent"
  ADD COLUMN "subjectAccountId" TEXT;
CREATE INDEX "PlatformActivityEvent_subjectAccountId_occurredAt_idx"
  ON "PlatformActivityEvent"("subjectAccountId","occurredAt" DESC)
  WHERE "subjectAccountId" IS NOT NULL;
COMMIT;
