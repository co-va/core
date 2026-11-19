-- A catalog card may be available at several warehouses with zero stock.
-- These are assignments only; historical movements and quantities stay unchanged.
ALTER TABLE "InventoryItem" ADD COLUMN "storageLocationIds" JSONB;
