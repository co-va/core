# PROJECT_STATE — Core platform

## Ownership
This repository is the platform and API backend, **not** the Professional or User application.

- Core: `co-va/core` — NestJS API, PostgreSQL/Prisma, business services, identity/consents, permissions, messaging, notifications, platform Admin and public landing.
- Professional: `co-va/professional/staging` — independent frontend, Journal, Profile, Time, Finance interface, notifications interface, guest Booking experience and PWA.
- User: `co-va/user/staging` — independent User frontend, account and PWA.
- Приложение конечного пользователя имеет единственного владельца: `co-va/user`.
- User frontend/runtime/routes/UI должны быть полностью удалены из Core.
- No browser application source may be copied back into Core from either repo. No second frontend on either application domain.

## Production domains
- `api.va-tools.ru` — Core API and database-backed endpoints.
- `admin.va-tools.ru` — Core platform Admin and Admin password recovery.
- `va-tools.ru`, `www.va-tools.ru` — public platform landing.
- `prof.va-tools.ru` — standalone Professional, served by its own deployment.
- `user.va-tools.ru` — standalone User, served by its own deployment.
- Old `app.va-tools.ru` and `va-app-temp-volokovykh.msk1.amvera.tech` redirect to the independent Professional origin; Core does not serve a second Professional frontend.
- Core does not serve User or guest Booking frontend on `USER_HOST`.
- CORS for the active independent applications remains in the Core API and is not evidence of frontend duplication.

## Protected backend contracts
The `server/src/**`, `server/prisma/**`, server migrations and database schema remain the canonical owners of:
- Account/Person/UEI, Profile, Tenant, workplace, access control and commercial readiness.
- Time, Procedure, Record, Event, Note, Finance, settlement, loyalty, auxiliary state and data transfer.
- Communication, Telegram/email, service/marketing/system notifications, push and unread counts.
- PDN, consent documents, platform terms, legal archive, authentication and invitations.
- Guest Booking **server API** in `server/src/online-booking/**`: this is required by the separate applications and must never be deleted merely because the historical frontend directory had the same name.
- Shared pure domain rules required by server build under `core/finance/rules`, `core/loyalty/price-condition`, `core/phone`, `core/time/zone` and `core/uei-format`.

Do not remove server routes, DB columns, notifications, records or migrations as part of frontend cleanup. Do not migrate production data during this cleanup.

## Permanent staging Admin preview — 2026-11-09
- Restored the original read-only gateway from PR #820/#821 after it was removed during platform-only cleanup on 2026-11-05.
- Amvera default host `va-app-volokovykh.msk1.amvera.tech` is the **preview hostname**, not the legacy `va-app-temp-volokovykh.msk1.amvera.tech` redirect.
- On this exact hostname, `/` redirects to `/admin/`. Admin and landing browser assets (and direct browser dependencies) are fetched from `co-va/core/staging` with no-store. Backend API calls continue to use the deployed Core backend.
- Preview is read-only for mutations except the existing login bootstrap; Admin document registry sync is an explicit no-op. Production host routing, data model, and the separate Professional/User apps are not changed.
- The gateway must be part of the **deployed Core runtime** before the temporary hostname works; a `staging` Git commit alone cannot alter a Core runtime deployed from `main`. After the infrastructure gateway is deployed once, later frontend edits in `staging` can be previewed without each design change reaching `main`.
- No release/merge to `main` without owner authorization. Do not remove this gateway during future platform-only cleanup; it does not restore detached application frontends.

## Core frontend surface
Only platform Admin (`admin/**`), public platform landing (`landing/**`) and the strict direct frontend dependencies in `core/**`, `ui/**` and `css/style.css` may be served by Core.
`scripts/build-pages.mjs` uses an explicit allowlist; it must never package a Professional/User app bundle, Journal, guest Booking UI or PWA.
`scripts/check-platform-only-boundary.mjs` rejects reintroduced frontend ownership.
No separate `frontend` service may run in `docker-compose.staging.yml`; Core tests use the real backend and isolated PostgreSQL.

## Cleanup execution — 2026-11-05
- Baseline: 816 tracked files at `core/main`, commit `1f2b4751`.
- Earlier old entrypoint/chat removal: 13 files in `staging`.
- Remaining retired frontend/scripts/browser tests removed in a separate batch: 422 files.
- Platform-only tree after cleanup: 382 tracked files before documentation changes.
- Old UI-only test suites were retired from Core; the remaining platform/API tests and isolated database smoke are executed by CI.
- Professional and User repositories were not modified.
- Completion requires fresh Check Book and Onboarding Smoke PASS plus platform Admin and API domain integration, not just an asserted build.

## Release and process
- All changes occur on `staging`; `main` stays production until an approved PR.
- Keep full integration checks on staging, then PR staging → main. Re-align staging to main after merge.
- No new branch or parallel replacement application.
- Preserve the actual running Professional and User applications; the Core cleanup changes only their old duplicate source and host routes, not their API contracts.
- Do not claim live Amvera deployment from GitHub CI; owner deploys Core main via Amvera after merge.

