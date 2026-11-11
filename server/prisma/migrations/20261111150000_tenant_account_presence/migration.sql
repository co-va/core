-- Presence belongs to an authenticated tenant membership, not login history.
CREATE TABLE "TenantAccountPresence" (
  "tenantId" TEXT NOT NULL,
  "platformAccountId" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantAccountPresence_pkey" PRIMARY KEY ("tenantId", "platformAccountId")
);

ALTER TABLE "TenantAccountPresence"
  ADD CONSTRAINT "TenantAccountPresence_tenantId_platformAccountId_fkey"
  FOREIGN KEY ("tenantId", "platformAccountId")
  REFERENCES "Membership"("tenantId", "platformAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;
