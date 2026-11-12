-- Tariff orders are snapshots. Legacy individual-tool orders keep their
-- original 30-day behavior. Only new tariff orders use stored accessDays.
ALTER TABLE "CommercialOrder"
  ADD COLUMN "tariffKey" TEXT,
  ADD COLUMN "periodMonths" INTEGER,
  ADD COLUMN "paidDays" INTEGER,
  ADD COLUMN "bonusDays" INTEGER,
  ADD COLUMN "accessDays" INTEGER;

ALTER TABLE "CommercialOrder"
  ADD CONSTRAINT "CommercialOrder_tariff_period_check" CHECK (
    "tariffKey" IS NULL
    OR (
      "tariffKey" IN ('tariff.start-plus','tariff.pro')
      AND "periodMonths" IN (1,6,12)
      AND "paidDays" IN (30,180,360)
      AND "bonusDays" >= 0
      AND "accessDays" = "paidDays" + "bonusDays"
    )
  );

-- Preserve the existing additive, transaction-locked subscription renewal.
-- One paid transition grants its own immutable snapshot duration exactly once.
CREATE OR REPLACE FUNCTION "setCommercialPaidAccessPeriod"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  paid_at TIMESTAMP(3);
  current_start TIMESTAMP(3);
  current_end TIMESTAMP(3);
  period_start TIMESTAMP(3);
  period_end TIMESTAMP(3);
BEGIN
  IF NEW."status" = 'PAID'
     AND OLD."status" IS DISTINCT FROM 'PAID'
     AND NEW."totalMinor" > 0 THEN
    paid_at := COALESCE(NEW."paidAt", CURRENT_TIMESTAMP);

    SELECT "paidAccessStartsAt", "paidAccessEndsAt"
      INTO current_start, current_end
    FROM "CommercialTenantTerms"
    WHERE "tenantId" = NEW."tenantId"
    FOR UPDATE;

    IF current_end IS NOT NULL AND current_end > paid_at THEN
      period_start := current_end;
    ELSE
      period_start := paid_at;
      current_start := paid_at;
    END IF;

    period_end := period_start + (COALESCE(NEW."accessDays", 30) * INTERVAL '1 day');
    NEW."accessStartsAt" := period_start;
    NEW."accessEndsAt" := period_end;

    UPDATE "CommercialTenantTerms"
    SET
      "paidAccessStartsAt" = COALESCE(current_start, paid_at),
      "paidAccessEndsAt" = period_end,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "tenantId" = NEW."tenantId";
  END IF;

  RETURN NEW;
END;
$$;
