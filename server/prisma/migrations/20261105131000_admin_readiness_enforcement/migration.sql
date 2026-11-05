-- Existing readiness markers remain descriptive until resaved.
-- This avoids cutting off active users when original NOT_READY defaults are present.
ALTER TABLE "AdminToolReadiness" ADD COLUMN "enforced" BOOLEAN NOT NULL DEFAULT false;
