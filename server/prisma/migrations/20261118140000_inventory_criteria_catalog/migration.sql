-- Tenant-owned names and values for independent Stock classification criteria.
-- Existing manufacturer/category/productType and all Inventory movement data remain intact.
CREATE TABLE "InventoryCriteriaCatalog" (
  "tenantId" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryCriteriaCatalog_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "InventoryItem" ADD COLUMN "criteriaValues" JSONB;
