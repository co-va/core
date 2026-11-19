-- A card can be made available in several warehouses without changing any stock.
-- Mass/quantity remains exclusively in inventory movement lines.
ALTER TABLE "InventoryItem" ADD COLUMN "storageLocationIds" JSONB;
