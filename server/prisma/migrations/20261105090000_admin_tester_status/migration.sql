-- All existing and newly registered spaces start as ordinary users.
-- Tester status is assigned explicitly by the platform administrator.
ALTER TABLE "TenantAccess" ADD COLUMN "isTester" BOOLEAN NOT NULL DEFAULT false;
