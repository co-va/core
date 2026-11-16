-- Add metadata to supplier catalog introduced in 20261116220000. Never edit applied migrations.
ALTER TABLE "InventoryCounterpartyPriceList"
  ADD COLUMN IF NOT EXISTS "terms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "InventoryCounterpartyCatalogItem"
  ADD COLUMN IF NOT EXISTS "brand" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "supplierNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "sourceRow" INTEGER,
  ADD COLUMN IF NOT EXISTS "supplierAvailable" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "retailPrice" DECIMAL(14,4),
  ADD COLUMN IF NOT EXISTS "suggestedOrderQuantity" DECIMAL(14,3);
