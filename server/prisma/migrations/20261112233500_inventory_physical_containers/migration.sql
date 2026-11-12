-- Additive two-unit inventory: historical mass and other records are unchanged.
-- Existing unknown container counts stay NULL rather than being guessed.
ALTER TABLE "InventoryItem" ADD COLUMN "containerCount" INTEGER;
ALTER TABLE "InventoryMovementLine"
  ADD COLUMN "containerDelta" INTEGER,
  ADD COLUMN "expectedContainerCount" INTEGER,
  ADD COLUMN "actualContainerCount" INTEGER;
