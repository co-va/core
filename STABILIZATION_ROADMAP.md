# CO-VA — Stabilization Roadmap

## Purpose

This is the single ordered queue for bringing the existing CO-VA product to a competitive operational baseline. It is not a feature wishlist.

Do not restart a whole-project analysis when continuing this work. Read this file, take the first item whose status is not `DONE`, verify the current repository state, work only on that item, run its regression checks, update the status/evidence here, and stop at the task boundary.

Benchmark reference: EasyWeek operational baseline for the same user scenarios. The benchmark is used to expose friction, missing reliability, unnecessary loading and dead ends; it does not define CO-VA product architecture.

## Status values

- `TODO` — not started.
- `IN PROGRESS` — current stabilization item.
- `BLOCKED` — cannot complete without a concrete dependency; record it here.
- `DONE` — implementation and required checks passed; evidence recorded.

## Guard

- Working branch: `staging`.
- Do not change `main` without explicit owner approval.
- Do not create a new branch for this queue.
- Do not opportunistically fix adjacent contours.
- Do not create parallel UI/domain implementations.
- Existing Shared UI/domain owners remain canonical.
- A file/test existing is not proof that runtime works.
- Each item is closed only after targeted regression checks and the repository-required full check are green.

## Ordered queue

### 1. Startup / first Journal load — `DONE`
Goal: the first useful Journal screen must not be blocked by unrelated full-domain loading.

Result:
- startup bootstrap no longer computes the Finance projection;
- startup receives only minimal `profileContext` (Profile header fields + Workplace context), not the full Profile/profession/reference payload;
- full Profile is loaded lazily when Profile opens;
- full Finance is loaded lazily when Finance opens;
- regression `tests/startup-journal-load-boundary.test.mjs` is part of the full `npm test` chain.

Evidence: staging `5dd221d32dddf78f0220ec90963e549a75c2e584`; Check Book run `40472015085` — architecture/checks PASS, domain regression PASS, Browser FEZ PASS, server build PASS, modal browser PASS, staging-smoke PASS. Record View Account Runtime run `40472015092` — PASS.

### 2. Profile + Workplaces — `IN PROGRESS`
Goal: Profile and Workplace stay separate canonical entities even when presented in one UI area; Profile opens and edits predictably; full Profile data is loaded only when needed.

Close only when Profile/Workplace reads, edits and persistence survive reload and do not slow unrelated Journal work.

Evidence: pending.

### 3. Journal — `TODO`
Goal: fast, stable Day / Month / List using canonical Record / Event / Note data, with no duplicate headers, parallel UI or unnecessary full entity loads.

Evidence: pending.

### 4. Journal → Booking — `TODO`
Goal: one in-app booking flow from Journal: professional summary → workplace summary (skip if one) → procedure → availability → confirmation; no navigation through full Profile/People cards.

Evidence: pending.

### 5. Public Booking — `TODO`
Goal: professional public link performs guest Booking only; no App Runtime, registration or full Profile application load; booking completes and appears in Journal.

Evidence: pending.

### 6. Notifications — `TODO`
Goal: booking-created / rescheduled / cancelled facts reach the intended recipient through the configured channel, including when the app is closed; delivery state is observable.

Evidence: pending.

### 7. Persistence + Data Transfer — `TODO`
Goal: existing edits survive fresh reload, and Data Transfer clearly previews, validates, imports and reports what happened without hidden duplicates.

Evidence: pending.

### 8. Demo → Live / commercial path — `TODO`
Goal: a new professional can register, start DEMO, understand the calculation/terms, request Live and reach the approved working state without an undocumented admin detour.

Evidence: pending.

## Later parity gaps (after 1–8)

Do not start these while P0 stabilization above is unfinished:
- broader analytics/read model;
- mature staff/team management;
- marketplace/site-builder breadth;
- additional third-party integrations beyond the integrations required by real users.
