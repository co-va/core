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
