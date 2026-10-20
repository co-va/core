CREATE TABLE "DataTransferFact" (
  "id" TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
  "domain" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "input" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "DataTransferFact_tenantId_domain_sourceKey_key" ON "DataTransferFact"("tenantId", "domain", "sourceKey");
CREATE INDEX "DataTransferFact_tenantId_domain_targetId_idx" ON "DataTransferFact"("tenantId", "domain", "targetId");
ALTER TABLE "BusinessHistoryEvent" ADD COLUMN "provenance" JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE OR REPLACE FUNCTION "professional_history_write"(
  tenant_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  event_type TEXT,
  event_status TEXT,
  effective_at TIMESTAMP,
  occurred_at TIMESTAMP,
  source_type TEXT,
  source_id TEXT,
  person_key TEXT DEFAULT '',
  record_id TEXT DEFAULT '',
  workplace_key TEXT DEFAULT '',
  procedure_id TEXT DEFAULT '',
  document_id TEXT DEFAULT '',
  inventory_item_id TEXT DEFAULT '',
  finance_operation_id TEXT DEFAULT '',
  relation_data JSONB DEFAULT '{}'::jsonb,
  event_data JSONB DEFAULT '{}'::jsonb,
  fixed_event_id TEXT DEFAULT ''
)
RETURNS VOID AS $$
BEGIN
  IF COALESCE(tenant_id, '') = '' OR COALESCE(entity_type, '') = '' OR COALESCE(entity_id, '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = tenant_id) THEN
    RETURN;
  END IF;

  INSERT INTO "BusinessHistoryEvent" (
    "tenantId", "eventId", "entityType", "entityId", "eventType", "status",
    "personKey", "recordId", "workplaceKey", "procedureId", "documentId",
    "inventoryItemId", "financeOperationId", "sourceType", "sourceId",
    "effectiveAt", "occurredAt", "relations", "data", "provenance"
  ) VALUES (
    tenant_id,
    COALESCE(NULLIF(fixed_event_id, ''), "professional_history_event_id"(entity_type || ':' || entity_id || ':' || event_type)),
    entity_type,
    entity_id,
    event_type,
    COALESCE(NULLIF(event_status, ''), 'active'),
    COALESCE(person_key, ''),
    COALESCE(record_id, ''),
    COALESCE(workplace_key, ''),
    COALESCE(procedure_id, ''),
    COALESCE(document_id, ''),
    COALESCE(inventory_item_id, ''),
    COALESCE(finance_operation_id, ''),
    COALESCE(source_type, ''),
    COALESCE(source_id, ''),
    COALESCE(NULLIF(current_setting('co_va.transfer_time', true), '')::timestamp, effective_at, occurred_at, CURRENT_TIMESTAMP),
    COALESCE(NULLIF(current_setting('co_va.transfer_time', true), '')::timestamp, occurred_at, CURRENT_TIMESTAMP),
    COALESCE(relation_data, '{}'::jsonb),
    COALESCE(event_data, '{}'::jsonb),
    COALESCE(NULLIF(current_setting('co_va.transfer_provenance', true), '')::jsonb, '{}'::jsonb)
  )
  ON CONFLICT ("tenantId", "eventId") DO NOTHING;
END;
$$ LANGUAGE plpgsql;


ALTER TABLE "InventoryLot" ADD COLUMN "costKnown" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InventoryMovementLine" ADD COLUMN "costKnown" BOOLEAN NOT NULL DEFAULT true;
