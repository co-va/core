-- #844 — Contract metadata for all 15 existing tenant trigger sources.
-- Preserve the source's canonical snapshots, event IDs, and atomic transaction.
-- Never invent a human actor for legacy/background writes.
BEGIN;

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
DECLARE
  actor_id TEXT;
  actor_role TEXT;
  enriched JSONB;
BEGIN
  IF COALESCE(tenant_id,'') = '' OR COALESCE(entity_type,'') = '' OR COALESCE(entity_id,'') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = tenant_id) THEN
    RETURN;
  END IF;

  actor_id := NULLIF(current_setting('co_va.history_actor_id', true), '');
  actor_role := NULLIF(current_setting('co_va.history_actor_role', true), '');
  enriched := jsonb_build_object(
    'scope', 'tenant',
    'owner', jsonb_build_object('type','tenant','id',tenant_id),
    'actor', CASE WHEN actor_id IS NULL
        THEN jsonb_build_object('type','unknown')
        ELSE jsonb_build_object('type','platform-account','platformAccountId',actor_id,'role',actor_role)
      END,
    'reason', NULLIF(current_setting('co_va.history_reason', true), ''),
    'source', jsonb_build_object('type',COALESCE(source_type,''),'id',COALESCE(source_id,'')),
    'result', 'committed',
    'correlationId', NULLIF(current_setting('co_va.history_correlation_id',true),'')
  ) || COALESCE(event_data,'{}'::jsonb);

  INSERT INTO "BusinessHistoryEvent" (
    "tenantId", "eventId", "entityType", "entityId", "eventType", "status",
    "personKey", "recordId", "workplaceKey", "procedureId", "documentId",
    "inventoryItemId", "financeOperationId", "sourceType", "sourceId",
    "effectiveAt", "occurredAt", "relations", "data"
  ) VALUES (
    tenant_id,
    COALESCE(NULLIF(fixed_event_id, ''), "professional_history_event_id"(entity_type || ':' || entity_id || ':' || event_type)),
    entity_type, entity_id, event_type,
    COALESCE(NULLIF(event_status, ''), 'active'),
    COALESCE(person_key, ''), COALESCE(record_id, ''), COALESCE(workplace_key, ''),
    COALESCE(procedure_id, ''), COALESCE(document_id, ''),
    COALESCE(inventory_item_id, ''), COALESCE(finance_operation_id, ''),
    COALESCE(source_type, ''), COALESCE(source_id, ''),
    COALESCE(effective_at, occurred_at, CURRENT_TIMESTAMP),
    COALESCE(occurred_at, CURRENT_TIMESTAMP),
    COALESCE(relation_data, '{}'::jsonb),
    enriched
  )
  ON CONFLICT ("tenantId", "eventId") DO NOTHING;
END;
$$ LANGUAGE plpgsql;

-- Account-owned facts are append-only. BusinessHistoryEvent's existing
-- import/rollback semantics are unchanged; don't block its transfer cleanup.
CREATE OR REPLACE FUNCTION "account_history_reject_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AccountHistoryEvent is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountHistory_append_only"
  BEFORE UPDATE OR DELETE ON "AccountHistoryEvent"
  FOR EACH ROW EXECUTE FUNCTION "account_history_reject_mutation"();

COMMIT;
