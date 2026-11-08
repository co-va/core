-- Cash is one E-card with three independently controlled composition items.
-- Retain the existing Cash readiness for the wallet tool; do not change it
-- or the stored entitlement. Loan and Investment start NOT_READY until the
-- platform administrator explicitly checks and enables them.
INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
SELECT 'cabinet.finance.cash.wallets', "status", "enforced", CURRENT_TIMESTAMP
FROM "AdminToolReadiness"
WHERE "key" = 'cabinet.finance.cash'
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "AdminToolReadiness" ("key", "status", "enforced", "updatedAt")
VALUES
  ('cabinet.finance.cash.loans', 'NOT_READY', false, CURRENT_TIMESTAMP),
  ('cabinet.finance.cash.investments', 'NOT_READY', false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
