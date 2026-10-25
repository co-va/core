-- Manual self-employed payment completion: keep the tax receipt attached to the commercial order.
ALTER TABLE "CommercialOrder"
  ADD COLUMN "receiptUrl" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "receiptSentAt" TIMESTAMP(3),
  ADD COLUMN "receiptSentTo" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "receiptMessageId" TEXT NOT NULL DEFAULT '';

CREATE INDEX "CommercialOrder_tenantId_status_createdAt_idx"
  ON "CommercialOrder"("tenantId", "status", "createdAt");
