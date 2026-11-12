-- Additive only: no historical inventory movements or purchase costs are rewritten.
-- referencePrice: optional reference price per nominal package (packageQuantity, or one unit).
-- primaryOfferId: stable tenant-scoped offerId of the regular supplier, validated in API.
ALTER TABLE "InventoryItem"
  ADD COLUMN "referencePrice" DECIMAL(14,4),
  ADD COLUMN "primaryOfferId" TEXT;

-- Existing supplier offers retain their prior per-unit interpretation.
-- New offer edits can specify the stock base-units supplied by one purchased pack.
ALTER TABLE "InventorySupplierOffer"
  ADD COLUMN "unitsPerOffer" DECIMAL(14,3) NOT NULL DEFAULT 1;
