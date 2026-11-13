-- Start was always offered publicly before its publication switch existed,
-- even though its stored isSaleable flag was false.
-- Preserve that live behaviour exactly once on upgrade. After this migration,
-- the administrator controls all three tariffs independently via isSaleable.
UPDATE "CommercialProduct"
SET "isSaleable" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'tariff.start' AND "isSaleable" = false;
