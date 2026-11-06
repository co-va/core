-- Preserve only display facts before a Professional physically deletes a Record.
-- This is not an operational Record, and it must not resurrect booking, finance or time occupancy.
CREATE TABLE "DeletedRecordSnapshot" (
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeletedRecordSnapshot_pkey" PRIMARY KEY ("tenantId", "recordId")
);

CREATE INDEX "DeletedRecordSnapshot_tenantId_deletedAt_idx"
  ON "DeletedRecordSnapshot"("tenantId", "deletedAt");

ALTER TABLE "DeletedRecordSnapshot"
  ADD CONSTRAINT "DeletedRecordSnapshot_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
