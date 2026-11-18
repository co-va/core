-- Additive supplier claims: an unpaid refund is NOT a wallet balance.
CREATE TABLE "InventorySupplierClaim" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "packages" INTEGER NOT NULL,
  "packPrice" DECIMAL(14,4) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "settledAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL DEFAULT '',
  "movementId" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventorySupplierClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventorySupplierClaim_tenantId_claimId_key" ON "InventorySupplierClaim"("tenantId","claimId");
CREATE INDEX "InventorySupplierClaim_tenantId_orderId_idx" ON "InventorySupplierClaim"("tenantId","orderId");
CREATE INDEX "InventorySupplierClaim_tenantId_itemId_idx" ON "InventorySupplierClaim"("tenantId","itemId");
CREATE TABLE "InventorySupplierClaimSettlement" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "walletId" TEXT NOT NULL DEFAULT '',
  "walletName" TEXT NOT NULL DEFAULT '',
  "financeOperationId" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InventorySupplierClaimSettlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventorySupplierClaimSettlement_tenantId_settlementId_key" ON "InventorySupplierClaimSettlement"("tenantId","settlementId");
CREATE INDEX "InventorySupplierClaimSettlement_tenantId_claimId_idx" ON "InventorySupplierClaimSettlement"("tenantId","claimId");
