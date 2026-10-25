-- Keep delivery metadata for PDF/image receipts sent with a commercial LIVE order.
ALTER TABLE "CommercialOrder"
  ADD COLUMN "receiptKind" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "receiptFileName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "receiptMimeType" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "receiptFileSha256" TEXT NOT NULL DEFAULT '';
