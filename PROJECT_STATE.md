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
- Completion requires fresh Check Core and Onboarding Smoke PASS plus platform Admin and API domain integration, not just an asserted build.

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

## Procedure / services: deleted booking and per-workplace free price — 2026-11-10

- The backend keeps the canonical technical domain `Procedure`, `BusinessOperationalState.procedures`, `ProcedureService.snapshots` and immutable Record history. Professional UI uses the display label «Услуги»; no data-key or schema migration.
- `server/src/procedure/procedure.service.ts::publicBookingCatalog` now excludes any current procedure with `deletedAt`. Such a service cannot appear in the public booking catalog.
- `ProcedureService.snapshots` rejects current deleted procedures even when an outdated guest/client attempts booking with their ID; historical Record facts remain stored; historical catalog entries never authorize new bookings.
- `costSourceFor` prioritizes the workspace's explicit `cost.free === true` over a nonzero global/base price, including when the workspace cost has no numeric fields. Other workspaces preserve their prices; missing workspace overrides still inherit the base price.
- Regression test: `tests/procedure-booking-contract.test.mjs`, integrated into the existing root `npm test` (no new CI workflow). Checks deleted filtering, booking rejection, free vs paid workplace, inherited base price, missing assignment, saved Record snapshot.
- Only `co-va/core/staging` changed. No changes to the Professional/User frontend, `main`, DB/Prisma, historical Record rows or external APIs. Live API/Amvera execution still requires deployed Core release; isolated contract tests do not prove production behavior.

## Canonical display-ready service price from Core — 2026-11-10

- The service price source is the current `ProcedureService` pricing contract, including the selected workplace override and price mode `amount`, `from`, `from-to` and `free`. In `from-to`, use the first/lower `from` even if a stale `amount` is also present. In `from`, retain the prefix even when the value is stored in `amount`.
- `ProcedureService.bookingPriceFor` produces one result: `{ minimum, variable, free, display }`. `display` is presentation-ready: `от 1 500 ₽`, `3 000 ₽`, `Бесплатно` or `Цена уточняется`. Source numbers remain numeric and valid for finance or combining multiple services.
- Both the guest `OnlineBookingService.getContext` and authenticated account/contact `AccountContactRecordService.context` use `ProcedureService.publicBookingCatalog`. The duplicate account-specific price calculation was **removed**. The Account API retains its `price` field name and transparently sends the canonical `display` alongside existing numeric flags; guest API keeps `bookingPrice`.
- New canonical Record snapshots carry `priceText` with exactly that display string, separate from numeric `cost` for settlement. Historical Record data remains unchanged. No DB migration or second pricing owner.
- `tests/procedure-booking-contract.test.mjs` covers fixed prices, `from` stored via `amount`, `from-to` lower price, stale `amount`, workplace overrides and free, deleted services, historical snapshots and the no-duplication guard for account booking. Run via existing `npm test` / Check Core.
- `co-va/user/staging` already preserves and prefers the returned `price.display` in `recordProcedurePriceText`. `co-va/professional/staging` guest booking now renders `bookingPrice.display` for catalog and single-service confirmation. Only combination totals may aggregate the server-provided numeric minima; they must not re-interpret `from/to` modes.
- Scope: `co-va/core/staging` and narrowly necessary guest-booking presentation in `co-va/professional/staging`. No `main` changes. Live behavior requires deployment of the Core backend from an approved release.

## Record: единый действующий прайс — 2026-11-10

