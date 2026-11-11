-- Extend the single canonical membership heartbeat into cumulative and daily aggregates.
ALTER TABLE "TenantAccountPresence"
  ADD COLUMN "totalOnlineMs" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "TenantAccountPresenceDay" (
  "tenantId" TEXT NOT NULL,
  "platformAccountId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "onlineMs" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "TenantAccountPresenceDay_pkey" PRIMARY KEY ("tenantId", "platformAccountId", "day")
);

CREATE INDEX "TenantAccountPresenceDay_day_idx" ON "TenantAccountPresenceDay"("day");

ALTER TABLE "TenantAccountPresenceDay"
  ADD CONSTRAINT "TenantAccountPresenceDay_tenantId_platformAccountId_fkey"
  FOREIGN KEY ("tenantId", "platformAccountId")
  REFERENCES "TenantAccountPresence"("tenantId", "platformAccountId")
  ON DELETE CASCADE ON UPDATE CASCADE;