## Naming and guards
Use neutral platform terms: Platform, Tenant, Account, Person, Profile, UEI, Record, Time, Procedure, Finance. Do not introduce profession-specific technical owners.
No shadow owners or duplicate business logic. Enforce server authority for all stored business data.
For Admin capability status: NOT_READY hidden for everybody, TESTING visible to approved testers and owner, READY governed by entitlement. The server readiness owner and Admin catalog stay in Core.

## Owner service Email delivery — 2026-11-07

- Source of truth: `NotificationEventService.createEventForTenantOwner` → `ProfessionalServiceNoticeService.createForTenantOwner` in Core. The existing booking confirmation paths (`server/src/online-booking/booking-flow.controller.ts`, `server/src/account/account-record.service.ts`, `server/src/account/account-contact-record.service.ts`) already create `booking.created` notices for the Tenant OWNER when event routing is enabled.
- Email delivery is now wired to the canonical `TransactionalEmailService` via `TransactionalEmailModule` within `NotificationModule` (Yandex Cloud Postbox; no new SMTP implementation). The recipient is strictly `PlatformAccount.email`, only with `PlatformAccount.emailVerifiedAt IS NOT NULL`; additionally `PlatformNotificationPreference.emailEnabled !== false` for the same tenant and owner. The extra `Profile.emails` never receive account service mail. Missing preference preserves the existing default-on behavior.
- `ProfessionalServiceNotice` and Push remain unchanged. Email send is an independent asynchronous attempt after notice creation: SMTP failure is logged without throwing into the booking path; no new API, schema, or email credential handling. No Email may be sent if owner has not confirmed their current address or explicitly disabled the channel.
- The `booking.created` notification still obeys the existing per-event `NotificationRoutingPolicy.enabled` gate; this change does not bypass an intentionally disabled event. Other owner service notices share the same Email preference.
- Checked statically: provider dependency injection, existing verified-email and preference DB contracts, and five simulated delivery cases (enabled/disabled/unverified/missing email/default-on) PASS. This is **not** a real Postbox SMTP delivery test; delivery requires configured Postbox runtime credentials and a Core deployment. No guaranteed retry/outbox is implemented here.
- Only `co-va/core/staging` changed; `main` and `co-va/professional` / `co-va/user` are untouched. Per release contract, Core is deployed from `main` after approved staging→main PR and explicit release; staging changes alone are NOT production.


## Owner service Email — durable Postbox delivery follow-up (PR #854)
- `ProfessionalServiceNotice` and `ProfessionalServiceEmailOutbox` are inserted in one SQL statement. The new persistent outbox is keyed by notice ID; no duplicate rows for retries.
- The NotificationModule worker uses PostgreSQL `FOR UPDATE SKIP LOCKED` and expiring leases so parallel replicas cannot claim the same pending job. A restarted process reclaims unfinished work; failed jobs receive exponential retry up to 12 attempts and a persisted terminal `FAILED` with redacted error summary.
- Every attempt rechecks current `PlatformAccount.email`, verification and `PlatformNotificationPreference.emailEnabled`; unverified, disabled and missing recipients become `SKIPPED`. `Profile.emails` is never read. Existing Push is unchanged.
- The canonical Postbox SMTP transport is reused, with a stable Message-ID across retries. SMTP acceptance followed by worker crash can still cause a duplicate: **at-least-once attempts, not exactly-once final delivery**.
- No historical notification backfill, so this migration never sends old events. No Postbox secrets are added to the repo. Actual provider acceptance requires a deployed environment with credentials and a confirmed recipient.
- **Release constraint:** staging-only until owner approval; `main` remains unchanged.

## Telegram username in Professional Contacts — 2026-11-08

- В `server/src/communication/communication.controller.ts` добавлен `GET /communications/telegram/contact-usernames?ids=...` под `JwtAuthGuard` и tenant из auth, без изменения основного обмена Telegram.
- В `CommunicationService.telegramContactUsernames` выдаётся только `@username` из `CommunicationIdentity.display` по стабильному Telegram ID, который уже привязан к контакту текущего tenant в BusinessState. Идентификаторы другого tenant/неизвестные, некорректные username и нечисловые ID исключаются, лимит 40 уникальных ID.
- Это presentation-only lookup: ID хранится по прежнему контракту, пользователь видит никнейм; Telegram-бэкенд сам получает username из сообщений, если он присутствует. Если username Telegram не предоставил, API не выдумывает его.
- Изолированная проверка scoped-метода и контроллера (посторонний ID, дубликат, некорректный ввод, отсутствие username, JwtAuthGuard) — PASS. Изменения только в `staging`. Без деплоя/живого e2e и без изменения `main`.

## History: selective entityTypes and indexed Person filter — 2026-11-08

