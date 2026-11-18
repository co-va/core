-- Agreement discount is owned by the tenant's supplier relationship.
-- Do not copy or overwrite the user's stock prices, historical receipts or existing offers.
ALTER TABLE "InventoryCounterparty"
  ADD COLUMN "discountPercent" DECIMAL(7,4);
