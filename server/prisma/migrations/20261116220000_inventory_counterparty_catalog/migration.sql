-- New supplier catalog is separate from stock and old purchase documents.
CREATE TABLE "InventoryCounterparty" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'SUPPLIER', "contactName" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '', "email" TEXT NOT NULL DEFAULT '', "website" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '', "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "InventoryCounterparty_tenantId_archivedAt_name_idx" ON "InventoryCounterparty"("tenantId","archivedAt","name");
ALTER TABLE "InventoryCounterparty" ADD CONSTRAINT "InventoryCounterparty_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InventoryCounterpartyPriceList" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "counterpartyId" TEXT NOT NULL, "revision" INTEGER NOT NULL, "filename" TEXT NOT NULL,
  "format" TEXT NOT NULL, "sha256" TEXT NOT NULL, "parserStatus" TEXT NOT NULL DEFAULT 'READY', "sourceFile" BYTEA NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "InventoryCounterpartyPriceList_tenantId_counterpartyId_revision_key" ON "InventoryCounterpartyPriceList"("tenantId","counterpartyId","revision");
CREATE INDEX "InventoryCounterpartyPriceList_tenantId_counterpartyId_createdAt_idx" ON "InventoryCounterpartyPriceList"("tenantId","counterpartyId","createdAt");
ALTER TABLE "InventoryCounterpartyPriceList" ADD CONSTRAINT "InventoryCounterpartyPriceList_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "InventoryCounterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "InventoryCounterpartyCatalogItem" ("id" TEXT NOT NULL PRIMARY KEY, "tenantId" TEXT NOT NULL,
  "priceListId" TEXT NOT NULL, "position" INTEGER NOT NULL,
  "supplierSku" TEXT NOT NULL DEFAULT '', "name" TEXT NOT NULL, "manufacturer" TEXT NOT NULL DEFAULT '',
  "barcode" TEXT NOT NULL DEFAULT '', "unit" TEXT NOT NULL DEFAULT '',
  "packageQuantity" DECIMAL(14,3), "listPrice" DECIMAL(14,4),
  "actualPrice" DECIMAL(14,4), "discountPercent" DECIMAL(7,4),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX "InventoryCounterpartyCatalogItem_tenantId_priceListId_position_idx" ON "InventoryCounterpartyCatalogItem"("tenantId","priceListId","position");
CREATE INDEX "InventoryCounterpartyCatalogItem_tenantId_supplierSku_idx" ON "InventoryCounterpartyCatalogItem"("tenantId","supplierSku");
ALTER TABLE "InventoryCounterpartyCatalogItem" ADD CONSTRAINT "InventoryCounterpartyCatalogItem_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "InventoryCounterpartyPriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventorySupplierOffer" ADD COLUMN "counterpartyId" TEXT, ADD COLUMN "catalogItemId" TEXT;

INSERT INTO "Capability" ("id","key","groupKey","name","description","valueType","defaultEnabled","defaultLimit","position","isActive","createdAt","updatedAt")
VALUES ('inventory_counterparties_access','inventory.counterparties.access','inventory','Склад · Контрагенты','Поставщики и прайс-листы','BOOLEAN',false,NULL,205,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "AdminToolReadiness" ("key","status","enforced","updatedAt")
VALUES ('cabinet.inventory.counterparties','NOT_READY',false,CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
