-- Issue #844: tenant-owned Event and profile-owned Note use canonical History.
-- Personal objects with tenantId IS NULL never enter tenant History.
BEGIN;
CREATE OR REPLACE FUNCTION "professional_history_event_note_trigger"()
RETURNS trigger AS $$
DECLARE
  payload JSONB;
  kind TEXT;
  tenant_key TEXT;
  entity_key TEXT;
  owner_type TEXT;
  owner_id TEXT;
  record_key TEXT;
  workplace_key TEXT;
  actor_key TEXT;
  moment TIMESTAMP;
  relations JSONB;
  details JSONB;
BEGIN
  payload := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  tenant_key := COALESCE(payload->>'tenantId', '');
  IF tenant_key = '' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(OLD) - 'updatedAt') = (to_jsonb(NEW) - 'updatedAt') THEN
    RETURN NULL;
  END IF;

  kind := CASE WHEN TG_TABLE_NAME = 'Event' THEN 'event' ELSE 'note' END;
  entity_key := payload->>'id';
  owner_type := COALESCE(payload->>'ownerType', '');
  owner_id := COALESCE(payload->>'ownerId', '');
  record_key := CASE WHEN kind = 'note' AND payload->>'targetType' = 'record'
    THEN COALESCE(payload->>'targetId', '') ELSE '' END;
  workplace_key := CASE WHEN kind = 'event'
    THEN COALESCE(payload->>'workplaceId', '') ELSE '' END;
  actor_key := COALESCE(current_setting('co_va.history_actor_id', true), '');
  moment := clock_timestamp() AT TIME ZONE 'UTC';

  relations := jsonb_build_object(
    'scope', 'tenant', 'ownerType', owner_type, 'ownerId', owner_id,
    'record', record_key, 'workplace', workplace_key
  );
  details := CASE
    WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW))
    WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted', to_jsonb(OLD))
    ELSE jsonb_build_object('current', to_jsonb(NEW))
  END;
  details := details || jsonb_build_object(
    'scope', 'tenant',
    'owner', jsonb_build_object('type', owner_type, 'id', owner_id),
    'actor', jsonb_build_object(
      'type', CASE WHEN actor_key = '' THEN 'system' ELSE 'platform-account' END,
      'platformAccountId', actor_key,
      'role', COALESCE(current_setting('co_va.history_actor_role', true), '')
    ),
    'reason', NULLIF(current_setting('co_va.history_reason', true), ''),
    'source', CASE WHEN actor_key = '' THEN 'database' ELSE 'authenticated-api' END,
    'result', 'committed',
    'correlationId', NULLIF(current_setting('co_va.history_correlation_id', true), '')
  );

  PERFORM "professional_history_write"(
    tenant_key, kind, entity_key, lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, kind, entity_key,
    '', record_key, workplace_key, '', '', '', '',
    relations, details
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BusinessHistory_event"
AFTER INSERT OR UPDATE OR DELETE ON "Event"
FOR EACH ROW EXECUTE FUNCTION "professional_history_event_note_trigger"();
CREATE TRIGGER "BusinessHistory_note"
AFTER INSERT OR UPDATE OR DELETE ON "Note"
FOR EACH ROW EXECUTE FUNCTION "professional_history_event_note_trigger"();
COMMIT;
