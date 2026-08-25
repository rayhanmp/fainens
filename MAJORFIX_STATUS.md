# Major-fix implementation status

Branch: `majorfix`

This file is the durable hand-off for the implementation wave driven by `BUG_AUDIT.md`. It records what is actually committed, what behavior changed, verification limits, compatibility notes, and what remains. An audit item is not considered fixed merely because adjacent code changed.

## Committed waves

### `29480cb` — audit context

- Added the full systematic finance-integrity audit in `BUG_AUDIT.md`.

### `135669b` — journal invariants

- Reject journals with fewer than two lines.
- Require each line to contain exactly one positive debit or credit.
- Require positive, equal, safe-integer totals.
- Removed invented auto-income/auto-expense balancing plugs.
- Made the default SQLite journal header, lines, and persisted-total verification one synchronous `better-sqlite3` transaction; tags and audit joined that boundary in `d1b03c1`.
- Removed subscription schedule mutation from the generic journal primitive.

### `c646974` and later migration commits — checked migrations and legacy-data preservation

- Startup runs checked-in Drizzle migrations and fails closed on an incomplete schema.
- Legacy databases created by `drizzle-kit push` are upgraded in place and baselined without deleting user data.
- Blank databases and versioned databases use the normal forward migration path.
- Added schema gates for the cleanup outbox, reconciliation, and recurring occurrences.

### `42da4e0` — reports

- Strictly validates report IDs, timestamps, paired ranges, range order, and trend count.
- Uses inclusive selected-day/period ends.
- Fixed historical retained earnings with an epoch start.
- Cash-flow CSV is no longer empty.
- CSV fields are quoted and formula-neutralized without corrupting numeric negatives.
- Trends fail visibly instead of silently dropping failed periods.
- Spending percentages reconcile to the returned positive total.

### `839b103` — update/delete integrity

- Transaction metadata, balanced line replacement, tags, and audit are one SQLite transaction.
- Updates invalidate old and new accounts and periods after commit.
- Single and bulk deletion are atomic; bulk is all-or-nothing.
- Generic mutation rejects domain-owned salary, subscription, reconciliation, loan, PayLater, split-bill, wishlist, and linked-chain entries.
- Generic deletion no longer bypasses loan-payment safeguards by deactivating loans.
- Attachment keys are placed in a durable cleanup outbox before metadata is removed.
- Added a checked migration containing missing pushed-schema drift and `transaction.subscription_id`.

### `e3af6da` — attachment lifecycle

- Confines all local object keys below the attachment directory on upload/read/delete.
- Rejects traversal, absolute paths, malformed URL encoding, and null bytes.
- Direct attachment deletion commits metadata removal, audit, and cleanup work atomically.
- Storage failures remain retryable and visible instead of losing the object key.
- Strict base64 validation; empty content is rejected.
- Uploaded objects whose metadata commit fails are queued as orphan cleanup.

### `d1b03c1` — compound creation and canonical IDR

- Removed module-global system-account ID caches and re-selects in the current DB executor.
- Bulk CSV import is a real synchronous all-or-nothing SQLite transaction with one invalidation.
- Pending approval atomically posts a balanced journal and changes pending status.
- Wishlist fulfillment atomically creates a balanced expense, updates the wishlist, and audits both.
- Canonical ledger unit is integer rupiah at corrected import/pending/onboarding/split-bill boundaries; no new `* 100` conversions there.
- Added a strict Indonesian-rupiah parser and tests.
- Future-dated entries no longer affect current account balances, burn rate, or trial balance.
- Journal creation invalidates only after its own commit; transaction-scoped callers do not start pre-commit cache work.

### `762a412` — reconciliation controls

- Reconciliation is now a durable session plus per-account items at an explicit as-of timestamp.
- Supports both asset and liability normal-balance semantics and preserves negative balances.
- A zero difference records durable evidence and creates no journal.
- A nonzero difference is `needs_classification`; it does not manufacture income or expense.
- Frontend uses signed, finite whole-rupiah inputs and stays open on unresolved differences.
- Reconciliation mismatches no longer enter ordinary P&L, spending, savings-rate, or AI inputs.

### `a9c7f00` — recurring occurrences and return after absence

