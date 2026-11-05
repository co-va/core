CREATE TABLE "DeletedRecordArchive" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recordId" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeletedRecordArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletedRecordArchive_tenantId_recordId_key" ON "DeletedRecordArchive"("tenantId","recordId");
ALTER TABLE "DeletedRecordArchive" ADD CONSTRAINT "DeletedRecordArchive_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
