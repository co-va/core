WITH latest_contact_consent AS (
  SELECT DISTINCT ON (e."tenantId", e."contactValue", e."documentId")
    e."tenantId",
    e."contactValue",
    e."documentId",
    e."documentVersion",
    e."status"
  FROM "TenantConsentEvent" e
  WHERE e."subjectType" = 'CONTACT_POINT'
    AND e."contactType" = 'PHONE'
    AND e."documentId" IN ('pdn-consent', 'messages-consent')
  ORDER BY e."tenantId", e."contactValue", e."documentId", e."occurredAt" DESC, e."createdAt" DESC, e."id" DESC
), current_document_versions AS (
  SELECT
    a."tenantId",
    d.value->>'id' AS "documentId",
    GREATEST(1, COALESCE(NULLIF(d.value->>'version', '')::integer, 1)) AS "documentVersion"
  FROM "TenantDocumentArchive" a
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.data->'documents', '[]'::jsonb)) AS d(value)
  WHERE d.value->>'id' IN ('pdn-consent', 'messages-consent')
), current_contact_consent AS (
  SELECT
    e."tenantId",
    e."contactValue",
    COALESCE(bool_or(
      e."documentId" = 'pdn-consent'
      AND e."status" = 'accepted'
      AND e."documentVersion" = COALESCE(d."documentVersion", e."documentVersion")
    ), false) AS "pdnActive",
    COALESCE(bool_or(
      e."documentId" = 'messages-consent'
      AND e."status" = 'accepted'
      AND e."documentVersion" = COALESCE(d."documentVersion", e."documentVersion")
    ), false) AS "marketingActive"
  FROM latest_contact_consent e
  LEFT JOIN current_document_versions d
    ON d."tenantId" = e."tenantId"
   AND d."documentId" = e."documentId"
  GROUP BY e."tenantId", e."contactValue"
), person_contact_consent AS (
  SELECT
    p.id AS "personId",
    c."pdnActive",
    c."marketingActive"
  FROM "Person" p
  JOIN current_contact_consent c ON c."tenantId" = p."tenantId"
  WHERE regexp_replace(COALESCE(p.data->>'phone', ''), '[^0-9]', '', 'g') = c."contactValue"
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements_text(COALESCE(p.data->'phones', '[]'::jsonb)) AS phone(value)
       WHERE regexp_replace(phone.value, '[^0-9]', '', 'g') = c."contactValue"
     )
)
UPDATE "Person" p
SET data = jsonb_set(
  jsonb_set(
    jsonb_set(
      COALESCE(p.data, '{}'::jsonb),
      '{consentState}',
      COALESCE(p.data->'consentState', '{}'::jsonb),
      true
    ),
    '{consentState,pdnActive}',
    to_jsonb(c."pdnActive"),
    true
  ),
  '{consentState,marketingActive}',
  to_jsonb(c."marketingActive"),
  true
)
FROM person_contact_consent c
WHERE p.id = c."personId";
