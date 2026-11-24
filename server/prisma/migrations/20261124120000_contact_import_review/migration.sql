CREATE TABLE "ContactImportBatch" (
 "id" TEXT NOT NULL,
 "tenantId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL,
 "filename" TEXT NOT NULL,
 "fingerprint" TEXT NOT NULL,
 "total" INTEGER NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'review',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ContactImportBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ContactImportRow" (
 "id" TEXT NOT NULL,
 "tenantId" TEXT NOT NULL,
 "batchId" TEXT NOT NULL,
 "rowNumber" INTEGER NOT NULL,
 "values" JSONB NOT NULL,
 "issues" JSONB NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'new',
 "personKey" TEXT NOT NULL DEFAULT '',
 "error" TEXT NOT NULL DEFAULT '',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ContactImportRow_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContactImportBatch_tenantId_createdAt_idx" ON "ContactImportBatch" ("tenantId","createdAt");
CREATE INDEX "ContactImportBatch_tenantId_fingerprint_idx" ON "ContactImportBatch" ("tenantId","fingerprint");
CREATE UNIQUE INDEX "ContactImportRow_batchId_rowNumber_key" ON "ContactImportRow" ("batchId","rowNumber");
CREATE INDEX "ContactImportRow_tenantId_status_idx" ON "ContactImportRow" ("tenantId","status");
ALTER TABLE "ContactImportRow" ADD CONSTRAINT "ContactImportRow_batchId_fkey"
 FOREIGN KEY ("batchId") REFERENCES "ContactImportBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
