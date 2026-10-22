CREATE TABLE IF NOT EXISTS "Event" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT,
  "ownerType" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "context" JSONB NOT NULL DEFAULT '{}',
  "date" TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "color" TEXT NOT NULL DEFAULT '#777A7D',
  "workplaceId" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Event_tenantId_workplaceId_date_idx" ON "Event"("tenantId", "workplaceId", "date");
CREATE INDEX IF NOT EXISTS "Event_ownerType_ownerId_date_idx" ON "Event"("ownerType", "ownerId", "date");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Event_tenantId_fkey'
  ) THEN
    ALTER TABLE "Event"
      ADD CONSTRAINT "Event_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

WITH legacy_base AS (
  SELECT
    s."tenantId",
    item.value,
    item.ordinality,
    NULLIF(item.value->>'id', '') AS legacy_id,
    COUNT(*) OVER (PARTITION BY NULLIF(item.value->>'id', '')) AS legacy_id_count
  FROM "BusinessOperationalState" s
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(s."data"->'breaks') = 'array' THEN s."data"->'breaks' ELSE '[]'::jsonb END
  ) WITH ORDINALITY AS item(value, ordinality)
), legacy AS (
  SELECT
    base.*,
    CASE
      WHEN base.legacy_id IS NOT NULL
        AND base.legacy_id_count = 1
        AND NOT EXISTS (
          SELECT 1
          FROM "Event" existing
          WHERE existing."id" = base.legacy_id
            AND NOT (
              existing."tenantId" IS NOT DISTINCT FROM base."tenantId"
              AND COALESCE(existing."context"->>'migratedFrom', '') = 'break'
            )
        )
      THEN base.legacy_id
      ELSE 'legacy-break-' || md5(
        base."tenantId" || '|' || COALESCE(base.value->>'id', '') || '|' ||
        COALESCE(base.value->>'date', '') || '|' || COALESCE(base.value->>'workplaceId', '') || '|' ||
        COALESCE(base.value->>'from', '') || '|' || COALESCE(base.value->>'to', '') || '|' || base.ordinality::text
      )
    END AS event_id
  FROM legacy_base base
)
INSERT INTO "Event" (
  "id", "tenantId", "ownerType", "ownerId", "context", "date", "from", "to",
  "title", "description", "color", "workplaceId", "createdAt", "updatedAt"
)
SELECT
  legacy.event_id,
  legacy."tenantId",
  'tenant',
  legacy."tenantId",
  jsonb_build_object(
    'scope', 'professional',
    'migratedFrom', 'break',
    'legacyBreakId', COALESCE(legacy.value->>'id', '')
  ),
  LEFT(COALESCE(legacy.value->>'date', ''), 10),
  COALESCE(legacy.value->>'from', ''),
  COALESCE(legacy.value->>'to', ''),
  'Перерыв',
  '',
  '#777A7D',
  COALESCE(legacy.value->>'workplaceId', ''),
  CASE
    WHEN COALESCE(legacy.value->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN ((legacy.value->>'createdAt')::timestamptz AT TIME ZONE 'UTC')
    ELSE CURRENT_TIMESTAMP
  END,
  CURRENT_TIMESTAMP
FROM legacy
ON CONFLICT ("id") DO NOTHING;

DO $$
DECLARE missing_count INTEGER;
BEGIN
  WITH legacy_base AS (
    SELECT
      s."tenantId",
      item.value,
      item.ordinality,
      NULLIF(item.value->>'id', '') AS legacy_id,
      COUNT(*) OVER (PARTITION BY NULLIF(item.value->>'id', '')) AS legacy_id_count
    FROM "BusinessOperationalState" s
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(s."data"->'breaks') = 'array' THEN s."data"->'breaks' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item(value, ordinality)
  ), legacy AS (
    SELECT
      base.*,
      CASE
        WHEN base.legacy_id IS NOT NULL
          AND base.legacy_id_count = 1
          AND EXISTS (
            SELECT 1 FROM "Event" existing
            WHERE existing."id" = base.legacy_id
              AND existing."tenantId" IS NOT DISTINCT FROM base."tenantId"
              AND COALESCE(existing."context"->>'migratedFrom', '') = 'break'
          )
        THEN base.legacy_id
        ELSE 'legacy-break-' || md5(
          base."tenantId" || '|' || COALESCE(base.value->>'id', '') || '|' ||
          COALESCE(base.value->>'date', '') || '|' || COALESCE(base.value->>'workplaceId', '') || '|' ||
          COALESCE(base.value->>'from', '') || '|' || COALESCE(base.value->>'to', '') || '|' || base.ordinality::text
        )
      END AS event_id
    FROM legacy_base base
  )
  SELECT COUNT(*) INTO missing_count
  FROM legacy
  LEFT JOIN "Event" e ON e."id" = legacy.event_id
  WHERE e."id" IS NULL
    OR e."tenantId" IS DISTINCT FROM legacy."tenantId"
    OR COALESCE(e."context"->>'migratedFrom', '') <> 'break'
    OR e."date" <> LEFT(COALESCE(legacy.value->>'date', ''), 10)
    OR e."from" <> COALESCE(legacy.value->>'from', '')
    OR e."to" <> COALESCE(legacy.value->>'to', '')
    OR e."workplaceId" <> COALESCE(legacy.value->>'workplaceId', '');

  IF missing_count > 0 THEN
    RAISE EXCEPTION 'legacy Break migration incomplete: % rows not safely represented as Event', missing_count;
  END IF;
END $$;

UPDATE "BusinessOperationalState"
SET "data" = (COALESCE("data", '{}'::jsonb) - 'breaks')
  || jsonb_build_object(
    'migrationVersions',
    COALESCE("data"->'migrationVersions', '{}'::jsonb)
      || jsonb_build_object('eventFromBreakV1', 1)
  )
WHERE "data" ? 'breaks';
