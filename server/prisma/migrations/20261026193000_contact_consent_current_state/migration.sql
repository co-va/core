-- Materialize the current Contact Point consent flags inside the existing
-- TenantDocumentArchive owner. TenantConsentEvent stays append-only history.
WITH "documentVersions" AS (
  SELECT
    a."tenantId",
    COALESCE((
      SELECT GREATEST(1, COALESCE((document->>'version')::integer, 1))
      FROM jsonb_array_elements(COALESCE(a."data"->'documents', '[]'::jsonb)) document
      WHERE document->>'id' = 'pdn-consent'
      LIMIT 1
    ), 0) AS "pdnVersion",
    COALESCE((
      SELECT GREATEST(1, COALESCE((document->>'version')::integer, 1))
      FROM jsonb_array_elements(COALESCE(a."data"->'documents', '[]'::jsonb)) document
      WHERE document->>'id' = 'messages-consent'
      LIMIT 1
    ), 0) AS "marketingVersion"
  FROM "TenantDocumentArchive" a
),
"latest" AS (
  SELECT DISTINCT ON (e."tenantId", e."subjectKey", e."documentId")
    e."tenantId",
    e."subjectKey",
    e."documentId",
    e."documentVersion",
    e."status"
  FROM "TenantConsentEvent" e
  WHERE e."subjectType" = 'CONTACT_POINT'
    AND e."subjectKey" <> ''
    AND e."documentId" IN ('pdn-consent', 'messages-consent')
  ORDER BY
    e."tenantId",
    e."subjectKey",
    e."documentId",
    e."occurredAt" DESC,
    e."createdAt" DESC,
    e."id" DESC
),
"contactKeys" AS (
  SELECT DISTINCT "tenantId", "subjectKey"
  FROM "latest"
),
"states" AS (
  SELECT
    k."tenantId",
    jsonb_object_agg(
      k."subjectKey",
      jsonb_build_object(
        'pdnActive', COALESCE((
          SELECT l."status" = 'accepted' AND l."documentVersion" = d."pdnVersion"
          FROM "latest" l
          WHERE l."tenantId" = k."tenantId"
            AND l."subjectKey" = k."subjectKey"
            AND l."documentId" = 'pdn-consent'
          LIMIT 1
        ), false),
        'marketingActive', COALESCE((
          SELECT l."status" = 'accepted' AND l."documentVersion" = d."marketingVersion"
          FROM "latest" l
          WHERE l."tenantId" = k."tenantId"
            AND l."subjectKey" = k."subjectKey"
            AND l."documentId" = 'messages-consent'
          LIMIT 1
        ), false)
      )
    ) AS "contactConsentState"
  FROM "contactKeys" k
  JOIN "documentVersions" d ON d."tenantId" = k."tenantId"
  GROUP BY k."tenantId"
)
UPDATE "TenantDocumentArchive" a
SET "data" = jsonb_set(
  jsonb_set(
    COALESCE(a."data", '{}'::jsonb),
    '{helpers}',
    COALESCE(a."data"->'helpers', '{}'::jsonb),
    true
  ),
  '{helpers,contactConsentState}',
  COALESCE((
    SELECT s."contactConsentState"
    FROM "states" s
    WHERE s."tenantId" = a."tenantId"
  ), '{}'::jsonb),
  true
);