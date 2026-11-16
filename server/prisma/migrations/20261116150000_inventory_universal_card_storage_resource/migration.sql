-- A single inventory card may describe both its nominal commercial package and its
-- separately measured stock quantity. Existing inventory movements are untouched.
ALTER TABLE "InventoryItem" ADD COLUMN "catalogName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InventoryItem" ADD COLUMN "nominalQuantity" DECIMAL(14,3);
ALTER TABLE "InventoryItem" ADD COLUMN "nominalUnit" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "receiptUnit" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "containerMode" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "thresholdUnit" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "conversionRules" JSONB;
ALTER TABLE "InventoryItem" ADD COLUMN "resourceLimit" DECIMAL(14,3);
ALTER TABLE "InventoryItem" ADD COLUMN "resourceUnit" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "resourceStockQuantity" DECIMAL(14,3);
ALTER TABLE "InventoryItem" ADD COLUMN "resourceExhaustionAction" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "serviceStartAt" TIMESTAMP(3);
ALTER TABLE "InventoryItem" ADD COLUMN "serviceEndAt" TIMESTAMP(3);
-- Legacy lines belong to the virtual primary location; not a stock migration.
ALTER TABLE "InventoryMovementLine" ADD COLUMN "storageLocationId" TEXT NOT NULL DEFAULT 'primary';
CREATE INDEX "InventoryMovementLine_tenant_item_storage_idx" ON "InventoryMovementLine"("tenantId","inventoryItemId","storageLocationId");
CREATE TABLE "InventoryStorageLocation" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "archivedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "InventoryStorageLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryStorageLocation_tenant_location_key" ON "InventoryStorageLocation"("tenantId","locationId");
CREATE INDEX "InventoryStorageLocation_tenant_archive_idx" ON "InventoryStorageLocation"("tenantId","archivedAt","name");
CREATE TABLE "InventoryResourceProgress" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "inventoryItemId" TEXT NOT NULL,
 "storageLocationId" TEXT NOT NULL DEFAULT 'primary', "progress" DECIMAL(14,3) NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "InventoryResourceProgress_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryResourceProgress_tenant_item_storage_key" ON "InventoryResourceProgress"("tenantId","inventoryItemId","storageLocationId");
ALTER TABLE "InventoryResourceProgress" ADD CONSTRAINT "InventoryResourceProgress_item_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "InventoryResourceEvent" (
 "id" TEXT NOT NULL, "tenantId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
 "inventoryItemId" TEXT NOT NULL, "storageLocationId" TEXT NOT NULL DEFAULT 'primary',
 "quantity" DECIMAL(14,3) NOT NULL, "resourceUnit" TEXT NOT NULL,
 "writeOffMovementId" TEXT, "note" TEXT NOT NULL DEFAULT '',
 "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "InventoryResourceEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryResourceEvent_tenant_event_key" ON "InventoryResourceEvent"("tenantId","eventId");
CREATE INDEX "InventoryResourceEvent_tenant_item_occurred_idx" ON "InventoryResourceEvent"("tenantId","inventoryItemId","occurredAt");
ALTER TABLE "InventoryResourceEvent" ADD CONSTRAINT "InventoryResourceEvent_item_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
