-- Paid commercial tools are a time-bounded subscription. Free LIVE remains available after expiry.
ALTER TABLE "CommercialTenantTerms"
  ADD COLUMN "paidAccessStartsAt" TIMESTAMP(3),
  ADD COLUMN "paidAccessEndsAt" TIMESTAMP(3);

ALTER TABLE "CommercialOrder"
  ADD COLUMN "accessStartsAt" TIMESTAMP(3),
  ADD COLUMN "accessEndsAt" TIMESTAMP(3);

CREATE INDEX "CommercialTenantTerms_paidAccessEndsAt_idx"
  ON "CommercialTenantTerms"("paidAccessEndsAt");
CREATE INDEX "CommercialOrder_tenantId_accessEndsAt_idx"
  ON "CommercialOrder"("tenantId", "accessEndsAt");

-- Existing successful paid orders get a bounded period instead of permanent paid access.
UPDATE "CommercialOrder"
SET
  "accessStartsAt" = "paidAt",
  "accessEndsAt" = "paidAt" + INTERVAL '30 days'
WHERE "status" = 'PAID'
  AND "totalMinor" > 0
  AND "paidAt" IS NOT NULL
  AND "accessEndsAt" IS NULL;

WITH latest_paid AS (
  SELECT DISTINCT ON ("tenantId")
    "tenantId", "accessStartsAt", "accessEndsAt"
  FROM "CommercialOrder"
  WHERE "status" = 'PAID'
    AND "totalMinor" > 0
    AND "accessEndsAt" IS NOT NULL
  ORDER BY "tenantId", "accessEndsAt" DESC
)
UPDATE "CommercialTenantTerms" terms
SET
  "paidAccessStartsAt" = latest_paid."accessStartsAt",
  "paidAccessEndsAt" = latest_paid."accessEndsAt",
  "updatedAt" = CURRENT_TIMESTAMP
FROM latest_paid
WHERE terms."tenantId" = latest_paid."tenantId";

-- A paid order grants exactly one 30-day period. A retry of the same PAID order does not extend it.
-- If a new payment is confirmed before a current period ends, the next 30 days start at the old end.
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

    period_end := period_start + INTERVAL '30 days';
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

CREATE TRIGGER "CommercialOrder_paid_access_period_trg"
BEFORE UPDATE OF "status", "paidAt" ON "CommercialOrder"
FOR EACH ROW
EXECUTE FUNCTION "setCommercialPaidAccessPeriod"();
