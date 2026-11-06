-- Enhance the existing canonical BusinessHistoryEvent, not a second history model.
-- The BusinessRecord trigger already persists OLD.data, including services and
-- person identity. Record the real deletion moment and the authenticated actor.
BEGIN;

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
  -- Deletion time is WHEN the user deleted the Record, not its old updatedAt.
  moment := CASE WHEN TG_OP = 'DELETE'
    THEN clock_timestamp() AT TIME ZONE 'UTC'
    ELSE "professional_history_timestamp"(
      COALESCE(payload->>'updatedAt', payload->>'createdAt'),
      NEW."updatedAt"
    )
  END;
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
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object(
        'deleted', OLD."data",
        'actor', jsonb_build_object(
          'type', 'platform-account',
          'platformAccountId', COALESCE(current_setting('co_va.history_actor_id', true), ''),
          'role', COALESCE(current_setting('co_va.history_actor_role', true), '')
        )
      )
      ELSE jsonb_build_object('current', NEW."data")
    END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- The original BusinessHistory_record trigger continues to call this function.
COMMIT;
