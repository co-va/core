-- Optional product preferences. No change to the canonical stock unit,
-- recorded movements, quantities, lots, or the existing packageQuantity.
ALTER TABLE "InventoryItem"
  ADD COLUMN "consumeUnit" TEXT,
  ADD COLUMN "consumeQuantity" DECIMAL(14,3),
  ADD COLUMN "saleUnit" TEXT,
  ADD COLUMN "saleQuantity" DECIMAL(14,3),
  ADD COLUMN "saleMarkupMode" TEXT,
  ADD COLUMN "saleMarkupValue" DECIMAL(14,4),
  ADD COLUMN "salePrice" DECIMAL(14,4);
