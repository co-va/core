BEGIN;

-- Existing DDS ledger rows must be available from History immediately,
-- not only movements created after the unified History migration.
INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status",
  "personKey","recordId","financeOperationId","sourceType","sourceId",
  "effectiveAt","occurredAt","relations","data"
)
SELECT
  l."tenantId",
  'seed:finance-ledger-entry:' || l."entryId",
  'finance-ledger-entry',
  l."entryId",
  lower(COALESCE(l."economicType", 'ledger')),
  COALESCE(o."status", 'active'),
  COALESCE(
    o."data" #>> '{person,key}',
    CASE WHEN lower(l."sourceType") = 'record'
      THEN "professional_history_record_person_key"(l."tenantId", l."sourceId")
      ELSE ''
    END,
    ''
  ),
  CASE WHEN lower(l."sourceType") = 'record' THEN l."sourceId" ELSE '' END,
  COALESCE(o."operationId", ''),
  l."sourceType",
  l."sourceId",
  l."occurredAt",
  l."occurredAt",
  jsonb_build_object(
    'person', COALESCE(
      o."data" #>> '{person,key}',
      CASE WHEN lower(l."sourceType") = 'record'
        THEN "professional_history_record_person_key"(l."tenantId", l."sourceId")
        ELSE ''
      END,
      ''
    ),
    'record', CASE WHEN lower(l."sourceType") = 'record' THEN l."sourceId" ELSE '' END,
    'financeOperation', COALESCE(o."operationId", ''),
    'ledgerEntry', l."entryId"
  ),
  jsonb_build_object('current', to_jsonb(l))
FROM "FinanceLedgerEntry" l
LEFT JOIN "FinanceOperation" o ON o."id" = l."financeOperationId"
ON CONFLICT ("tenantId","eventId") DO NOTHING;

-- Existing inventory lines preserve the item/record/procedure links that are
-- needed for inventory and person/history projections.
INSERT INTO "BusinessHistoryEvent" (
  "tenantId","eventId","entityType","entityId","eventType","status",
  "personKey","recordId","workplaceKey","procedureId","inventoryItemId",
  "sourceType","sourceId","effectiveAt","occurredAt","relations","data"
)
SELECT
  l."tenantId",
  'seed:inventory-movement-line:' || l."lineId",
  'inventory-movement-line',
  l."lineId",
  lower(COALESCE(l."direction", 'line')),
  COALESCE(m."status", 'active'),
  COALESCE(m."personKey", ''),
  COALESCE(m."recordId", ''),
  COALESCE(m."workplaceKey", ''),
  COALESCE(m."procedureKey", ''),
  COALESCE(i."itemId", ''),
  'inventory-movement',
  COALESCE(m."movementId", ''),
  COALESCE(m."occurredAt", l."createdAt"),
  COALESCE(m."occurredAt", l."createdAt"),
  jsonb_build_object(
    'person', COALESCE(m."personKey", ''),
    'record', COALESCE(m."recordId", ''),
    'workplace', COALESCE(m."workplaceKey", ''),
    'procedure', COALESCE(m."procedureKey", ''),
    'inventoryMovement', COALESCE(m."movementId", ''),
    'inventoryItem', COALESCE(i."itemId", ''),
    'line', l."lineId"
  ),
  jsonb_build_object('current', to_jsonb(l))
FROM "InventoryMovementLine" l
LEFT JOIN "InventoryMovement" m ON m."id" = l."inventoryMovementId"
LEFT JOIN "InventoryItem" i ON i."id" = l."inventoryItemId"
ON CONFLICT ("tenantId","eventId") DO NOTHING;

COMMIT;