- Subscription GET is read-only and returns missed-occurrence previews.
- Users explicitly post or skip exact dated occurrences; no page view or startup catch-up creates charges.
- Each occurrence has a unique SQLite identity and is claimed with its journal and schedule advancement in one transaction.
- Month-end dates clamp correctly (Jan 31, leap years, annual Feb 29).
- Invalid subscription amounts/accounts/categories are rejected at write time.
- Direct subscription schedule advancement and generic `subscriptionId` transaction posting are disabled.
- Subscription deletion archives the schedule, preserving occurrence/transaction provenance.
- Salary uses a durable logical monthly occurrence. Scheduler calls are detection-only; the explicit route confirms posting.
- Payroll day 31 means the last valid day of a short month.
- Existing legacy salary transactions prevent a duplicate current-month occurrence.
- The subscriptions UI offers explicit “post confirmed” versus “skip and resume” catch-up actions, capped at 120 occurrences per batch.

### `46f3e43` — insight and frontend report consistency

- Every transaction invalidation clears `insights:*` as well as account/period/analytics keys.
- Insight cache values store original `generatedAt`; legacy plain strings are not relabeled as fresh.
- Redis wildcard deletion uses `SCAN`, not blocking `KEYS`.
- AI cards clear on scope change and ignore out-of-order cached/generation responses.
- Dashboard prompts now include income, spending, savings rate, wallet scope label, burn, forecast, top category, largest transaction, and weekly transaction facts.
- Monthly report data is cleared when the selected period changes or generation fails; stale-period downloads are disabled.
- Spending charts aggregate omitted categories into a disclosed `Other` slice.

## Data compatibility

- Existing data is not intentionally deleted or globally rescaled.
- New code treats stored monetary integers as whole rupiah, matching the dominant UI, salary, formatting, and manual-entry behavior.
- Historic 100× outliers remain a data-quality task: they must be detected and reviewed, not blindly divided because legitimate large transactions exist.
- Old reconciliation plug transactions remain historical ledger entries. They should be identified and reversed/classified through an explicit migration tool; the new reconciliation path does not add more.
- Domain-owned transactions are deliberately blocked from generic edit/delete until their owning reversal workflows are implemented.

## Verification completed

- Backend TypeScript build passes using the bundled runtime.
- Frontend TypeScript project build passes.
- Focused pure suite currently passes 49 tests across journal validation, mutation policy, IDR parsing, reconciliation math, recurrence calendar behavior, report CSV behavior, and storage path confinement.
- The complete DB-backed suite is still blocked locally because installed `better-sqlite3` targets Node ABI 127 while the bundled Node runtime requires ABI 137. Do not treat this environment failure as a test pass.

## High-risk work still open

1. Add a durable monotonic financial-data revision and revision-aware cache values/outbox. Explicit invalidation is improved but Redis failure can still preserve stale values.
2. Rewrite PayLater recognition, interest, installment allocation, and settlement as one transactional subledger command; enforce exact principal/interest/fee allocation and control-account reconciliation.
3. Rewrite loan create/payment/write-off/delete flows to remove async SQLite transaction callbacks, make journal/subledger changes atomic, and add owning reversals.
4. Replace split-bill per-person posting with one receipt-level balanced command and deterministic largest-remainder allocation. The immediate 100× and borrowed-journal defects are stopped, but the paid-by-user multi-loan flow can still duplicate the personal expense.
5. Add posted/reversed/reversal-link state, immutable posted journals, period close/reopen, and domain reversal endpoints.
6. Complete period overlap/gap prevention, `period_id` foreign-key migration, period delete/archive policy, and one shared membership function across reports/budgets/insights.
7. Replace cash-flow inference: distinguish cash-equivalent assets from receivables/investments and classify every line of multi-line journals.
8. Replace insight/dashboard transaction-credit heuristics and 100-row frontend subsets with shared backend financial-fact DTOs.
9. Add category-to-reporting-account/allocation semantics so P&L, category spending, budgets, PDFs, dashboard, and agent queries reconcile explicitly.
10. Add a money-anomaly review endpoint/migration for likely historic 100× records and old reconciliation plugs.
11. Finish safe account/category/period/contact/template archive dependency previews and restore flows.
12. Fix remaining rate-limit scope wiring and add route-level injection tests.
13. Build read-only agent query/planning tools over the shared facts, then guarded preview/approval/idempotency for agent-proposed writes.
14. Run blank-DB migration integration, legacy-copy migration integration, and full DB-backed tests with a compatible native SQLite binary before merge.

## Merge policy

Do not merge `majorfix` while the high-risk loan/PayLater/split-bill flows still bypass compound accounting invariants. No migration in this branch requires wiping the database, but a backup and migration rehearsal on a copy are mandatory before production deployment.
