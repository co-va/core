BEGIN;

CREATE TABLE IF NOT EXISTS "BusinessHistoryEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "personKey" TEXT NOT NULL DEFAULT '',
  "recordId" TEXT NOT NULL DEFAULT '',
  "workplaceKey" TEXT NOT NULL DEFAULT '',
  "procedureId" TEXT NOT NULL DEFAULT '',
  "documentId" TEXT NOT NULL DEFAULT '',
  "inventoryItemId" TEXT NOT NULL DEFAULT '',
  "financeOperationId" TEXT NOT NULL DEFAULT '',
  "sourceType" TEXT NOT NULL DEFAULT '',
  "sourceId" TEXT NOT NULL DEFAULT '',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "relations" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "BusinessHistoryEvent_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_event_key"
ON "BusinessHistoryEvent"("tenantId", "eventId");

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_occurred_idx"
ON "BusinessHistoryEvent"("tenantId", "occurredAt" DESC, "id" DESC);

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_entity_idx"
ON "BusinessHistoryEvent"("tenantId", "entityType", "entityId", "effectiveAt" DESC);

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_person_idx"
ON "BusinessHistoryEvent"("tenantId", "personKey", "occurredAt" DESC)
WHERE "personKey" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_record_idx"
ON "BusinessHistoryEvent"("tenantId", "recordId", "occurredAt" DESC)
WHERE "recordId" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_procedure_idx"
ON "BusinessHistoryEvent"("tenantId", "procedureId", "effectiveAt" DESC)
WHERE "procedureId" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_document_idx"
ON "BusinessHistoryEvent"("tenantId", "documentId", "occurredAt" DESC)
WHERE "documentId" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_inventory_item_idx"
ON "BusinessHistoryEvent"("tenantId", "inventoryItemId", "occurredAt" DESC)
WHERE "inventoryItemId" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_tenant_finance_operation_idx"
ON "BusinessHistoryEvent"("tenantId", "financeOperationId", "occurredAt" DESC)
WHERE "financeOperationId" <> '';

CREATE INDEX IF NOT EXISTS "BusinessHistoryEvent_relations_gin_idx"
ON "BusinessHistoryEvent" USING GIN ("relations");

