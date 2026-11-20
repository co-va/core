-- Virtual consumption groups belong to Inventory, not to the Service price list.
-- They never decrement real InventoryItem quantities or InventoryLot balances.
CREATE TABLE "InventoryConsumptionGroup" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "itemIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryConsumptionGroup_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryConsumptionGroup_unit_check" CHECK (
    "unit" IN ('г','мл','шт.','уп.','кг','л','м','см','м²','пара','компл.')
  ),
  CONSTRAINT "InventoryConsumptionGroup_items_array_check" CHECK (jsonb_typeof("itemIds")='array')
);
CREATE UNIQUE INDEX "InventoryConsumptionGroup_tenantId_groupId_key"
  ON "InventoryConsumptionGroup"("tenantId","groupId");
CREATE INDEX "InventoryConsumptionGroup_tenant_archived_name_idx"
  ON "InventoryConsumptionGroup"("tenantId","archivedAt","name");
CREATE UNIQUE INDEX "InventoryConsumptionGroup_active_name_unique"
  ON "InventoryConsumptionGroup"("tenantId",lower(btrim("name")))
  WHERE "archivedAt" IS NULL;
