-- #844 — Uncovered identity and User dismissal facts, each in the owner's History.
-- A dismissed Record remains in BusinessRecord; only a pointer is audited here.
BEGIN;

CREATE OR REPLACE FUNCTION "professional_history_uei_trigger"()
RETURNS TRIGGER AS $$
DECLARE
  row_data JSONB;
  payload JSONB;
  moment TIMESTAMP;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF TG_OP = 'UPDATE' AND OLD."data" = NEW."data" THEN RETURN NULL; END IF;
  payload := CASE WHEN TG_OP = 'DELETE'
    THEN jsonb_build_object('deleted', OLD."data")
    WHEN TG_OP = 'UPDATE'
    THEN jsonb_build_object('before', OLD."data", 'after', NEW."data")
    ELSE jsonb_build_object('current', NEW."data") END;
  moment := clock_timestamp() AT TIME ZONE 'UTC';
  PERFORM "professional_history_write"(
    row_data->>'tenantId', 'uei', row_data->>'tenantId',
    lower(TG_OP), CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    moment, moment, 'uei', row_data->>'tenantId',
    '', '', '', '', '', '', '',
    jsonb_build_object('tenantId', row_data->>'tenantId'),
    payload
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BusinessHistory_uei"
AFTER INSERT OR UPDATE OR DELETE ON "UeiState"
FOR EACH ROW EXECUTE FUNCTION "professional_history_uei_trigger"();

CREATE OR REPLACE FUNCTION "account_history_record_dismissal_trigger"()
RETURNS TRIGGER AS $$
DECLARE
  row_data JSONB;
BEGIN
  row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  PERFORM "account_history_write"(
    row_data->>'accountId', 'record-dismissal', row_data->>'recordId',
    CASE WHEN TG_OP = 'INSERT' THEN 'hide' ELSE 'unhide' END,
    CASE WHEN TG_OP = 'INSERT' THEN 'hidden' ELSE 'visible' END,
    'account-journal', row_data->>'recordId',
    jsonb_build_object('tenantId', row_data->>'tenantId',
      'recordId', row_data->>'recordId', 'referenceOnly', true),
    CASE WHEN TG_OP = 'INSERT'
      THEN jsonb_build_object('before',NULL,'after',jsonb_build_object('hidden',true))
      ELSE jsonb_build_object('before',jsonb_build_object('hidden',true),
                             'after',jsonb_build_object('hidden',false)) END
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountHistory_record_dismissal"
AFTER INSERT OR DELETE ON "AccountJournalHiddenRecord"
FOR EACH ROW EXECUTE FUNCTION "account_history_record_dismissal_trigger"();

COMMIT;
