-- The Service tool has two existing Professional modes. Preserve the previous
-- single Service readiness status for BOTH child modes on upgrade. The
-- previous row remains for compatibility with older deployed versions.
-- No commercial entitlements or existing service data are modified.
INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
SELECT mode."key", previous."status", previous."enforced", CURRENT_TIMESTAMP
FROM "AdminToolReadiness" previous
CROSS JOIN (VALUES
  ('cabinet.service.procedures'),
  ('cabinet.service.products')
) AS mode("key")
WHERE previous."key" = 'cabinet.service'
ON CONFLICT ("key") DO NOTHING;

-- For databases without an older Service row, both modes start unavailable.
INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
VALUES
  ('cabinet.service.procedures', 'NOT_READY', false, CURRENT_TIMESTAMP),
  ('cabinet.service.products', 'NOT_READY', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
