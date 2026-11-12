-- Quantitative conditions for existing tariff packages, not a new tool registry.
-- These values configure the Admin commercial catalog only. They do not change
-- any active tenant's capability overrides, workplaces or service products.
CREATE TABLE "CommercialTariffLimit" (
  "tariffKey" TEXT NOT NULL,
  "toolKey" TEXT NOT NULL,
  "maxCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialTariffLimit_pkey" PRIMARY KEY ("tariffKey", "toolKey"),
  CONSTRAINT "CommercialTariffLimit_maxCount_check" CHECK ("maxCount" IS NULL OR "maxCount" >= 0)
);
CREATE INDEX "CommercialTariffLimit_toolKey_idx" ON "CommercialTariffLimit"("toolKey");
-- Null maxCount on an EXISTING row means unlimited; absence of a row means unset.
-- The user-confirmed numbers are Start 1 workspace, Start+ 3 workplaces,
-- Start 10 product entries. No other caps are invented here.
INSERT INTO "CommercialTariffLimit" ("tariffKey", "toolKey", "maxCount") VALUES
  ('tariff.start', 'cabinet.profile.workspaces', 1),
  ('tariff.start-plus', 'cabinet.profile.workspaces', 3),
  ('tariff.start', 'cabinet.service.products', 10);
