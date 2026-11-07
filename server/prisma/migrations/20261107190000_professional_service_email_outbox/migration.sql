-- Owner service Email: durable queue adjacent to the canonical professional notice.
-- Do not backfill older notices: that could unexpectedly email historical activity.
BEGIN;

CREATE TABLE "ProfessionalServiceEmailOutbox" (
  "noticeId" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalServiceEmailOutbox_noticeId_fkey"
    FOREIGN KEY ("noticeId") REFERENCES "ProfessionalServiceNotice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProfessionalServiceEmailOutbox_status_check"
    CHECK ("status" IN ('PENDING', 'PROCESSING', 'RETRY', 'SENT', 'SKIPPED', 'FAILED')),
  CONSTRAINT "ProfessionalServiceEmailOutbox_attempts_check"
    CHECK ("attempts" >= 0)
);

CREATE INDEX "ProfessionalServiceEmailOutbox_due_idx"
  ON "ProfessionalServiceEmailOutbox"("nextAttemptAt", "createdAt")
  WHERE "status" IN ('PENDING', 'RETRY', 'PROCESSING');

COMMIT;
