-- Published tariff terms are distinct from editable administrator drafts.
-- They determine future offers only. Existing paid order snapshots remain immutable.
CREATE TABLE "CommercialTariffPublishedTerms" (
  "tariffKey" TEXT NOT NULL,
  "configuration" JSONB NOT NULL,
  "publishedDraftRevision" INTEGER NOT NULL,
  "publishedByAdminId" TEXT,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CommercialTariffPublishedTerms_pkey" PRIMARY KEY ("tariffKey"),
  CONSTRAINT "CommercialTariffPublishedTerms_tariff_fkey" FOREIGN KEY ("tariffKey")
    REFERENCES "CommercialProduct"("key") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CommercialTariffPublishedTerms_admin_fkey" FOREIGN KEY ("publishedByAdminId")
    REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
