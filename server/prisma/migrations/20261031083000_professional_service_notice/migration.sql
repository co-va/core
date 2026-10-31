BEGIN;

CREATE TABLE IF NOT EXISTS "ProfessionalServiceNotice" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "platformAccountId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfessionalServiceNotice_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProfessionalServiceNotice_platformAccountId_fkey"
    FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ProfessionalServiceNotice_tenant_created_idx"
  ON "ProfessionalServiceNotice"("tenantId", "createdAt");

CREATE INDEX IF NOT EXISTS "ProfessionalServiceNotice_account_read_created_idx"
  ON "ProfessionalServiceNotice"("platformAccountId", "readAt", "createdAt");

INSERT INTO "ProfessionalServiceNotice" (
  "id", "tenantId", "platformAccountId", "type", "title", "body", "metadata", "readAt", "createdAt"
)
SELECT
  "id",
  "tenantId",
  "platformAccountId",
  lower(replace("type", '_', '.')),
  "title",
  "body",
  "metadata",
  "readAt",
  "createdAt"
FROM "PlatformNotice"
WHERE lower(replace("type", '_', '.')) LIKE 'booking.%'
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "PlatformNotice"
WHERE lower(replace("type", '_', '.')) LIKE 'booking.%';

COMMIT;
