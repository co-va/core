-- A new independent Stock E instrument starts unavailable. No existing account,
-- tariff, product, balance, or previously issued tool permission is changed.
INSERT INTO "Capability"
  ("id","key","groupKey","name","description","valueType",
   "defaultEnabled","defaultLimit","position","isActive","createdAt","updatedAt")
VALUES
  ('cap_inventory_consumption_groups_access','inventory.consumption_groups.access',
   'inventory','Склад · Группы расхода',
   'Группирование взаимозаменяемых складских позиций для общего расхода',
   'BOOLEAN',false,NULL,206,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "groupKey"=EXCLUDED."groupKey",
  "name"=EXCLUDED."name",
  "description"=EXCLUDED."description",
  "valueType"=EXCLUDED."valueType",
  "position"=EXCLUDED."position",
  "isActive"=true,
  "updatedAt"=CURRENT_TIMESTAMP;

INSERT INTO "AdminToolReadiness" ("key","status","enforced","updatedAt")
VALUES ('cabinet.inventory.consumption-groups','NOT_READY',false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
