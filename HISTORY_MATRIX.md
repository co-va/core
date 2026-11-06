# History #844 — source / owner / action / actor matrix

Canonical contract: `scope/owner → entityType → entityId → action → actor → occurredAt → recordedAt → before/after → reason (when known) → source → result → correlationId`.

## Tenant — one BusinessHistoryEvent source, not copied to other domains

| Trigger suffix | Source | Actions | Atomicity | Actor |
|---|---|---|---|---|
| `BusinessHistory_person` | `Person` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | PROFESSIONAL |
| `BusinessHistory_record` | `BusinessRecord` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | Record DELETE context; other paths UNKNOWN |
| `BusinessHistory_record_event` | `BusinessRecordEvent` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_finance_operation` | `FinanceOperation` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_finance_settlement` | `FinanceSettlement` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_finance_ledger` | `FinanceLedgerEntry` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_inventory_item` | `InventoryItem` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_inventory_movement` | `InventoryMovement` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_inventory_line` | `InventoryMovementLine` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_workplace` | `Workplace` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_auxiliary` | `BusinessAuxiliaryState` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_operational` | `BusinessOperationalState` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_document_archive` | `TenantDocumentArchive` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_consent` | `TenantConsentEvent` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_loyalty_deposit` | `LoyaltyDepositInstance` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | UNKNOWN when not provided |
| `BusinessHistory_event` | `Event calendar` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | PROFESSIONAL |
| `BusinessHistory_note` | `Note` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | PROFESSIONAL; private Profile |
| `BusinessHistory_uei` | `UeiState` | INSERT / UPDATE / DELETE | Same PostgreSQL transaction | PROFESSIONAL; imports UNKNOWN |

The original 15 triggers remain installed and share the `professional_history_write` contract. Two previously uncovered sources (Event, Note) and UEI use that same writer. Proven authenticated actor, optional reason and correlation ID travel through transaction-local settings. If an older path did not provide verifiable actor context, it is **unknown**, never fabricated. No historical backfill.

## Account — own private facts

| Entity | Action | Source | Contents |
|---|---|---|---|
| Personal Event / Note | CREATE / UPDATE / DELETE | `AccountHistoryEvent` triggers | Authorised Account-only before/after snapshots |
| Account profile / credential | REGISTER / UPDATE | `AccountHistoryEvent` trigger | Changed field names; never credentials, hash, reset tokens or arbitrary profileData |
| Record dismissal | HIDE / UNHIDE | `AccountHistoryEvent` trigger | Tenant and Record IDs only; original Record is not modified |
| Own login history | READ | Projection of `PlatformActivityEvent` | Filters `subjectAccountId`; no duplicated audit facts |

## Platform — control plane only

| Entity | Action | Source |
|---|---|---|
| User / Professional login | SUCCESS / DENIED | `PlatformActivityEvent` (known/unknown subject, IP/UA/device claimed context) |
| Tenant access, tester, capability and readiness | UPDATE | `PlatformActivityEvent` with authenticated Admin; transaction-atomic |
| Tariffs, paid orders and receipts | Existing commercial actions | `CommercialAuditEvent` read projection |

**Privacy:** No platform endpoint reads tenant Record or Note snapshots. Tenant History requires current membership; profile-owned Note History requires exact Profile ownership. Account History requires own bearer token. Account facts are append-only; existing tenant transfer-rollback behavior is protected. Source facts are stored once in their owner domain.

**Retention / legality:** no arbitrary retention period is invented. Automated purge/expiry must be approved against privacy retention policy before activation. IP is taken only from Express `request.ip` with verified proxy configuration; PWA/web signal is client-asserted, not proof of identity.

**Protected work:** Existing Record deletion snapshot/migration, AccountUnread and User Journal were not edited. All acceptance smoke checks use a rollback-only isolated PostgreSQL fixture.