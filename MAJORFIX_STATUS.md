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

### `56e07a4` — posted-journal lifecycle, period guards, and modular agent tools

- Added checked migration `0008` for `transaction.status` (`posted`/`draft`/`reversed`) and `reversal_of_tx_id`; legacy databases are upgraded in place.
- Posted journals are immutable through generic edit/delete routes. The transaction UI offers an explicit equal-and-opposite reversal, preserves the original, and links both entries for auditability.
- Period creation/update rejects overlapping ranges; period deletion preserves periods with posted transactions or budget plans instead of cascading away history.
- Canonical facts, account balances, trial balance, reports, budgets, analytics, reconciliation, and PayLater summaries exclude draft journals.
- Added an authenticated read-only agent registry with independent tools for facts, budgets, account balances, loans, PayLater, recurring previews, transaction search, reconciliation status, period listing, and budget-plan previews.
- The LLM query route uses OpenRouter function/tool calls, executes only the allow-listed read-only tools, returns tool calls/results and financial revision, caps calls/rounds, and never mutates data. The compatibility context endpoint is composed from those same tools.
- Added frontend API access to discover tools and call a single tool directly. Budget planning remains a preview and explicitly reports that no write occurred.

### `e4e64f7` — canonical retrieval, cache races, frontend scope, and absence recovery

- Agent retrieval is now a small allow-listed read-only registry: financial facts and transaction search return canonical ledger facets (income, expense, debit, and credit) rather than largest-line or `txType` guesses. The LLM may select these tools directly; no special write function is exposed.
- Dashboard and salary-income views use canonical facts, deterministic full pagination, explicit scope/request guards, and completeness warnings. CSV export uses signed amounts and formula-safe escaping. Category filters are URL-backed and chart aggregation discloses `Other`.
- Reports use the newest period by default, inclusive selected-day boundaries, canonical all-period posted history, and guarded preview/download state. Cash-flow classification considers all counterparties and excludes loan receivables from liquidity.
- Insight payloads carry their source revision; AI cards display provenance. Net-worth comparisons use the exact as-of date, and the lifestyle metric is labeled as an average spending ratio rather than marginal propensity to consume.
- Cache precomputation refuses to publish a result if the financial revision changes mid-read. Empty queries and old runway cache shapes are handled safely; zero burn is represented as `runwayMonths: null` with `isUnbounded: true` instead of an ambiguous JSON infinity/null.
- Salary now has a read-only catch-up preview plus explicit post/skip occurrence actions, including a requested historical occurrence date, so a user returning after months away can recover missing payroll without page-load side effects.
- Account deletion now blocks system accounts, non-zero balances, and parents with children. Budget and period queries use the same assigned-or-date scope and full-day semantics.

### `73dda39` — period close/reopen and historical-write locks

- Added migration `0009`: salary periods have `open`/`closed` state and close/reopen timestamps. Legacy pushed-schema databases receive the new columns safely during baseline.
- Closing and reopening a period are explicit, revision-bumping, audited actions. A period cannot be renamed, retimed, or deleted while closed; closing also requires resolving drafts in its date range.
- The ledger resolves the actual period from a journal date and rechecks it inside the SQLite posting transaction, so a supplied period ID cannot bypass a closed historical range.
- SQLite triggers block every direct insert or date/period reassignment into a closed period, covering CSV imports and domain workflows that do not use the generic ledger helper.
- Budget create/update/delete/template-apply paths reject closed periods. The Periods and Budget screens expose the closed state and make history visibly read-only until an explicit reopen.

### `7dfffe7` — reconciliation control-evidence lifecycle

- Reconciliation remains a dated control snapshot rather than a financial transaction. Recording a balance check no longer bumps the financial-facts revision or invalidates reports, balances, budgets, and insights.
- Added migration `0010`: sessions carry an `active`/`voided` lifecycle, void timestamp, and required reason. Legacy pushed-schema databases are upgraded without deleting reconciliation evidence.
- A mistaken check is voided through an audited endpoint; it is not deleted and no journal reversal is created. History and agent retrieval retain the original outcome, void state, reason, and item-level evidence.
- The reconciliation dialog exposes recent checks and supports an explicit reasoned void action.

### `ab25abe` — contact archive integrity

- Contact archive is now an atomic, audited operation that refuses to hide a contact with active outstanding loans. A contact can be restored explicitly without deleting historical loan records.

### `7db8b0f` — budget-template archive lifecycle

- Budget-template archival is now audited, idempotently guarded, and reversible through an explicit restore action. Inactive templates can be deliberately retrieved for archive-management views without appearing in ordinary template pickers.

### `69a77fc` and `57b5d8f` — owned correction workflows (recurring and loans)