- Единственный действующий прайс — `BusinessOperationalState.procedures`. Любая новая запись, включая ручной ввод прошлой даты, использует этот каталог и проверяет активность услуги и назначение рабочему пространству. Дата визита не выбирает другой прайс.
- Удалены `catalogAt`, `historicalMoment` и передача даты в `ProcedureService.snapshots`; история изменений и импортированных фактов остаётся историей, не источником доступности для новой записи.
- При создании записи цена подтягивается из действующего прайса. Сохранённая услуга и её стоимость принадлежат самой записи; профессионал может вручную изменить стоимость. Удаление услуги из каталога не отменяет существующую запись. При редактировании или переносе сохранённые услуги берутся из Record; только новые добавленные ID проверяются по текущему каталогу. Исторические Record и Finance не переписываются.
- Регрессия в `tests/procedure-booking-contract.test.mjs`: единый прайс без поиска истории, сохранённые услуги после удаления из каталога, ручное изменение цены, перенос, добавление новой услуги, защита удалённых/не назначенных ID, цены «от» и бесплатные услуги.
- Только Core; Professional/User, схема БД и production-данные не изменены. Выпуск отдельным PR #863 к main после зелёных проверок и разрешения владельца.

### Canonical Professional card projection to User — 2026-11-11
- Professional has nine rows, three cells per row (`left/center/right`). Core now filters visible fields at the actual cell level, preserving Professional geometry/colors/photo and the allowed field values.
- One shared `publicCardAppearance` projection is used for profile, workplace and assigned program cards. No duplicate layout, no invented User fields, no private Person fields.
- Historic single-field rows remain accepted as input; unauthorized keys are cleared before delivery.
- Test: `tests/account-contacts-card-projection.test.mjs`. Staging only; main requires explicit authorization.

## Account presence (2026-11-11, staging only)
- Canonical per-membership `TenantAccountPresence` timestamp. A migration creates the table and cascade-deletes it with its membership. No account profile or last-login state is repurposed.
- Authenticated `POST /auth/presence` verifies JWT plus actual tenant membership, then upserts a timestamp. Activity from separate tabs is additive; no logout writes a false offline flag.
- Professional sends foreground-only heartbeat every 45 seconds. A signal less than 120 seconds old means online. Timed out/background/closed sessions expire without a network disconnect event.
- Admin reads the presence under the **Доступ** column and displays two lines. Without the new API presence field the second line is omitted, not replaced with a fabricated placeholder.
- User and guest booking do not use the Professional presence endpoint. Backend migration and deployment are prerequisites to production availability; staging changes do not deploy Core production.

## Unified account duration (2026-11-11, staging)
- Extend the **same** `POST /auth/presence` heartbeat and `TenantAccountPresence`. There is no second presence endpoint, worker, client timer or browser recorder.
- Serialise membership updates using a DB row lock; update the last seen timestamp and cumulative milliseconds together. Credit only gaps under 120 seconds; split credited gaps into `TenantAccountPresenceDay` UTC date buckets for future daily/monthly reporting. Multiple browser tabs cannot double count elapsed time.
- Retain `AUTH_LOGIN_SUCCEEDED` as the separate immutable security/login audit (not a presence calculation). No legacy competing online-duration implementation was found in the current staging code.
- The incremental migration `20261111160000_account_online_duration` preserves the already-created presence table migration/checksum. Aggregate durations start at first recorded heartbeats after this migration; historical time cannot be reconstructed from old login events.

## Admin inline tester and network column — 2026-11-11 (staging)
- The Users tables have six columns: identity, role, commercial mode, plan, access, and dedicated online presence. The role cell offers an inline two-option tester selector, using the existing `PUT /saas-admin/tenants/:tenantId/access` contract with `{isTester}`. No duplicate tester API or second role record.
- Network status, cumulative credited time and last visit are projections of the canonical `TenantAccountPresence` record. Registered users without heartbeat display offline, not a fabricated online status; a Core version without the presence contract displays only a neutral dash.
- The pre-existing 30-second Admin poll on the Users section fetches only /tenants and patches online cells, preserving active inline selectors, generated registration links and account-modal context. Other Admin sections keep existing refresh logic.

## Previously published main release notes preserved during branch reconciliation

## Core service pricing release — 2026-11-10

