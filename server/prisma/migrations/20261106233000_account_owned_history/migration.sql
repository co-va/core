-- #844: a distinct Account-owned History, not a copy of tenant Record history.
-- No FK to Account: deletion/retention policies are explicit and cannot cascade
-- into another owner's audit. Never store password hashes or tokens here.
BEGIN;
CREATE TABLE "AccountHistoryEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "accountId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "sourceType" TEXT NOT NULL DEFAULT '',
  "sourceId" TEXT NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "relations" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX "AccountHistoryEvent_owner_event_unique"
  ON "AccountHistoryEvent"("accountId", "eventId");
CREATE INDEX "AccountHistoryEvent_owner_time_idx"
  ON "AccountHistoryEvent"("accountId", "occurredAt" DESC, "id" DESC);
CREATE INDEX "AccountHistoryEvent_owner_entity_idx"
  ON "AccountHistoryEvent"("accountId", "entityType", "entityId", "occurredAt" DESC);

CREATE OR REPLACE FUNCTION "account_history_write"(
  owner_id TEXT, entity_type TEXT, entity_id TEXT, event_type TEXT,
  event_status TEXT, source_type TEXT, source_id TEXT,
  relation_data JSONB, event_data JSONB
) RETURNS VOID AS $$
DECLARE
  actor_id TEXT;
  event_time TIMESTAMP;
BEGIN
  IF COALESCE(owner_id, '') = '' OR COALESCE(entity_type,'') = ''
    OR COALESCE(entity_id, '') = '' THEN
    RETURN;
  END IF;
  actor_id := COALESCE(current_setting('co_va.account_history_actor_id',true),'');
  event_time := clock_timestamp() AT TIME ZONE 'UTC';
  INSERT INTO "AccountHistoryEvent" (
    "accountId","eventId","entityType","entityId","eventType","status",
    "sourceType","sourceId","occurredAt","relations","data"
  ) VALUES (
    owner_id, 'account:' || md5(random()::text || clock_timestamp()::text || txid_current()::text),
    entity_type, entity_id, event_type,
    COALESCE(NULLIF(event_status,''),'active'),
    COALESCE(source_type,''),COALESCE(source_id,''),
    event_time,COALESCE(relation_data,'{}'::jsonb),
    COALESCE(event_data,'{}'::jsonb) || jsonb_build_object(
      'scope','account',
      'owner',jsonb_build_object('type','account','id',owner_id),
      'actor',jsonb_build_object(
        'type', CASE WHEN actor_id = '' THEN 'system' ELSE 'account' END,
        'accountId',actor_id
      ),
      'reason',NULLIF(current_setting('co_va.account_history_reason',true),''),
      'source',CASE WHEN actor_id = '' THEN 'database' ELSE 'authenticated-api' END,
      'result','committed',
      'correlationId',NULLIF(current_setting('co_va.account_history_correlation_id',true),'')
    )
  );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "account_history_event_note_trigger"()
RETURNS trigger AS $$
DECLARE
  source_row JSONB;
  event_kind TEXT;
  owner_key TEXT;
  details JSONB;
BEGIN
  source_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  IF source_row->>'tenantId' IS NOT NULL OR
     COALESCE(source_row->>'ownerType','') <> 'account' THEN RETURN NULL; END IF;
  owner_key := COALESCE(source_row->>'ownerId','');
  IF TG_OP = 'UPDATE' AND
    (to_jsonb(OLD) - 'updatedAt') = (to_jsonb(NEW) - 'updatedAt') THEN RETURN NULL; END IF;
  event_kind := CASE WHEN TG_TABLE_NAME = 'Event' THEN 'event' ELSE 'note' END;
  details := CASE WHEN TG_OP = 'DELETE' THEN jsonb_build_object('deleted',to_jsonb(OLD))
                  WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('before',to_jsonb(OLD),'after',to_jsonb(NEW))
                  ELSE jsonb_build_object('current',to_jsonb(NEW)) END;
  PERFORM "account_history_write"(
    owner_key, event_kind, source_row->>'id', lower(TG_OP),
    CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'active' END,
    event_kind,source_row->>'id',
    jsonb_build_object('scope','account','ownerType','account','ownerId',owner_key),
    details
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountHistory_event"
AFTER INSERT OR UPDATE OR DELETE ON "Event"
FOR EACH ROW EXECUTE FUNCTION "account_history_event_note_trigger"();
CREATE TRIGGER "AccountHistory_note"
AFTER INSERT OR UPDATE OR DELETE ON "Note"
FOR EACH ROW EXECUTE FUNCTION "account_history_event_note_trigger"();

-- Keep Account profile/credential changes without retaining hashes/tokens
-- or arbitrary profileData (which may contain sensitive integration fields).
CREATE OR REPLACE FUNCTION "account_history_profile_trigger"()
RETURNS trigger AS $$
DECLARE
  fields JSONB := '[]'::jsonb;
  before_data JSONB := '{}'::jsonb;
  after_data JSONB := '{}'::jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM "account_history_write"(
      NEW."id",'account',NEW."id",'create','active','account',NEW."id",
      jsonb_build_object('scope','account'),
      jsonb_build_object('current',jsonb_build_object('registered',true))
    );
    RETURN NULL;
  END IF;
  IF OLD."name" IS DISTINCT FROM NEW."name" THEN
    fields:=fields||'["name"]'::jsonb;
    before_data:=before_data||jsonb_build_object('name',OLD."name");
    after_data:=after_data||jsonb_build_object('name',NEW."name");
  END IF;
  IF OLD."surname" IS DISTINCT FROM NEW."surname" THEN
    fields:=fields||'["surname"]'::jsonb;
    before_data:=before_data||jsonb_build_object('surname',OLD."surname");
    after_data:=after_data||jsonb_build_object('surname',NEW."surname");
  END IF;
  IF OLD."email" IS DISTINCT FROM NEW."email" THEN
    fields:=fields||'["email"]'::jsonb;
  END IF;
  IF OLD."phone" IS DISTINCT FROM NEW."phone" THEN
    fields:=fields||'["phone"]'::jsonb;
  END IF;
  IF OLD."telegramId" IS DISTINCT FROM NEW."telegramId" THEN
    fields:=fields||'["telegramId"]'::jsonb;
  END IF;
  IF OLD."profileData" IS DISTINCT FROM NEW."profileData" THEN
    fields:=fields||'["profileData"]'::jsonb;
  END IF;
  IF OLD."passwordHash" IS DISTINCT FROM NEW."passwordHash" THEN
    fields:=fields||'["credential"]'::jsonb;
  END IF;
  IF fields = '[]'::jsonb THEN RETURN NULL; END IF;
  PERFORM "account_history_write"(
    NEW."id",'account',NEW."id",'update','active','account',NEW."id",
    jsonb_build_object('scope','account'),
    jsonb_build_object('before',before_data,'after',after_data,'changedFields',fields)
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AccountHistory_account"
AFTER INSERT OR UPDATE ON "Account"
FOR EACH ROW EXECUTE FUNCTION "account_history_profile_trigger"();
COMMIT;
