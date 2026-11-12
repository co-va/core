-- A disabled tool is represented in the existing CommercialProduct row.
-- This is NOT a new registry or an account-level access change.
ALTER TABLE "CommercialProduct"
  ADD COLUMN "tariffExcluded" BOOLEAN NOT NULL DEFAULT false;

-- The owner-approved Pro quantity ceilings are unlimited. Previous explicit
-- values win. Keep missing Start+ product caps unset until owner defines them.
INSERT INTO "CommercialTariffLimit" ("tariffKey", "toolKey", "maxCount")
VALUES
  ('tariff.pro','cabinet.profile.workspaces',NULL),
  ('tariff.pro','cabinet.service.products',NULL)
ON CONFLICT ("tariffKey","toolKey") DO NOTHING;
