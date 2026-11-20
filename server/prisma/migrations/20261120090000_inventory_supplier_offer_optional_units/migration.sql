-- A supplier catalog product can be linked by SKU before its pack size is known.
-- Existing conversion values are preserved; no historical quantities or prices change.
ALTER TABLE "InventorySupplierOffer"
  ALTER COLUMN "unitsPerOffer" DROP DEFAULT,
  ALTER COLUMN "unitsPerOffer" DROP NOT NULL;