- Scope: only the NestJS Core API, not a Professional/User frontend. The active `server/src/online-booking/**` is the canonical booking API; legacy browser `booking.html` and old application entrypoints are prohibited by `scripts/check-platform-only-boundary.mjs`.
- `ProcedureService` is the single owner for workplace-specific price selection and ready-to-render `bookingPrice.display`. `amount` emits a fixed price; `from` and `from-to` emit the first price with the «от» prefix, including when a stale secondary `amount` exists; `free` emits «Бесплатно». Numeric minima remain separate for Finance and aggregate quotes.
- Public booking, authenticated account/contact booking and new Record snapshots reuse that server owner. The redundant account price implementation was removed. Deleted services are excluded from new bookings while historically dated Record snapshots remain available.
- Regression test: `tests/procedure-booking-contract.test.mjs`, included in root `npm test`. No new database schema or data migration.
- Removed unused legacy-brand metadata: CI workflow title `Check Core` and NestJS package name `co-va-core-api`. Historical migration names, PostgreSQL role/database identifiers and live env credentials MUST NOT be renamed during this release; they are storage compatibility identifiers, not a duplicate Book app.
- The release branch is based on current `main` to retain the independent Profile/loyalty API and readiness features from PR #860/#861. Unapproved Admin UI work still in `staging` is intentionally not included. Professional and User repos are not changed by this release.
- GitHub passing checks verify source/isolated backend only; the active Core runtime requires its normal Amvera deployment before these API changes are live.

## Record: единый действующий прайс — 2026-11-10

- Единственный действующий прайс — `BusinessOperationalState.procedures`. Любая новая запись, включая ручной ввод прошлой даты, использует этот каталог и проверяет активность услуги и назначение рабочему пространству. Дата визита не выбирает другой прайс.
- Удалены `catalogAt`, `historicalMoment` и передача даты в `ProcedureService.snapshots`; история изменений и импортированных фактов остаётся историей, не источником доступности для новой записи.
- При создании записи цена подтягивается из действующего прайса. Сохранённая услуга и её стоимость принадлежат самой записи; профессионал может вручную изменить стоимость. Удаление услуги из каталога не отменяет существующую запись. При редактировании или переносе сохранённые услуги берутся из Record; только новые добавленные ID проверяются по текущему каталогу. Исторические Record и Finance не переписываются.
- Регрессия в `tests/procedure-booking-contract.test.mjs`: единый прайс без поиска истории, сохранённые услуги после удаления из каталога, ручное изменение цены, перенос, добавление новой услуги, защита удалённых/не назначенных ID, цены «от» и бесплатные услуги.
- Только Core; Professional/User, схема БД и production-данные не изменены. Выпуск отдельным PR #863 к main после зелёных проверок и разрешения владельца.

## Admin online presence and last visit — 2026-11-11
- Admin **also** reports its own authenticated presence using the existing `POST /auth/presence` (the same Core record used by Professional). `admin/presence.js` sends the signal on foreground entry / every 45 seconds, never blocks login, and stops on logout, login-screen entry or connection failure.
- On the first successful foreground signal, only the Users network cells refresh; the existing 30-second poll keeps them up to date without recreating the whole page. Background tabs skip both heartbeat and network polling.
- The **В сети** column renders the state first, then one concise line: `DD.MM.YY HH:MM — N ч M мин`. Dates come exclusively from the canonical `TenantAccountPresence.lastSeenAt` and duration from that record's `totalOnlineMs`. If under 1 minute or no proven visit, no duration is claimed. Never render `Учтено: менее 1 мин`, and do not invent historical visits from account creation or login audit.

## Preview Admin presence: allowed auth-only telemetry — 2026-11-11
- The official Admin staging preview host `va-app-volokovykh.msk1.amvera.tech` formerly returned 405 to every `POST /auth/presence`, so users were permanently shown as offline even with an open preview. The client already used the canonical heartbeat; refreshing the page could not work.
- `stagingPreviewMiddleware` now passes through exactly `POST /auth/presence`, leaving the downstream `JwtAuthGuard` and tenant membership validation intact. The same Core presence timestamp and duration are updated; no new session mechanism or unprotected write is added.
- All other business mutations in preview remain blocked with 405. An unauthenticated preview heartbeat must receive 401; domain smoke and staging-preview test protect both invariants.
- The Professional frontend already emits to the same canonical endpoint independently. No changes to Professional/User and no assumption that this preview fix proves Professional Amvera connectivity.

