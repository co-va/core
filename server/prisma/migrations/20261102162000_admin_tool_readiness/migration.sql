CREATE TABLE "AdminToolReadiness" (
  "key" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'NOT_READY',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminToolReadiness_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "AdminToolReadiness_status_check" CHECK ("status" IN ('NOT_READY', 'TESTING', 'READY'))
);

-- Preserve the readiness values that existed before technical readiness was separated from commerce.
INSERT INTO "AdminToolReadiness" ("key", "status", "updatedAt")
SELECT mapping."readinessKey", product."readiness", CURRENT_TIMESTAMP
FROM (VALUES
  ('cabinet.people', 'tool.people'),
  ('cabinet.journal.day', 'tool.journal'),
  ('cabinet.journal.month', 'tool.journal'),
  ('cabinet.journal.list', 'tool.journal'),
  ('cabinet.timetable', 'tool.timetable'),
  ('cabinet.profile.data', 'system.profile'),
  ('cabinet.profile.workspaces', 'system.profile'),
  ('cabinet.service', 'tool.services'),
  ('cabinet.loyalty.deposit', 'tool.loyalty.deposit'),
  ('cabinet.loyalty.personal-account', 'tool.loyalty.personal-account'),
  ('cabinet.loyalty.certificate', 'tool.loyalty.certificate'),
  ('cabinet.loyalty.subscription', 'tool.loyalty.subscription'),
  ('cabinet.loyalty.referral', 'tool.loyalty.referral'),
  ('cabinet.loyalty.bonus', 'tool.loyalty.bonus'),
  ('cabinet.finance.cash', 'tool.finance.cash'),
  ('cabinet.finance.dds', 'tool.finance.dds'),
  ('cabinet.finance.z-report', 'tool.finance.z-report'),
  ('cabinet.inventory.stock', 'tool.inventory.stock'),
  ('cabinet.inventory.movements', 'tool.inventory.movements'),
  ('cabinet.inventory.order', 'tool.inventory.order'),
  ('cabinet.inventory.stocktake', 'tool.inventory.stocktake'),
  ('cabinet.settings.data-transfer', 'tool.data-transfer'),
  ('cabinet.settings.online-booking', 'tool.online-booking'),
  ('cabinet.settings.notifications', 'tool.notifications'),
  ('cabinet.settings.integrations', 'tool.integrations'),
  ('cabinet.settings.documents', 'tool.documents'),
  ('cabinet.settings.tags', 'tool.tags'),
  ('records.profile.personal-data', 'user.profile'),
  ('records.profile.documents-notifications', 'user.profile'),
  ('records.journal.day', 'user.journal'),
  ('records.journal.month', 'user.journal'),
  ('records.journal.list', 'user.journal'),
  ('records.contacts.list', 'user.contacts'),
  ('records.contacts.card', 'user.contacts'),
  ('records.integrations.google-calendar', 'user.integrations'),
  ('records.integrations.yandex-calendar', 'user.integrations')
) AS mapping("readinessKey", "productKey")
JOIN "CommercialProduct" product ON product."key" = mapping."productKey"
ON CONFLICT ("key") DO NOTHING;