- Salary and subscription corrections require a reason and atomically create an inverse journal plus a replacement journal, then move the durable recurring occurrence to the replacement. They default to the current accounting period; a closed historical period remains protected unless explicitly reopened.
- Generic transaction reversal now refuses salary, subscription, PayLater, loan, and split-bill journal types, so it cannot silently desynchronise a domain subledger.
- Loan payments now carry a durable posted/reversed lifecycle. Reversing a payment creates the linked inverse journal, restores the principal to the loan balance, reopens a fully paid loan when appropriate, and audits both the payment and loan state. Legacy databases gain the fields through migration `0011` without data deletion.

### `8392388` and `6d6912b` — owned correction workflows (PayLater and split bills)

- PayLater settlements now persist exact installment allocations in migration `0012`. Reversal restores each allocated installment amount before it posts the inverse journal; a legacy partial settlement without allocation evidence is deliberately refused instead of guessed. Recognition reversal is allowed only after its posted interest/settlements are unwound, and cancels the untouched schedule. Obligation retrieval now ignores reversed roots and children.
- A loan's original event can be reversed only before a repayment or status change; it is then archived rather than deleted. A split-bill journal can likewise be reversed only while every derived loan remains untouched; all derived loans are atomically archived with the inverse journal. These dependency rules preserve audit history and prevent orphaned balances.

### `ac6c782` — period identity and consistent scope membership

- Migration `0013` makes `transaction.period_id` a restrictive foreign key to `salary_period`. It retains all journals and converts only dangling legacy IDs to the existing unassigned (`NULL`) fallback before rebuilding the table; required transaction indexes are explicitly restored. Startup fails closed if the FK is absent.
- Reports, canonical financial facts, budget facts, cached period summaries, and agent transaction search use the same assigned-or-legacy membership predicate. An assigned journal in another period can no longer leak into a selected period merely because its date overlaps; legacy null assignments remain eligible only through each consumer's date range.

## Data compatibility

- Existing data is not intentionally deleted or globally rescaled.
- New code treats stored monetary integers as whole rupiah, matching the dominant UI, salary, formatting, and manual-entry behavior.
- Historic 100× outliers remain a data-quality task: they must be detected and reviewed, not blindly divided because legitimate large transactions exist.
- Old reconciliation plug transactions remain historical ledger entries. They should be identified and reversed/classified through an explicit migration tool; the new reconciliation path does not add more.
- Domain-owned transactions are deliberately blocked from generic edit/delete until their owning reversal workflows are implemented.
- The `0008` migration adds posted/draft/reversed state without deleting transaction rows; existing rows are treated as posted and remain available for reversal.

## Verification completed

- Backend TypeScript build passes using the bundled runtime.
- Frontend TypeScript project build passes.
- Drizzle migration journal/schema integrity check passes, including migrations `0009` and `0010`.
- Focused recurrence/reconciliation suite passes 8 tests after the latest wave; an earlier broader pure run passed 49 tests across journal validation, mutation policy, IDR parsing, report CSV behavior, and storage path confinement.
- The complete DB-backed suite is still blocked locally because installed `better-sqlite3` targets Node ABI 127 while the bundled Node runtime requires ABI 137. Do not treat this environment failure as a test pass.

## High-risk work still open

1. Make the revision/cache path durable across Redis outages with an outbox/rebuild worker; revision-aware values now prevent silent stale reads when the database is reachable.
2. Complete a formal period archive/restore policy for metadata itself. Transaction identity and shared read-side membership are now enforced; closed periods are already immutable, but a separate archival lifecycle is not yet needed or modeled.
3. Replace remaining cash-flow inference: persist cash-equivalent/receivable/investment subtype metadata and classify every line of multi-line journals. Loan receivables are excluded from liquidity now, but other non-cash asset subtypes remain to be modeled.
5. Add category-to-reporting-account/allocation semantics so P&L, category spending, budgets, PDFs, dashboard, and agent queries reconcile explicitly.
6. Add a money-anomaly review endpoint/migration for likely historic 100× records and old reconciliation plugs.
7. Finish safe account/category archive dependency previews and restore flows. Contacts and budget templates now have audited restore paths.
8. Add route-level rate-limit injection tests; audited expensive routes now use the intended scope configuration.
9. Extend the agent layer with guarded, idempotent write previews/approval tokens; current tools are intentionally read-only.
10. Run blank-DB migration integration, legacy-copy migration integration, and full DB-backed tests with a compatible native SQLite binary before merge.

## Merge policy

Do not merge `majorfix` while the high-risk loan/PayLater/split-bill flows still bypass compound accounting invariants. No migration in this branch requires wiping the database, but a backup and migration rehearsal on a copy are mandatory before production deployment.