## Admin registration-link UX — 2026-11-11 (staging)
- Users screen order: **Регистрационная ссылка → Мой аккаунт → Все пользователи**. Registration is one compact white strip; its left interactive surface opens the existing tool hierarchy. No secondary «Настроить инструменты» button, selected-count caption, or instructional paragraphs.
- «Создать ссылку» is disabled until the tool modal applies a nonempty selection. The button then posts the saved key list directly to the existing `/saas-admin/invitations/link`; it never opens the modal, never emits a red validation error while disabled, and shows the copyable result only after successful server creation. Actual server errors remain visible.
- Staging preview had a write gateway that blocks all business POSTs. Its sole additional approved exception is authenticated `POST /saas-admin/invitations/link` (downstream JwtAuthGuard + PlatformAdminGuard). No general preview writes, tenant-access edits or other mutations. The frontend flows are available in staging without Amvera rebuild; this gateway exception requires a one-time Core server deployment before live preview can create invitations.

## Admin Document Registry — 2026-11-11 (staging only)
- One continuous three-section layout matching Users: **Кабинет / Professional**, **Записи / User**, **История**. The registry has no separate Registry/History tabs, redundant explanatory cards, or duplicate title.
- Existing six platform-to-Professional source documents plus the Roskomnadzor helper for the Professional (the data operator) appear in the first section. The three User booking consent document bases appear in the second. No document keys, signed copies, or backend ownership models are altered.
- Existing signing events from both subject types remain together in the third block; the source app (Professional/User), subject email, action, date and immutable version remain visible.
- Lists reuse Admin Users' graphite section titles, white `admin-card`, `admin-table` and compact rows, with a small document icon. Large `documentTile` previews are not used in Admin.
- Opening any catalog document or signed historical snapshot uses the same Admin right-side white drawer as tools, wider for readable text, with internal vertical scroll. Mobile uses the shared Q modal. The global document viewer remains unchanged for other applications.
- The first two sections render without awaiting the history API; only the History block is updated when that request finishes, and history API failure does not hide the documents.

## Admin registry semantics and persisted versions — 2026-11-11 (staging)
- Purpose is distinct from signature state. Four Professional onboarding materials are marked “Обязательно” based on canonical requiredForRegistration; marketing and public-profile consents “Необязательно”; RKN helper “Справочный”. User privacy policy “Ознакомление”, User PDN consent “Обязательно”, User marketing “Необязательно”. No fake signed or unsigned claims.
- Keep **two physically separate lists**, NEVER combine the documents into one list: **Кабинет / Professional** contains 6 legal documents + 1 RKN instruction; **Записи / User** contains 3 legal bases. История remains an independent third section. 10 canonical documents total, but not a unified 10-row section.
- Admin registry retains separate Professional (6 legal + RKN) and User (3) sections. Their compact 44px rows are ordered **Документ / Версия / Назначение / icon**, with the document-open button in the final narrow column. The independent History table uses **Документ / Версия / Аккаунт / Дата / Событие / icon**, with source record title rendered in abbreviated form and each datum in one row. On mobile, the wide History grid scrolls horizontally rather than creating giant multi-row cards. Version numbers are explicitly dark, semi-bold tabular digits (not muted grey). Header remains **Документ**, not Название. Document icons are only on the right. No document-number column is introduced. Short labels are Admin UI only; original legal titles, document bodies, signing snapshots and history event fields are preserved.
- Legal editions (e.g. `1.1`, `1.2`) are extracted from the explicit `Редакция N.N` in the Admin-owned source document header; otherwise show “—”. The technical sequential `PlatformDocumentVersion.version` is **not** the legal edition and must never be presented as such. If guarded GET `/saas-admin/document-registry/current` is available, take legal edition and reader content from the latest persisted snapshot instead; if this endpoint is unavailable on preview, display known source editions without discarding them. Existing legal signing history continues to preserve technical archive versions separately.
