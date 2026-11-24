-- Provenance and future Journal reconciliation belong to canonical FinanceOperation.
-- Existing operations are native; imported rows use origin='excel_import'.
ALTER TABLE "FinanceOperation"
 ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'application',
 ADD COLUMN "importBatchId" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "externalOperationId" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "sourceRow" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'not_applicable',
 ADD COLUMN "linkedRecordId" TEXT NOT NULL DEFAULT '',
 ADD COLUMN "walletResolution" TEXT NOT NULL DEFAULT 'resolved';
CREATE INDEX "FinanceOperation_tenantId_origin_occurredAt_idx" ON "FinanceOperation"("tenantId","origin","occurredAt");
CREATE INDEX "FinanceOperation_tenantId_importBatchId_idx" ON "FinanceOperation"("tenantId","importBatchId");
CREATE INDEX "FinanceOperation_tenantId_externalOperationId_idx" ON "FinanceOperation"("tenantId","externalOperationId");
