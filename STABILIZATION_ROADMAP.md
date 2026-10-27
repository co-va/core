# CO-VA — Stabilization Roadmap

## Purpose

This file is the single canonical repair queue for bringing the existing CO-VA product to a competitive operational baseline.

The order below is the same order as the owner-facing spreadsheet sheet `Очередь ремонта`. Do not rename items, renumber them, merge them, split them, or skip ahead when continuing this work.

## Continuation rule

1. Read this file.
2. Find the first item that is not `DONE`.
3. Work only on that item.
4. Run its targeted regression plus the repository-required full Check Book.
5. Mark it `DONE` with evidence.
6. Continue to the next number.

No whole-project re-analysis is required between items.

## Status values

- `TODO` — not started.
- `IN PROGRESS` — current item; this is the only item allowed to receive new work.
- `RECHECK` — work was done earlier out of order; it is not considered closed until the current preceding item is DONE and this item is reverified.
- `DONE` — implementation and required checks passed; evidence recorded.

## Guard

- Working branch: `staging`.
- Do not change `main` without explicit owner approval.
- Do not create a new branch for this queue.
- Do not opportunistically fix adjacent contours.
- Do not create parallel UI/domain implementations.
- Existing Shared UI/domain owners remain canonical.
- A file/test existing is not proof that runtime works.
- PR/merge boundaries do not change the queue order.

## Ordered repair queue

### 1. Runtime bootstrap — `DONE`
Goal: first useful Journal screen is not blocked by unrelated full-domain loading.

Result:
- startup receives minimal Profile/Workplace context instead of the full Profile payload;
- full Profile and full Finance load lazily in their owning surfaces;
- Journal keeps only the minimal Finance payment projection required for correct paid/debt state.

Evidence: covered by staging changes and successful Check Book runs recorded below under Journal baseline.

### 2. Profile — `DONE`
Goal: Profile and Workplace remain separate canonical entities even when shown in one UI area; edits persist through a fresh server read.

Result:
- Profile save does not rewrite Workplace;
- Workplace save does not rewrite Profile;
- both survive a fresh server read;
- full Profile remains outside the first-Journal bootstrap.

Evidence: staging `dcc8771b66dfcc57abcde9ce796e1d80f9f779a3`; Check Book `40473273116` — PASS; Record View Account Runtime `40473273103` — PASS.

### 3. Auxiliary split — `DONE`
Goal: remove the shared auxiliary data bag so each owning surface loads only its own data.

Result:
- canonical auxiliary owner now exposes scoped read bundles for People, Loyalty, Service, Finance and Tags;
- runtime caches those scopes independently;
- a partial bundle hydrates only datasets actually returned and cannot clear a neighbouring owner cache;
- Service no longer receives Wallets/Investments/Loans/Tags from its auxiliary read;
- People no longer receives Products/Finance auxiliary data;
- Finance/Cash no longer receives Products/Tags;
- Settings/Tags receives Tags only;
- Loyalty deposit program read uses the Loyalty scope rather than the full auxiliary bundle;
- no second auxiliary owner or parallel business state was introduced;
- regression `tests/auxiliary-split-boundary.test.mjs` is part of the full `npm test` chain.

Evidence: staging `a9f255a32829976549dd04c8936f7d13769f17ee`; Check Book run `40479254564` — architecture/checks PASS, domain regression PASS, Browser FEZ PASS, server build PASS, modal-browser PASS, staging-smoke PASS.

### 4. Journal — `DONE`
Goal: fast, stable Day / Month / List using canonical Record / Event / Note data, with no duplicate headers, parallel UI or unnecessary full entity loads.

Result:
- first Journal load uses canonical Journal data, minimal Profile/Workplace context, Days and the minimal Record payment projection;
- full Procedures, ProcedureHistory and BookingSettings are outside first Journal load and lazy;
- People remains only where current canonical price calculation requires it;
- no parallel Journal UI/domain implementation was introduced;
- Journal regressions were re-run after item 3 completed.

Evidence: prior Journal code `fd06348afc4d156abb1c0ea62a3a544e5a21c64e`; post-item-3 recheck on staging `a9f255a32829976549dd04c8936f7d13769f17ee`; Check Book `40479254564` — PASS including domain regression and Browser FEZ.

### 5. Journal Booking — `IN PROGRESS`
Goal: Journal → Record creation uses one Q-flow with minimal data per step and no full Profile/People navigation.

### 6. Public Booking — `TODO`
Goal: public professional link performs guest Booking only; no App Runtime, mandatory registration or full Profile application load.

### 7. Notifications — `TODO`
Goal: booking-created/rescheduled/cancelled facts reach intended recipients through configured channels, including closed-app delivery where supported, with observable delivery state.

### 8. Persistence / edits — `TODO`
Goal: every existing business edit is confirmed by the server and survives a fresh reload; no local-only success state.

### 9. Data Transfer — `TODO`
Goal: import has preview, mapping, validation, canonical owner writes and a clear result report without hidden duplicates.

### 10. Demo → Live — `TODO`
Goal: a new professional can register, start DEMO, understand calculation/terms, request Live and reach the approved working state without an undocumented detour.

### 11. Finance — `TODO`
Goal: prove Record → payment → Settlement/Operation/Ledger → Cash/DDS/Z end to end before expanding finance features.

### 12. Loyalty / Inventory — `TODO`
Goal: do not add breadth; prove persistence and one complete end-to-end scenario for each existing loyalty and inventory operation.

## Current cursor

**Item 5 — Journal Booking.**

PR #769 is the merge boundary for completed items 1–4. Continuation starts from item 5 without a new whole-project analysis.
