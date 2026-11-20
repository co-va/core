-- Position is a required, manufacturer-local ordinal. The previous
-- default of 0 created permanently unnumbered items; remove it first.
ALTER TABLE "InventoryItem" ALTER COLUMN "position" DROP DEFAULT;

-- One-time deterministic repair of existing active records.
-- Preserve the relative order of all positive positions; previously
-- unnumbered items follow in name/creation order. Do not touch balances,
-- suppliers, movement history, lot quantities, or archived catalog rows.
WITH numbered AS (
  SELECT "id", "position",
    ROW_NUMBER() OVER (
      PARTITION BY "tenantId", "manufacturer"
      ORDER BY CASE WHEN "position" > 0 THEN 0 ELSE 1 END,
               CASE WHEN "position" > 0 THEN "position" ELSE NULL END,
               "name" COLLATE "C", "createdAt", "id"
    )::integer AS "nextPosition"
  FROM "InventoryItem"
  WHERE "archivedAt" IS NULL
)
UPDATE "InventoryItem" AS item
SET "position" = numbered."nextPosition"
FROM numbered
WHERE item."id" = numbered."id"
  AND item."position" IS DISTINCT FROM numbered."nextPosition";

-- Active rows can never be written with a blank/zero/negative ordinal.
-- The server's tenant advisory lock + atomic order algorithm enforce
-- uniqueness and continuity on every mutation. Archived historical
-- rows are kept unchanged for audit.
ALTER TABLE "InventoryItem"
  ADD CONSTRAINT "InventoryItem_active_position_positive"
  CHECK ("archivedAt" IS NOT NULL OR "position" > 0);
