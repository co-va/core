ALTER TABLE "CommercialProduct"
  ADD COLUMN "readiness" TEXT NOT NULL DEFAULT 'NOT_READY';

ALTER TABLE "CommercialProduct"
  ADD CONSTRAINT "CommercialProduct_readiness_check"
  CHECK ("readiness" IN ('NOT_READY', 'TESTING', 'READY'));
