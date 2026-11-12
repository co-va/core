-- A Profile or Contacts screen in User is one F card with one readiness state.
-- Existing split checks remain in the database as historical evidence, not live UI nodes.
-- A single READY status is assigned only if every previous check was READY.
WITH legacy AS (
  SELECT "key", "status", "enforced"
  FROM "AdminToolReadiness"
  WHERE "key" IN (
    'records.profile.personal-data',
    'records.profile.documents-notifications',
    'records.contacts.list',
    'records.contacts.card'
  )
),
rollup AS (
  SELECT CASE WHEN "key" LIKE 'records.profile.%' THEN 'records.profile'
              ELSE 'records.contacts' END AS "newKey",
         COUNT(*) AS "count",
         COUNT(*) FILTER (WHERE "status" = 'READY') AS "readyCount",
         COUNT(*) FILTER (WHERE "status" = 'NOT_READY') AS "notReadyCount",
         BOOL_OR("enforced") AS "wasEnforced"
  FROM legacy
  GROUP BY 1
)
INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
SELECT "newKey",
       CASE WHEN "count" = 2 AND "readyCount" = 2 THEN 'READY'
            WHEN "notReadyCount" > 0 THEN 'NOT_READY'
            ELSE 'TESTING' END,
       "wasEnforced", CURRENT_TIMESTAMP
FROM rollup
ON CONFLICT ("key") DO NOTHING;
