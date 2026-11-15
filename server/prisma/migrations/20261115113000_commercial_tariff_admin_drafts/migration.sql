-- Persist administrator tariff editor state separately from public sale terms.
-- Existing subscriptions, CommercialOrder snapshots, products and access remain untouched.
CREATE TABLE "CommercialTariffDraft" (
  "tariffKey" TEXT NOT NULL,
  "configuration" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialTariffDraft_pkey" PRIMARY KEY ("tariffKey"),
  CONSTRAINT "CommercialTariffDraft_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "CommercialTariffDraft_tariff_fkey" FOREIGN KEY ("tariffKey")
    REFERENCES "CommercialProduct"("key") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommercialTariffDraft_admin_fkey" FOREIGN KEY ("updatedByAdminId")
    REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
