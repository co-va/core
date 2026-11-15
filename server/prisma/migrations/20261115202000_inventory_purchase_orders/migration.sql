-- Orders are commitments, not inventory movements. The latter are posted
-- exactly once when a paid order is received.
CREATE TABLE "InventoryPurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'formed',
    "supplier" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "financeOperationId" TEXT NOT NULL DEFAULT '',
    "receiptMovementId" TEXT NOT NULL DEFAULT '',
    "paidAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryPurchaseOrder_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InventoryPurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL,
    "packageSize" DECIMAL(14,3) NOT NULL,
    "packages" INTEGER NOT NULL,
    "packPrice" DECIMAL(14,4) NOT NULL,
    "offerId" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InventoryPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InventoryPurchaseOrder_tenantId_orderId_key"
ON "InventoryPurchaseOrder"("tenantId","orderId");
CREATE INDEX "InventoryPurchaseOrder_tenantId_status_createdAt_idx"
ON "InventoryPurchaseOrder"("tenantId","status","createdAt");
CREATE INDEX "InventoryPurchaseOrderLine_tenantId_purchaseOrderId_position_idx"
ON "InventoryPurchaseOrderLine"("tenantId","purchaseOrderId","position");
ALTER TABLE "InventoryPurchaseOrderLine" ADD CONSTRAINT
"InventoryPurchaseOrderLine_purchaseOrderId_fkey"
FOREIGN KEY ("purchaseOrderId") REFERENCES "InventoryPurchaseOrder"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
