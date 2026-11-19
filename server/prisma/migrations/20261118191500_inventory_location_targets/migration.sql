-- Stock-planning preferences are optional. The existing global target
-- remains untouched and is interpreted as "overall" by default.
ALTER TABLE "InventoryItem" ADD COLUMN "targetStockMode" TEXT NOT NULL DEFAULT 'overall';

CREATE TABLE "InventoryLocationTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "targetStock" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryLocationTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryLocationTarget_tenantId_inventoryItemId_locationId_key"
    ON "InventoryLocationTarget"("tenantId","inventoryItemId","locationId");
CREATE INDEX "InventoryLocationTarget_tenantId_locationId_idx"
    ON "InventoryLocationTarget"("tenantId","locationId");
ALTER TABLE "InventoryLocationTarget" ADD CONSTRAINT "InventoryLocationTarget_inventoryItemId_fkey"
    FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
