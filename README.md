# CO-VA Core — Platform and API

Source of truth for the platform, server API, database, platform Admin and public landing. This is **not** the Professional or User frontend.

## Repository owners
| Repository | Owner | Deployment |
| --- | --- | --- |
| `co-va/core` | NestJS API, PostgreSQL/Prisma, platform Admin and public landing | Amvera `va-app` from `main` |
| `co-va/professional` | Professional frontend, working tools, PWA and guest Booking interface | `staging` → `prof.va-tools.ru` |
| `co-va/user` | User frontend and PWA | `staging` → `user.va-tools.ru` |

## Contracts
- `server/src/**`: API, canonical Record/Time/Finance/People, identity, messages, notifications, consents, documents, platform administration and authentication.
- `server/prisma/**`: database schema and immutable migrations.
- `admin/**`: platform administration, commercial catalogue, document registry, tool readiness and Admin sign-in/password recovery.
- `landing/index.html`: platform public landing, with sign-in and invitations on the Professional origin.
- `core/**` and `ui/**`: only explicit Admin/landing dependencies and server-imported pure shared rules. No application runtime or global workspace shell.

The server Online Booking endpoints are API; the removed `online-booking/**` directory was an obsolete **browser frontend**. Deleting browser files does not delete Record, identity, Time, booking, consent or notification data.

## Build and checks
```sh
npm run check
npm test
node scripts/build-pages.mjs
docker compose -f docker-compose.staging.yml build backend
```

`scripts/build-pages.mjs` packages platform assets only. `scripts/check-platform-only-boundary.mjs` rejects reintroduced Professional/User UI and guest Booking browser entries. The backend image preserves the Prisma schema and shared pure server rules.

## Branch policy
Only `staging` for development and validation; `main` for approved production changes. No automatic merge or overwrite of concurrent work. Validate the full Core API/Admin/landing regression before moving `staging` to `main`, then align branches. Current architecture and handoff constraints are in `PROJECT_STATE.md`.

## Domains
- Core API: `api.va-tools.ru`
- Core Admin: `admin.va-tools.ru`
- Core landing: `va-tools.ru`
- Independent Professional: `prof.va-tools.ru`
- Independent User: `user.va-tools.ru`
- Retired `app.va-tools.ru`: browser redirect only, not a second app.
