# History — ownership and audit contract (#844)

## Scope / source of truth

| Owner | Canonical storage | Read permission |
|---|---|---|
| Tenant | Existing `BusinessHistoryEvent` and its existing domain triggers | Authenticated Professional in the same tenant; profile-owned Note facts only visible to the same Profile |
| Account (User) | `AccountHistoryEvent` for **account-owned** Event, Note and Account profile actions | Only that authenticated Account, via `GET /account/history` |
| Platform | Existing `PlatformActivityEvent` for authentication, tenant access and administrative events; existing `CommercialAuditEvent` for commercial changes | Platform Admin via `GET /saas-admin/history`; a User can view **only their own attributable login facts** through `GET /account/history` |

There is no universal replacement table. A tenant Record is stored **only** in its tenant's canonical History; User notifications and dismissal state reference it by identifiers. The platform's audit never reads tenant Record snapshots.

## Unified read projection

All three readers produce a consistent set of fields where supported:
`scope/owner, entityType/entityId, action, actor, occurredAt, recordedAt, before/after, reason, source, result, correlationId`.
Legacy events keep original fields for backward compatibility; unavailable fields are unknown, not invented. Existing historical rows are not rewritten or replayed.

The calendar `Event` is a business entity. It is **not** synonymous with the History event.

## Writes and atomicity

Existing tenant trigger coverage (15 original triggers) is retained. Tenant Event/Note additions write within the same database transaction as the entity change and reuse `BusinessHistoryEvent`. User-owned Event/Note and safe Account profile metadata write to `AccountHistoryEvent` via database triggers; Account writes never copy tenant content. Account credential hashes, arbitrary `profileData`, passwords, bearer tokens and reset tokens are never placed in profile-history snapshots.

Login successes and known/anonymous denials use `PlatformActivityEvent` as a separate security fact, not a user-record duplicate. `subjectAccountId` permits authorized projection of User login history. Anonymous attempts cannot be attributed to a specific Account.

## Technical login metadata

Fields: server timestamp, outcome, known account identifier if resolved, IP from Express `request.ip`, shortened User-Agent, inferred OS/browser/device class, and optional `x-va-display-mode` set to `web` or `pwa`. Display mode is **client-asserted**, not proof of installation. UA and IP are not a unique device ID. `AUDIT_TRUST_PROXY_HOPS` defaults to 0; configure a verified ingress hop count before trusting forwarded IPs.

## Privacy and outstanding requirements

- Tenant History must never be read through a platform-admin endpoint.
- Profile Note facts are hidden from other Profiles on both list and as-of reads.
- Existing Account/User deletion and `account-unread` flows (including migrations) are protected; their work is not altered.
- No migration backfills events that were never recorded. Existing 15 triggers can lack a reliable human actor or reason. The projection labels these **unknown** rather than attributing to a fabricated user; source-specific actor propagation must be validated before enabling for each remaining path.
- Security event retention periods and erasure rules require a formally approved legal retention policy before automatic cleanup. Current platform append-only constraints are not bypassed.
- User/Professional frontends must send `x-va-display-mode` when known. No UI or frontend was changed in Core.
- Legacy commercial audit writes are preserved; their preexisting multi-step business transactions are not silently restructured.

## Regression gates

`npm run check`, `npm test`, Prisma/Nest build, isolated PostgreSQL migration, `server/scripts/check-history.mjs`, existing Core integration/data transfer, onboarding and admin login probes. Tests verify source separation, real deletion snapshots, and no passwordHash persistence in Account History. `main` is not modified by staging development.