CREATE OR REPLACE FUNCTION "professional_history_event_id"(prefix TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(NULLIF(prefix, ''), 'event') || ':' ||
    md5(random()::text || clock_timestamp()::text || txid_current()::text);
$$ LANGUAGE SQL VOLATILE;

CREATE OR REPLACE FUNCTION "professional_history_timestamp"(value TEXT, fallback_value TIMESTAMP)
RETURNS TIMESTAMP AS $$
DECLARE
  parsed TIMESTAMP;
BEGIN
  IF value IS NULL OR btrim(value) = '' THEN
    RETURN COALESCE(fallback_value, CURRENT_TIMESTAMP);
  END IF;
  BEGIN
    parsed := value::timestamptz AT TIME ZONE 'UTC';
    RETURN parsed;
  EXCEPTION WHEN OTHERS THEN
    RETURN COALESCE(fallback_value, CURRENT_TIMESTAMP);
  END;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "professional_history_record_person_key"(tenant_id TEXT, record_id TEXT)
RETURNS TEXT AS $$
  SELECT COALESCE(r."data" #>> '{person,key}', '')
  FROM "BusinessRecord" r
  WHERE r."tenantId" = tenant_id AND r."recordId" = record_id
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION "professional_history_consent_person_key"(
  tenant_id TEXT,
  subject_type TEXT,
  subject_key TEXT,
  contact_type TEXT,
  contact_value TEXT
)
RETURNS TEXT AS $$
  SELECT p."key"
  FROM "Person" p
  WHERE p."tenantId" = tenant_id
    AND (
      (subject_type = 'ACCOUNT' AND COALESCE(p."data"->'accounts', '[]'::jsonb) ? subject_key)
      OR (subject_type = 'CONTACT_POINT' AND contact_type = 'PHONE'
          AND COALESCE(p."data"->'phones', '[]'::jsonb) ? contact_value)
      OR (subject_type = 'CONTACT_POINT' AND contact_type = 'EMAIL'
          AND COALESCE(p."data"->'emails', '[]'::jsonb) ? contact_value)
      OR (subject_type = 'CONTACT_POINT' AND contact_type = 'TELEGRAM'
          AND COALESCE(p."data"->'telegrams', '[]'::jsonb) ? contact_value)
    )
  ORDER BY p."createdAt" ASC
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

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
    "effectiveAt", "occurredAt", "relations", "data"
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
    COALESCE(effective_at, occurred_at, CURRENT_TIMESTAMP),
    COALESCE(occurred_at, CURRENT_TIMESTAMP),
    COALESCE(relation_data, '{}'::jsonb),
    COALESCE(event_data, '{}'::jsonb)
  )
  ON CONFLICT ("tenantId", "eventId") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "professional_history_person_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  entity_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  entity_id := COALESCE(row_data->>'key', '');
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'person', entity_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'person', entity_id,
    entity_id, '', '', '', '', '', '',
    jsonb_build_object('person', entity_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_person" ON "Person";
CREATE TRIGGER "BusinessHistory_person"
AFTER INSERT OR UPDATE OR DELETE ON "Person"
FOR EACH ROW EXECUTE FUNCTION "professional_history_person_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_record_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  payload JSONB;
  tenant_id TEXT;
  entity_id TEXT;
  person_key TEXT;
  workplace_key TEXT;
  moment TIMESTAMP;
  procedure_ids JSONB;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  payload := COALESCE(row_data->'data', '{}'::jsonb);
  tenant_id := COALESCE(row_data->>'tenantId', '');
  entity_id := COALESCE(row_data->>'recordId', '');
  person_key := COALESCE(payload #>> '{person,key}', '');
  workplace_key := COALESCE(payload->>'workplaceId', '');
  moment := "professional_history_timestamp"(
    COALESCE(payload->>'updatedAt', payload->>'createdAt'),
    CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END
  );
  SELECT COALESCE(jsonb_agg(value->>'id') FILTER (WHERE COALESCE(value->>'id', '') <> ''), '[]'::jsonb)
  INTO procedure_ids
  FROM jsonb_array_elements(COALESCE(payload->'procedures', '[]'::jsonb));

  PERFORM "professional_history_write"(
    tenant_id, 'record', entity_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'record', entity_id,
    person_key, entity_id, workplace_key, '', '', '', '',
    jsonb_build_object('person', person_key, 'record', entity_id, 'workplace', workplace_key, 'procedures', procedure_ids),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', OLD."data", 'after', NEW."data")
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', OLD."data")
      ELSE jsonb_build_object('current', NEW."data")
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_record" ON "BusinessRecord";
CREATE TRIGGER "BusinessHistory_record"
AFTER INSERT OR UPDATE OR DELETE ON "BusinessRecord"
FOR EACH ROW EXECUTE FUNCTION "professional_history_record_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_record_event_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  payload JSONB;
  tenant_id TEXT;
  event_id TEXT;
  record_id TEXT;
  person_key TEXT;
  event_type TEXT;
  moment TIMESTAMP;
  appointment JSONB;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  payload := COALESCE(row_data->'data', '{}'::jsonb);
  tenant_id := COALESCE(row_data->>'tenantId', '');
  event_id := COALESCE(row_data->>'eventId', '');
  record_id := COALESCE(row_data->>'recordId', '');
  person_key := COALESCE(payload #>> '{subject,personKey}', "professional_history_record_person_key"(tenant_id, record_id), '');
  event_type := COALESCE(payload->>'type', lower(TG_OP));
  moment := "professional_history_timestamp"(payload->>'at',
    CASE WHEN TG_OP = 'DELETE' THEN OLD."createdAt" ELSE NEW."createdAt" END);
  appointment := COALESCE(payload #> '{payload,appointment}', '{}'::jsonb);

  PERFORM "professional_history_write"(
    tenant_id, 'record-event', event_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE event_type END,
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'record', record_id,
    person_key, record_id, COALESCE(appointment->>'workplaceId', ''), '', '', '', '',
    jsonb_build_object('person', person_key, 'record', record_id, 'recordEvent', event_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', OLD."data", 'after', NEW."data")
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', OLD."data")
      ELSE jsonb_build_object('current', NEW."data")
    END,
    CASE WHEN TG_OP = 'INSERT' THEN 'record-event:' || event_id ELSE '' END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_record_event" ON "BusinessRecordEvent";
CREATE TRIGGER "BusinessHistory_record_event"
AFTER INSERT OR UPDATE OR DELETE ON "BusinessRecordEvent"
FOR EACH ROW EXECUTE FUNCTION "professional_history_record_event_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_finance_operation_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  payload JSONB;
  tenant_id TEXT;
  operation_id TEXT;
  source_type TEXT;
  source_id TEXT;
  record_id TEXT;
  person_key TEXT;
  moment TIMESTAMP;
  kind TEXT;
  status_value TEXT;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  payload := COALESCE(row_data->'data', '{}'::jsonb);
  tenant_id := COALESCE(row_data->>'tenantId', '');
  operation_id := COALESCE(row_data->>'operationId', '');
  source_type := COALESCE(row_data->>'sourceType', '');
  source_id := COALESCE(row_data->>'sourceId', '');
  record_id := CASE WHEN lower(source_type) = 'record' THEN source_id ELSE '' END;
  person_key := COALESCE(payload #>> '{person,key}', '');
  IF person_key = '' AND record_id <> '' THEN
    person_key := COALESCE("professional_history_record_person_key"(tenant_id, record_id), '');
  END IF;
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."occurredAt" ELSE NEW."occurredAt" END;
  kind := COALESCE(row_data->>'kind', 'finance-operation');
  status_value := CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(row_data->>'status', 'active') END;

  PERFORM "professional_history_write"(
    tenant_id, 'finance-operation', operation_id,
    CASE WHEN TG_OP = 'INSERT' THEN kind ELSE lower(TG_OP) END,
    status_value,
    moment, moment, source_type, source_id,
    person_key, record_id, COALESCE(payload->>'workplace', ''), '', '', '', operation_id,
    jsonb_build_object('person', person_key, 'record', record_id, 'financeOperation', operation_id, 'sourceType', source_type, 'sourceId', source_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END,
    CASE WHEN TG_OP = 'INSERT' THEN 'finance-operation:' || operation_id ELSE '' END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_finance_operation" ON "FinanceOperation";
CREATE TRIGGER "BusinessHistory_finance_operation"
AFTER INSERT OR UPDATE OR DELETE ON "FinanceOperation"
FOR EACH ROW EXECUTE FUNCTION "professional_history_finance_operation_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_finance_settlement_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  source_type TEXT;
  source_id TEXT;
  record_id TEXT;
  person_key TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  source_type := COALESCE(row_data->>'sourceType', '');
  source_id := COALESCE(row_data->>'sourceId', '');
  record_id := CASE WHEN lower(source_type) = 'record' THEN source_id ELSE '' END;
  person_key := CASE WHEN record_id <> '' THEN COALESCE("professional_history_record_person_key"(tenant_id, record_id), '') ELSE '' END;
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'finance-settlement', source_type || ':' || source_id,
    lower(TG_OP), CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, source_type, source_id,
    person_key, record_id, '', '', '', '', '',
    jsonb_build_object('person', person_key, 'record', record_id, 'sourceType', source_type, 'sourceId', source_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', OLD."data", 'after', NEW."data")
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', OLD."data")
      ELSE jsonb_build_object('current', NEW."data")
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_finance_settlement" ON "FinanceSettlement";
CREATE TRIGGER "BusinessHistory_finance_settlement"
AFTER INSERT OR UPDATE OR DELETE ON "FinanceSettlement"
FOR EACH ROW EXECUTE FUNCTION "professional_history_finance_settlement_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_finance_ledger_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  entry_id TEXT;
  source_type TEXT;
  source_id TEXT;
  record_id TEXT;
  person_key TEXT;
  operation_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  entry_id := COALESCE(row_data->>'entryId', '');
  source_type := COALESCE(row_data->>'sourceType', '');
  source_id := COALESCE(row_data->>'sourceId', '');
  record_id := CASE WHEN lower(source_type) = 'record' THEN source_id ELSE '' END;
  person_key := CASE WHEN record_id <> '' THEN COALESCE("professional_history_record_person_key"(tenant_id, record_id), '') ELSE '' END;
  SELECT COALESCE("operationId", '') INTO operation_id
  FROM "FinanceOperation"
  WHERE "id" = COALESCE((row_data->>'financeOperationId'), '')
  LIMIT 1;
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."occurredAt" ELSE NEW."occurredAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'finance-ledger-entry', entry_id,
    lower(TG_OP), CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, source_type, source_id,
    person_key, record_id, '', '', '', '', COALESCE(operation_id, ''),
    jsonb_build_object('person', person_key, 'record', record_id, 'financeOperation', COALESCE(operation_id, ''), 'ledgerEntry', entry_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_finance_ledger" ON "FinanceLedgerEntry";
CREATE TRIGGER "BusinessHistory_finance_ledger"
AFTER INSERT OR UPDATE OR DELETE ON "FinanceLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION "professional_history_finance_ledger_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_inventory_item_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  item_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  item_id := COALESCE(row_data->>'itemId', '');
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'inventory-item', item_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'inventory-item', item_id,
    '', '', '', '', '', item_id, '',
    jsonb_build_object('inventoryItem', item_id),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_inventory_item" ON "InventoryItem";
CREATE TRIGGER "BusinessHistory_inventory_item"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION "professional_history_inventory_item_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_inventory_movement_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  movement_id TEXT;
  item_person TEXT;
  record_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  movement_id := COALESCE(row_data->>'movementId', '');
  item_person := COALESCE(row_data->>'personKey', '');
  record_id := COALESCE(row_data->>'recordId', '');
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."occurredAt" ELSE NEW."occurredAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'inventory-movement', movement_id,
    CASE WHEN TG_OP = 'INSERT' THEN lower(COALESCE(row_data->>'kind', 'movement')) ELSE lower(TG_OP) END,
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(row_data->>'status', 'active') END,
    moment, moment, COALESCE(row_data->>'sourceType', 'inventory'), COALESCE(row_data->>'sourceId', movement_id),
    item_person, record_id, COALESCE(row_data->>'workplaceKey', ''), COALESCE(row_data->>'procedureKey', ''), '', '', '',
    jsonb_build_object(
      'person', item_person,
      'record', record_id,
      'workplace', COALESCE(row_data->>'workplaceKey', ''),
      'procedure', COALESCE(row_data->>'procedureKey', ''),
      'inventoryMovement', movement_id,
      'originalMovement', COALESCE(row_data->>'originalMovementId', '')
    ),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END,
    CASE WHEN TG_OP = 'INSERT' THEN 'inventory-movement:' || movement_id ELSE '' END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_inventory_movement" ON "InventoryMovement";
CREATE TRIGGER "BusinessHistory_inventory_movement"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryMovement"
FOR EACH ROW EXECUTE FUNCTION "professional_history_inventory_movement_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_inventory_line_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  line_id TEXT;
  item_id TEXT;
  movement_id TEXT;
  person_key TEXT;
  record_id TEXT;
  workplace_key TEXT;
  procedure_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  line_id := COALESCE(row_data->>'lineId', '');

  SELECT COALESCE(i."itemId", '') INTO item_id
  FROM "InventoryItem" i
  WHERE i."id" = COALESCE(row_data->>'inventoryItemId', '')
  LIMIT 1;

  SELECT COALESCE(m."movementId", ''), COALESCE(m."personKey", ''), COALESCE(m."recordId", ''),
         COALESCE(m."workplaceKey", ''), COALESCE(m."procedureKey", ''), m."occurredAt"
  INTO movement_id, person_key, record_id, workplace_key, procedure_id, moment
  FROM "InventoryMovement" m
  WHERE m."id" = COALESCE(row_data->>'inventoryMovementId', '')
  LIMIT 1;

  moment := COALESCE(moment, CASE WHEN TG_OP = 'DELETE' THEN OLD."createdAt" ELSE NEW."createdAt" END);

  PERFORM "professional_history_write"(
    tenant_id, 'inventory-movement-line', line_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'inventory-movement', COALESCE(movement_id, ''),
    COALESCE(person_key, ''), COALESCE(record_id, ''), COALESCE(workplace_key, ''), COALESCE(procedure_id, ''), '',
    COALESCE(item_id, ''), '',
    jsonb_build_object(
      'person', COALESCE(person_key, ''),
      'record', COALESCE(record_id, ''),
      'workplace', COALESCE(workplace_key, ''),
      'procedure', COALESCE(procedure_id, ''),
      'inventoryMovement', COALESCE(movement_id, ''),
      'inventoryItem', COALESCE(item_id, ''),
      'line', line_id
    ),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_inventory_line" ON "InventoryMovementLine";
CREATE TRIGGER "BusinessHistory_inventory_line"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryMovementLine"
FOR EACH ROW EXECUTE FUNCTION "professional_history_inventory_line_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_workplace_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  workplace_key TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  workplace_key := COALESCE(row_data->>'key', '');
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'workplace', workplace_key, lower(TG_OP),
    CASE
      WHEN TG_OP = 'DELETE' THEN 'deleted'
      WHEN COALESCE(row_data->>'deletedAt', '') <> '' THEN 'deleted'
      ELSE 'active'
    END,
    moment, moment, 'workplace', workplace_key,
    '', '', workplace_key, '', '', '', '',
    jsonb_build_object('workplace', workplace_key),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_workplace" ON "Workplace";
CREATE TRIGGER "BusinessHistory_workplace"
AFTER INSERT OR UPDATE OR DELETE ON "Workplace"
FOR EACH ROW EXECUTE FUNCTION "professional_history_workplace_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_auxiliary_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  moment := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;

  PERFORM "professional_history_write"(
    tenant_id, 'business-auxiliary-state', tenant_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'business-auxiliary-state', tenant_id,
    '', '', '', '', '', '', '',
    '{}'::jsonb,
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', OLD."data", 'after', NEW."data")
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', OLD."data")
      ELSE jsonb_build_object('current', NEW."data")
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_auxiliary" ON "BusinessAuxiliaryState";
CREATE TRIGGER "BusinessHistory_auxiliary"
AFTER INSERT OR UPDATE OR DELETE ON "BusinessAuxiliaryState"
FOR EACH ROW EXECUTE FUNCTION "professional_history_auxiliary_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_operational_trigger"()
RETURNS trigger AS $$
DECLARE
  old_data JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE COALESCE(OLD."data", '{}'::jsonb) END;
  new_data JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE COALESCE(NEW."data", '{}'::jsonb) END;
  old_procedures JSONB := COALESCE(old_data->'procedures', '[]'::jsonb);
  new_procedures JSONB := COALESCE(new_data->'procedures', '[]'::jsonb);
  procedure_row JSONB;
  old_procedure JSONB;
  tenant_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenantId" ELSE NEW."tenantId" END;
  moment TIMESTAMP := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;
  procedure_key TEXT;
  effective_moment TIMESTAMP;
BEGIN
  PERFORM "professional_history_write"(
    tenant_id, 'operational-state', tenant_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'operational-state', tenant_id,
    '', '', '', '', '', '', '',
    '{}'::jsonb,
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', old_data, 'after', new_data)
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', old_data)
      ELSE jsonb_build_object('current', new_data)
    END
  );

  FOR procedure_row IN SELECT value FROM jsonb_array_elements(new_procedures)
  LOOP
    procedure_key := COALESCE(procedure_row->>'id', '');
    IF procedure_key = '' THEN CONTINUE; END IF;
    SELECT value INTO old_procedure
    FROM jsonb_array_elements(old_procedures)
    WHERE value->>'id' = procedure_key
    LIMIT 1;

    IF old_procedure IS NULL OR old_procedure IS DISTINCT FROM procedure_row THEN
      effective_moment := "professional_history_timestamp"(
        COALESCE(procedure_row->>'updatedAt', procedure_row->>'createdAt'),
        moment
      );
      PERFORM "professional_history_write"(
        tenant_id, 'procedure', procedure_key,
        CASE WHEN old_procedure IS NULL THEN 'created' ELSE 'updated' END,
        CASE WHEN COALESCE(procedure_row->>'deletedAt', '') <> '' THEN 'deleted' ELSE 'active' END,
        effective_moment, moment, 'procedure', procedure_key,
        '', '', '', procedure_key, '', '', '',
        jsonb_build_object('procedure', procedure_key, 'workplaces', COALESCE(procedure_row->'workplaces', '[]'::jsonb)),
        jsonb_build_object('current', procedure_row)
      );
    END IF;
    old_procedure := NULL;
  END LOOP;

  FOR old_procedure IN SELECT value FROM jsonb_array_elements(old_procedures)
  LOOP
    procedure_key := COALESCE(old_procedure->>'id', '');
    IF procedure_key = '' THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(new_procedures) value
      WHERE value->>'id' = procedure_key
    ) THEN
      PERFORM "professional_history_write"(
        tenant_id, 'procedure', procedure_key, 'deleted', 'deleted',
        moment, moment, 'procedure', procedure_key,
        '', '', '', procedure_key, '', '', '',
        jsonb_build_object('procedure', procedure_key),
        jsonb_build_object('deleted', old_procedure)
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_operational" ON "BusinessOperationalState";
CREATE TRIGGER "BusinessHistory_operational"
AFTER INSERT OR UPDATE OR DELETE ON "BusinessOperationalState"
FOR EACH ROW EXECUTE FUNCTION "professional_history_operational_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_document_archive_trigger"()
RETURNS trigger AS $$
DECLARE
  old_data JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE COALESCE(OLD."data", '{}'::jsonb) END;
  new_data JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE COALESCE(NEW."data", '{}'::jsonb) END;
  old_documents JSONB := COALESCE(old_data->'documents', '[]'::jsonb);
  new_documents JSONB := COALESCE(new_data->'documents', '[]'::jsonb);
  document_row JSONB;
  old_document JSONB;
  tenant_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."tenantId" ELSE NEW."tenantId" END;
  moment TIMESTAMP := CASE WHEN TG_OP = 'DELETE' THEN OLD."updatedAt" ELSE NEW."updatedAt" END;
  document_key TEXT;
  effective_moment TIMESTAMP;
BEGIN
  PERFORM "professional_history_write"(
    tenant_id, 'document-archive', tenant_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'document-archive', tenant_id,
    '', '', '', '', '', '', '',
    '{}'::jsonb,
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', old_data, 'after', new_data)
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', old_data)
      ELSE jsonb_build_object('current', new_data)
    END
  );

  FOR document_row IN SELECT value FROM jsonb_array_elements(new_documents)
  LOOP
    document_key := COALESCE(document_row->>'id', '');
    IF document_key = '' THEN CONTINUE; END IF;
    SELECT value INTO old_document
    FROM jsonb_array_elements(old_documents)
    WHERE value->>'id' = document_key
    LIMIT 1;

    IF old_document IS NULL OR old_document IS DISTINCT FROM document_row THEN
      effective_moment := "professional_history_timestamp"(
        COALESCE(document_row->>'updatedAt', document_row->>'publishedAt', document_row->>'createdAt'),
        moment
      );
      PERFORM "professional_history_write"(
        tenant_id, 'document', document_key,
        CASE WHEN old_document IS NULL THEN 'created' ELSE 'versioned' END,
        CASE WHEN COALESCE(document_row->>'deletedAt', '') <> '' THEN 'deleted' ELSE 'active' END,
        effective_moment, moment, 'document', document_key,
        '', '', '', '', document_key, '', '',
        jsonb_build_object('document', document_key, 'version', COALESCE(document_row->>'version', '')),
        jsonb_build_object('current', document_row)
      );
    END IF;
    old_document := NULL;
  END LOOP;

  FOR old_document IN SELECT value FROM jsonb_array_elements(old_documents)
  LOOP
    document_key := COALESCE(old_document->>'id', '');
    IF document_key = '' THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(new_documents) value
      WHERE value->>'id' = document_key
    ) THEN
      PERFORM "professional_history_write"(
        tenant_id, 'document', document_key, 'deleted', 'deleted',
        moment, moment, 'document', document_key,
        '', '', '', '', document_key, '', '',
        jsonb_build_object('document', document_key),
        jsonb_build_object('deleted', old_document)
      );
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_document_archive" ON "TenantDocumentArchive";
CREATE TRIGGER "BusinessHistory_document_archive"
AFTER INSERT OR UPDATE OR DELETE ON "TenantDocumentArchive"
FOR EACH ROW EXECUTE FUNCTION "professional_history_document_archive_trigger"();

CREATE OR REPLACE FUNCTION "professional_history_consent_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  event_id TEXT;
  document_id TEXT;
  person_key TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  event_id := COALESCE(row_data->>'id', '');
  document_id := COALESCE(row_data->>'documentId', '');
  person_key := COALESCE("professional_history_consent_person_key"(
    tenant_id,
    COALESCE(row_data->>'subjectType', ''),
    COALESCE(row_data->>'subjectKey', ''),
    COALESCE(row_data->>'contactType', ''),
    COALESCE(row_data->>'contactValue', '')
  ), '');
  moment := "professional_history_timestamp"(row_data->>'occurredAt', CURRENT_TIMESTAMP);

  PERFORM "professional_history_write"(
    tenant_id, 'document-consent', event_id,
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(row_data->>'status', lower(TG_OP)) END,
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(row_data->>'status', 'active') END,
    moment, moment, 'document-consent', event_id,
    person_key, '', '', '', document_id, '', '',
    jsonb_build_object(
      'person', person_key,
      'document', document_id,
      'subjectType', COALESCE(row_data->>'subjectType', ''),
      'subjectKey', COALESCE(row_data->>'subjectKey', '')
    ),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END,
    CASE WHEN TG_OP = 'INSERT' THEN 'document-consent:' || event_id ELSE '' END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF to_regclass('"TenantConsentEvent"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS "BusinessHistory_consent" ON "TenantConsentEvent"';
    EXECUTE 'CREATE TRIGGER "BusinessHistory_consent"
      AFTER INSERT OR UPDATE OR DELETE ON "TenantConsentEvent"
      FOR EACH ROW EXECUTE FUNCTION "professional_history_consent_trigger"()';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION "professional_history_loyalty_deposit_trigger"()
RETURNS trigger AS $$
DECLARE
  row_data JSONB;
  tenant_id TEXT;
  deposit_id TEXT;
  person_key TEXT;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_id := COALESCE(row_data->>'tenantId', '');
  deposit_id := COALESCE(row_data->>'depositId', '');
  person_key := COALESCE(row_data->>'personKey', '');
  moment := CASE
    WHEN TG_OP = 'DELETE' THEN OLD."updatedAt"
    ELSE NEW."updatedAt"
  END;

  PERFORM "professional_history_write"(
    tenant_id, 'loyalty-deposit', deposit_id, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(row_data->>'status', 'active') END,
    moment, moment, 'loyalty-deposit', deposit_id,
    person_key, '', '', '', '', '', COALESCE(row_data->>'fundingOperationId', ''),
    jsonb_build_object('person', person_key, 'deposit', deposit_id, 'program', COALESCE(row_data->>'programId', '')),
    CASE
      WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
      ELSE jsonb_build_object('current', to_jsonb(NEW))
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "BusinessHistory_loyalty_deposit" ON "LoyaltyDepositInstance";
CREATE TRIGGER "BusinessHistory_loyalty_deposit"
AFTER INSERT OR UPDATE OR DELETE ON "LoyaltyDepositInstance"
FOR EACH ROW EXECUTE FUNCTION "professional_history_loyalty_deposit_trigger"();

-- Backfill facts that already exist before unified professional History.

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT p."tenantId", 'seed:person:' || p."key", 'person', p."key", 'created', 'active', p."key",
       'person', p."key", p."createdAt", p."createdAt",
       jsonb_build_object('person', p."key"),
       jsonb_build_object('current', to_jsonb(p))
FROM "Person" p
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey","recordId","workplaceKey",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT r."tenantId", 'seed:record:' || r."recordId", 'record', r."recordId", 'created', 'active',
       COALESCE(r."data" #>> '{person,key}', ''), r."recordId", COALESCE(r."data"->>'workplaceId', ''),
       'record', r."recordId",
       "professional_history_timestamp"(COALESCE(r."data"->>'createdAt', ''), r."createdAt"),
       "professional_history_timestamp"(COALESCE(r."data"->>'createdAt', ''), r."createdAt"),
       jsonb_build_object(
         'person', COALESCE(r."data" #>> '{person,key}', ''),
         'record', r."recordId",
         'workplace', COALESCE(r."data"->>'workplaceId', '')
       ),
       jsonb_build_object('current', r."data")
FROM "BusinessRecord" r
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey","recordId","workplaceKey",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT e."tenantId", 'record-event:' || e."eventId", 'record-event', e."eventId",
       COALESCE(e."data"->>'type', 'event'), 'active',
       COALESCE(e."data" #>> '{subject,personKey}', "professional_history_record_person_key"(e."tenantId", e."recordId"), ''),
       e."recordId", COALESCE(e."data" #>> '{payload,appointment,workplaceId}', ''),
       'record', e."recordId",
       "professional_history_timestamp"(e."data"->>'at', e."createdAt"),
       "professional_history_timestamp"(e."data"->>'at', e."createdAt"),
       jsonb_build_object('record', e."recordId", 'recordEvent', e."eventId"),
       jsonb_build_object('current', e."data")
FROM "BusinessRecordEvent" e
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey","recordId",
  "financeOperationId","sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT f."tenantId", 'finance-operation:' || f."operationId", 'finance-operation', f."operationId",
       f."kind", f."status",
       COALESCE(f."data" #>> '{person,key}',
         CASE WHEN lower(f."sourceType") = 'record'
              THEN "professional_history_record_person_key"(f."tenantId", f."sourceId") ELSE '' END,
         ''),
       CASE WHEN lower(f."sourceType") = 'record' THEN f."sourceId" ELSE '' END,
       f."operationId", f."sourceType", f."sourceId", f."occurredAt", f."occurredAt",
       jsonb_build_object('financeOperation', f."operationId", 'sourceType', f."sourceType", 'sourceId', f."sourceId"),
       jsonb_build_object('current', to_jsonb(f))
FROM "FinanceOperation" f
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey","recordId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT s."tenantId", 'seed:finance-settlement:' || s."sourceType" || ':' || s."sourceId",
       'finance-settlement', s."sourceType" || ':' || s."sourceId", 'created', 'active',
       CASE WHEN lower(s."sourceType") = 'record' THEN COALESCE("professional_history_record_person_key"(s."tenantId", s."sourceId"), '') ELSE '' END,
       CASE WHEN lower(s."sourceType") = 'record' THEN s."sourceId" ELSE '' END,
       s."sourceType", s."sourceId", s."createdAt", s."createdAt",
       jsonb_build_object('sourceType', s."sourceType", 'sourceId', s."sourceId"),
       jsonb_build_object('current', s."data")
FROM "FinanceSettlement" s
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey","recordId","workplaceKey","procedureId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT m."tenantId", 'inventory-movement:' || m."movementId", 'inventory-movement', m."movementId",
       lower(m."kind"), m."status", m."personKey", m."recordId", m."workplaceKey", m."procedureKey",
       m."sourceType", m."sourceId", m."occurredAt", m."occurredAt",
       jsonb_build_object(
         'person', m."personKey", 'record', m."recordId", 'workplace', m."workplaceKey",
         'procedure', m."procedureKey", 'inventoryMovement', m."movementId",
         'originalMovement', m."originalMovementId"
       ),
       jsonb_build_object('current', to_jsonb(m))
FROM "InventoryMovement" m
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","inventoryItemId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT i."tenantId", 'seed:inventory-item:' || i."itemId", 'inventory-item', i."itemId",
       'created', CASE WHEN i."archivedAt" IS NULL THEN 'active' ELSE 'deleted' END, i."itemId",
       'inventory-item', i."itemId", i."createdAt", i."createdAt",
       jsonb_build_object('inventoryItem', i."itemId"),
       jsonb_build_object('current', to_jsonb(i))
FROM "InventoryItem" i
ON CONFLICT ("tenantId","eventId") DO NOTHING;

-- Existing procedureHistory snapshots keep old price/version periods.
INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","procedureId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT s."tenantId",
       'seed:procedure-history:' || COALESCE(p.value->>'id', '') || ':' || ordinality::text,
       'procedure', COALESCE(p.value->>'id', ''), COALESCE(p.value->>'historyAction', 'versioned'),
       CASE WHEN COALESCE(p.value->>'deletedAt', '') <> '' OR p.value->>'historyAction' = 'deleted' THEN 'deleted' ELSE 'superseded' END,
       COALESCE(p.value->>'id', ''), 'procedure', COALESCE(p.value->>'id', ''),
       "professional_history_timestamp"(COALESCE(p.value->>'updatedAt', p.value->>'createdAt'), s."createdAt"),
       "professional_history_timestamp"(COALESCE(p.value->>'historyAt', p.value->>'updatedAt', p.value->>'createdAt'), s."createdAt"),
       jsonb_build_object('procedure', COALESCE(p.value->>'id', ''), 'workplaces', COALESCE(p.value->'workplaces', '[]'::jsonb)),
       jsonb_build_object('current', p.value)
FROM "BusinessOperationalState" s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s."data"->'procedureHistory', '[]'::jsonb)) WITH ORDINALITY p(value, ordinality)
WHERE COALESCE(p.value->>'id', '') <> ''
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","procedureId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT s."tenantId", 'seed:procedure-current:' || COALESCE(p.value->>'id', ''),
       'procedure', COALESCE(p.value->>'id', ''), 'current',
       CASE WHEN COALESCE(p.value->>'deletedAt', '') <> '' THEN 'deleted' ELSE 'active' END,
       COALESCE(p.value->>'id', ''), 'procedure', COALESCE(p.value->>'id', ''),
       "professional_history_timestamp"(COALESCE(p.value->>'updatedAt', p.value->>'createdAt'), s."updatedAt"),
       "professional_history_timestamp"(COALESCE(p.value->>'updatedAt', p.value->>'createdAt'), s."updatedAt"),
       jsonb_build_object('procedure', COALESCE(p.value->>'id', ''), 'workplaces', COALESCE(p.value->'workplaces', '[]'::jsonb)),
       jsonb_build_object('current', p.value)
FROM "BusinessOperationalState" s
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s."data"->'procedures', '[]'::jsonb)) p(value)
WHERE COALESCE(p.value->>'id', '') <> ''
ON CONFLICT ("tenantId","eventId") DO NOTHING;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","documentId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT a."tenantId", 'seed:document:' || COALESCE(d.value->>'id', ''),
       'document', COALESCE(d.value->>'id', ''), 'current',
       CASE WHEN COALESCE(d.value->>'deletedAt', '') <> '' THEN 'deleted' ELSE 'active' END,
       COALESCE(d.value->>'id', ''), 'document', COALESCE(d.value->>'id', ''),
       "professional_history_timestamp"(COALESCE(d.value->>'updatedAt', d.value->>'publishedAt', d.value->>'createdAt'), a."updatedAt"),
       "professional_history_timestamp"(COALESCE(d.value->>'updatedAt', d.value->>'publishedAt', d.value->>'createdAt'), a."updatedAt"),
       jsonb_build_object('document', COALESCE(d.value->>'id', ''), 'version', COALESCE(d.value->>'version', '')),
       jsonb_build_object('current', d.value)
FROM "TenantDocumentArchive" a
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a."data"->'documents', '[]'::jsonb)) d(value)
WHERE COALESCE(d.value->>'id', '') <> ''
ON CONFLICT ("tenantId","eventId") DO NOTHING;

DO $$
BEGIN
  IF to_regclass('"TenantConsentEvent"') IS NOT NULL THEN
    EXECUTE $sql$
      INSERT INTO "BusinessHistoryEvent" (
        "tenantId","eventId","entityType","entityId","eventType","status","personKey","documentId",
        "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
      )
      SELECT c."tenantId", 'document-consent:' || c."id", 'document-consent', c."id",
             c."status", c."status",
             COALESCE("professional_history_consent_person_key"(
               c."tenantId", c."subjectType", c."subjectKey", c."contactType", c."contactValue"
             ), ''),
             c."documentId", 'document-consent', c."id", c."occurredAt", c."occurredAt",
             jsonb_build_object(
               'document', c."documentId",
               'subjectType', c."subjectType",
               'subjectKey', c."subjectKey"
             ),
             jsonb_build_object('current', to_jsonb(c))
      FROM "TenantConsentEvent" c
      ON CONFLICT ("tenantId","eventId") DO NOTHING
    $sql$;
  END IF;
END $$;

INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status","personKey",
  "financeOperationId","sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT d."tenantId", 'seed:loyalty-deposit:' || d."depositId", 'loyalty-deposit', d."depositId",
       'created', d."status", d."personKey", d."fundingOperationId",
       'loyalty-deposit', d."depositId", d."fundedAt", d."fundedAt",
       jsonb_build_object('person', d."personKey", 'deposit', d."depositId", 'program', d."programId"),
       jsonb_build_object('current', to_jsonb(d))
FROM "LoyaltyDepositInstance" d
ON CONFLICT ("tenantId","eventId") DO NOTHING;

COMMIT;
