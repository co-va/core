-- Bonus time is a configurable commercial condition per paid tariff, not
-- a discount from price. Keep previously issued CommercialOrder snapshots.
CREATE TABLE "CommercialTariffPeriod" (
  "tariffKey" TEXT NOT NULL,
  "months" INTEGER NOT NULL,
  "bonusPercent" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialTariffPeriod_pkey" PRIMARY KEY ("tariffKey", "months"),
  CONSTRAINT "CommercialTariffPeriod_months_check" CHECK ("months" IN (6,12)),
  CONSTRAINT "CommercialTariffPeriod_bonus_check" CHECK ("bonusPercent" BETWEEN 0 AND 100)
);
INSERT INTO "CommercialTariffPeriod" ("tariffKey","months","bonusPercent")
VALUES
  ('tariff.start-plus',6,20),
  ('tariff.start-plus',12,50),
  ('tariff.pro',6,20),
  ('tariff.pro',12,50),
  ('tariff.records.start-plus',6,20),
  ('tariff.records.start-plus',12,50),
  ('tariff.records.pro',6,20),
  ('tariff.records.pro',12,50);
