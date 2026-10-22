CREATE TABLE "Note" (
  "id" TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "tenantId" TEXT,
  "context" JSONB NOT NULL DEFAULT '{}',
  "date" TEXT NOT NULL,
  "from" TEXT NOT NULL DEFAULT '',
  "to" TEXT NOT NULL DEFAULT '',
  "targetType" TEXT NOT NULL DEFAULT '',
  "targetId" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL DEFAULT '',
  "text" TEXT NOT NULL DEFAULT '',
  "color" TEXT NOT NULL DEFAULT '#CFC3FF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Note_ownerType_ownerId_date_idx" ON "Note"("ownerType", "ownerId", "date");
CREATE INDEX "Note_tenantId_date_idx" ON "Note"("tenantId", "date");
CREATE INDEX "Note_targetType_targetId_idx" ON "Note"("targetType", "targetId");

ALTER TABLE "Note"
  ADD CONSTRAINT "Note_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
