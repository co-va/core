-- Service's two existing modes are functional and awaiting verification.
-- Do not leave either mode at NOT_READY merely because it was split from
-- the former Service entry. Never demote a mode already marked READY.
-- Separate follow-up migration: preserve the checksum of the earlier migration
-- that may already have been applied in staging.
INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
VALUES
  ('cabinet.service.procedures', 'TESTING', true, CURRENT_TIMESTAMP),
  ('cabinet.service.products', 'TESTING', true, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE
  SET "status" = 'TESTING',
      "enforced" = true,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "AdminToolReadiness"."status" = 'NOT_READY';
