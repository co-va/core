-- Tenant-owned nested classification for Inventory / Stock.
-- Legacy manufacturer/category/productType strings remain intact for older clients.
CREATE TABLE "InventoryClassificationGroup" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "parentGroupId" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "InventoryClassificationGroup_tenantId_groupId_key"
  ON "InventoryClassificationGroup"("tenantId","groupId");
CREATE UNIQUE INDEX "InventoryClassificationGroup_tenantId_parentGroupId_name_key"
  ON "InventoryClassificationGroup"("tenantId","parentGroupId","name");
CREATE INDEX "InventoryClassificationGroup_tenantId_archivedAt_parentGroupId_position_idx"
  ON "InventoryClassificationGroup"("tenantId","archivedAt","parentGroupId","position");

ALTER TABLE "InventoryItem" ADD COLUMN "classificationGroupId" TEXT;
CREATE INDEX "InventoryItem_tenantId_classificationGroupId_idx"
  ON "InventoryItem"("tenantId","classificationGroupId");

-- Backfill existing items into a tree, retaining their original three legacy
-- text fields and all stock/financial movements unmodified.
DO $classification_backfill$
DECLARE
  item_row RECORD;
  name_value TEXT;
  parent_key TEXT;
  next_group TEXT;
  group_names TEXT[];
BEGIN
  FOR item_row IN
    SELECT "id", "tenantId", "manufacturer", "category", "productType"
    FROM "InventoryItem"
  LOOP
    parent_key := '';
    group_names := ARRAY[
      NULLIF(btrim(item_row."manufacturer"), ''),
      NULLIF(btrim(item_row."category"), ''),
      NULLIF(btrim(item_row."productType"), '')
    ];
    FOREACH name_value IN ARRAY group_names LOOP
      IF name_value IS NULL THEN CONTINUE; END IF;
      next_group := md5(item_row."tenantId" || ':' || parent_key || ':' || name_value);
      INSERT INTO "InventoryClassificationGroup"
        ("id", "tenantId", "groupId", "parentGroupId", "name")
      VALUES (next_group, item_row."tenantId", next_group, parent_key, name_value)
      ON CONFLICT ("tenantId", "parentGroupId", "name")
      DO UPDATE SET "name" = EXCLUDED."name"
      RETURNING "groupId" INTO parent_key;
    END LOOP;
    IF parent_key <> '' THEN
      UPDATE "InventoryItem" SET "classificationGroupId" = parent_key
      WHERE "id" = item_row."id";
    END IF;
  END LOOP;
END
$classification_backfill$;
