import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const originalTrigger = read('server/prisma/migrations/20261019170000_professional_history/migration.sql');
const actorMigration = read('server/prisma/migrations/20261106225000_record_history_delete_actor/migration.sql');
const business = read('server/src/business-state/business-state.service.ts');
const controller = read('server/src/business-state/business-state.controller.ts');
const history = read('server/src/account-unread/account-unread.service.ts');
const schema = read('server/prisma/schema.prisma');

// Canonical history has recorded the complete OLD record since October.
assert.match(originalTrigger, /CREATE TABLE IF NOT EXISTS "BusinessHistoryEvent"/);
assert.match(originalTrigger, /'record', entity_id, lower\(TG_OP\)/);
assert.match(originalTrigger, /WHEN TG_OP = 'DELETE' THEN jsonb_build_object\('deleted', OLD\."data"\)/);

// An actual delete is a source action, not a cancellation or analytics state.
assert.match(business, /const record = await tx\.record\.deleteMany/);
assert.match(business, /await tx\.recordEvent\.deleteMany/);
assert.doesNotMatch(business, /deletedRecordSnapshot|type: 'deleted'[\s\S]*payload: \{ snapshot \}/);
assert.doesNotMatch(schema, /model DeletedRecordSnapshot/);

// Actor and actual deletion time are captured by the existing History trigger.
assert.match(controller, /platformAccountId: request\.auth!\.platformAccountId/);
assert.match(business, /set_config\('co_va\.history_actor_id'/);
assert.match(actorMigration, /clock_timestamp\(\) AT TIME ZONE 'UTC'/);
assert.match(actorMigration, /'deleted', OLD\."data"/);
assert.match(actorMigration, /current_setting\('co_va\.history_actor_id', true\)/);

// User history is authorized by the recipient's notification, and resolves
// the existing immutable Record deletion fact (no duplicate snapshot table).
assert.match(history, /FROM "BusinessHistoryEvent" h/);
assert.match(history, /h\."data"->'deleted' AS "data"/);
assert.match(history, /h\."entityType" = 'record'/);
assert.match(history, /h\."eventType" = 'delete'/);
assert.match(history, /d\."recipientKey"/);
assert.match(history, /procedures,/);
assert.doesNotMatch(history, /FROM "DeletedRecordSnapshot"/);

console.log('PASS: canonical Record deletion history retains full OLD record, actor and actual time without duplicate storage');
