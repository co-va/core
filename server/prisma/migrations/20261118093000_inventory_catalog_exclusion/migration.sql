-- Keep dismissed supplier catalog rows recoverable without modifying inventory or source files.
ALTER TABLE "InventoryCounterpartyCatalogItem"
  ADD COLUMN "excludedAt" TIMESTAMP(3);
CREATE INDEX "InventoryCounterpartyCatalogItem_tenantId_priceListId_excludedAt_idx"
  ON "InventoryCounterpartyCatalogItem"("tenantId", "priceListId", "excludedAt");
