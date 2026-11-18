-- Agreement discount is owned by the tenant's supplier relationship.
-- Do not copy or overwrite the user's stock prices, historical receipts or existing offers.
ALTER TABLE "InventoryCounterparty"
  ADD COLUMN "discountPercent" DECIMAL(7,4);

-- Existing manually entered offer prices remain authoritative until their
-- supplier agreement is explicitly configured; no historic values are erased.
ALTER TABLE "InventorySupplierOffer"
  ADD COLUMN "agreementPriced" BOOLEAN NOT NULL DEFAULT false;