- `server/src/history/history.controller.ts` добавляет **необязательный** Query `entityTypes`, передаваемый как массив в `HistoryService.list`. Существующий `entityType` и доступ к tenant под `JwtAuthGuard,HistoryMembershipGuard` не менялись.
- `server/src/history/history.service.ts` формирует SQL `AND personKey IN(...)` только при запросе `personKeys` вместо необязательного OR-предиката; использует существующий индекс `BusinessHistoryEvent_tenant_person_idx`. Необязательный параметризованный `entityType IN(...)` применяется лишь при переданном `entityTypes`. Остальные запросы History не ограничиваются.
- Professional/Контакты/История запрашивает четыре используемых типа фактов. Цель — уменьшить лишнюю нагрузку и объём ответа, а не просто увеличивать тайм-аут. В реальном окружении сокращение времени ответа пока не измерялось.
- Статические контрактные проверки tenant/auth, параметризации Prisma, сохранения лимитов и совместимости прежних запросов — PASS. `main` не тронут.

## Wallet catalog incident / recovery — 2026-11-08

- Canonical owner is Core `BusinessAuxiliaryState.data.wallets`, not Professional. Previous frontend `getWallets()` could enqueue `PUT /auxiliary-state/wallets` with system-only defaults on cold/partial load, overwriting full catalog. Frontend cold-read is now read-only (in `professional/staging`).
- Core `PUT /auxiliary-state/wallets` is a **non-destructive merge by stable ID** under tenant-scoped advisory lock + serializable transaction; a partial list cannot erase existing IDs. Intentional soft-delete must set `deletedAt`, which stale PUT cannot clear; intentional platform-admin hard-delete uses `FinanceService.hardDeleteWallet()`, which removes the catalog ID in the same transaction and records `walletDeletedIds` tombstone to exclude later recovery. No changes to ledger/payment records unless the already-existing hard-delete action is invoked.
- Authorized `POST /auxiliary-state/wallets/recover` invokes `AuxiliaryStateService.recoverWallets(tenantId)` in one tenant-locked serializable transaction. Sources: complete historical wallet objects from `DataTransferSession.before/after.BusinessAuxiliaryState.data.wallets` (restores unused/test wallets with original appearance and IDs), imported wallet facts `DataTransferFact`, and recorded `walletId+walletName` in `FinanceOperation` / `FinanceLedgerEntry` (for actual payments). Existing and deleted wallet IDs never duplicated; no ID/name inventions; no modifications to financial operations. Returns `wallets`, `recovered` and `unresolvedIds`.
- Professional `Касса` sends POST and hydrates server result; it does not send a synthesized full-list PUT. Server deployment is required before the repair can run on live data. If no snapshot/import/finance evidence exists for an unused wallet, its original ID can only be recovered from an actual DB backup.
- Added `tests/wallet-recovery.test.mjs` to normal `npm test`, covering partial-list merge, original IDs from snapshots, ledger names, imported names, duplicate avoidance, deletedAt and hard-delete exclusions, no fabricated identities. Both repos changed on **staging only**; neither main was touched.

## Финансы → Касса → Состав: единый реестр готовности — 2026-11-08

- **Единственный источник статуса:** Администратор → Инструменты → Кабинет, таблица `AdminToolReadiness`. Коммерческий каталог не участвует в определении готовности и видимости приложения; любые дополнительные проверки `CommercialProduct.readiness` из `SaasAccessService` удалены. Коммерцию и тарифные разрешения как таковые не меняем.
- Иерархия: `Финансы` (F) → `Касса` (E) → **Состав:** `Кошельки`, `Займы`, `Инвестиции`. У каждого отдельный статус в Инструментах: `cabinet.finance.cash.wallets`, `cabinet.finance.cash.loans`, `cabinet.finance.cash.investments`.
- Привязки к существующим capabilities (не новые дублёры): Кошельки → `finance.cash.access`; Займы → `finance.special.access`; Инвестиции → `finance.investment.self/raise/external.access`. Удалена ошибочная привязка Займов к готовности `ДДС`, а Инвестиций — к готовности всей Кассы. У `Кассы` больше нет дополнительного переключателя, управляющего всеми вложениями.
- Переход данных: SQL-миграция `20261108210000_cash_composition_readiness` сохраняет **текущий статус старой Кассы** только для Кошельков, чтобы не пропали рабочие кошельки. Статусы новых элементов Займы/Инвестиции — `NOT_READY` до решения администратора. Прежние разрешения и сохранённые финансовые записи не изменяются.
- `NOT_READY` скрывает элемент у всех; `TESTING` показывает DEMO/тестировщикам/owner; `READY` показывает при наличии существующего разрешения. Проверка едина в `/saas-access/me` и серверном `resolveCapability`.
- В Professional `Касса` остаётся доступной при любом разрешённом вложении, включая ситуацию «разрешены только Займы», и не подменяется названием «Инвестиции». Остальные экраны `ДДС` и `Z-отчёт` не перестраиваются.
- Всё работается в `core/staging` и `professional/staging`. До зелёных CI и выпуска в `core/main` новая карта не считается опубликованной.
