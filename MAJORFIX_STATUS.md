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
- Added an authenticated read-only agent registry with independent tools for facts, budgets, account balances, loans, PayLater, recurring previews, transaction search, reconciliation status, period listing, budget-plan previews, safe arithmetic, date/time calculations, category spending, exact journal provenance, and external reference currency rates.
- The LLM query route uses OpenRouter function/tool calls, executes only the allow-listed read-only tools, returns tool calls/results and financial revision, caps calls/rounds, and never mutates data. The compatibility context endpoint is composed from those same tools.
- Added frontend API access to discover tools and call a single tool directly. Budget planning remains a preview and explicitly reports that no write occurred.

### `e4e64f7` — canonical retrieval, cache races, frontend scope, and absence recovery

- Agent retrieval is now a small allow-listed read-only registry: financial facts and transaction search return canonical ledger facets (income, expense, debit, and credit) rather than largest-line or `txType` guesses. The LLM may select these tools directly; no special write function is exposed.
- Dashboard and salary-income views use canonical facts, deterministic full pagination, explicit scope/request guards, and completeness warnings. CSV export uses signed amounts and formula-safe escaping. Category filters are URL-backed and chart aggregation discloses `Other`.
- Reports use the newest period by default, inclusive selected-day boundaries, canonical all-period posted history, and guarded preview/download state. Cash-flow classification considers all counterparties and excludes loan receivables from liquidity.
- Insight payloads carry their source revision; AI cards display provenance. Net-worth comparisons use the exact as-of date, and the lifestyle metric is labeled as an average spending ratio rather than marginal propensity to consume.
- Cache precomputation refuses to publish a result if the financial revision changes mid-read. Empty queries and old runway cache shapes are handled safely; zero burn is represented as `runwayMonths: null` with `isUnbounded: true` instead of an ambiguous JSON infinity/null.

### Dashboard decision-surface revamp

- The dashboard now separates current position from selected-period activity: available cash is the canonical `cash_equivalent` balance, net worth remains all assets less liabilities, and each period metric discloses its as-of timestamp and coverage state.
- A decision queue highlights ledger imbalance, stale or missing reconciliation, skipped/partial/unknown period coverage, overdue loans/PayLater, upcoming subscriptions, budget overruns/projections, and unallocated spending, with direct links to the appropriate workflow.
- Duplicate expense widgets were consolidated into a plan-versus-actual category view with pace-based end-of-period projections. Recent user-facing activity, net-worth trend, data-confidence notes, and the agent entry point remain distinct surfaces.
- The typed budget client now reflects the backend's actual `BudgetSummary` response (one summary for a selected period, or a list for all periods); dashboard consumers explicitly extract `plans` instead of treating the summary itself as an array.
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
- Generic and domain-owned reversal paths now invert persisted category allocations together with the journal lines, so the inverse journal's allocations still equal its net expense; legacy category-only rows retain the ledger's category fallback.
- Loan payments now carry a durable posted/reversed lifecycle. Reversing a payment creates the linked inverse journal, restores the principal to the loan balance, reopens a fully paid loan when appropriate, and audits both the payment and loan state. Legacy databases gain the fields through migration `0011` without data deletion.

### `8392388` and `6d6912b` — owned correction workflows (PayLater and split bills)

- PayLater settlements now persist exact installment allocations in migration `0012`. Reversal restores each allocated installment amount before it posts the inverse journal; a legacy partial settlement without allocation evidence is deliberately refused instead of guessed. Recognition reversal is allowed only after its posted interest/settlements are unwound, and cancels the untouched schedule. Obligation retrieval now ignores reversed roots and children.
- A loan's original event can be reversed only before a repayment or status change; it is then archived rather than deleted. A split-bill journal can likewise be reversed only while every derived loan remains untouched; all derived loans are atomically archived with the inverse journal. These dependency rules preserve audit history and prevent orphaned balances.

### `ac6c782` — period identity and consistent scope membership

- Migration `0013` makes `transaction.period_id` a restrictive foreign key to `salary_period`. It retains all journals and converts only dangling legacy IDs to the existing unassigned (`NULL`) fallback before rebuilding the table; required transaction indexes are explicitly restored. Startup fails closed if the FK is absent.
- Reports, canonical financial facts, budget facts, cached period summaries, and agent transaction search use the same assigned-or-legacy membership predicate. An assigned journal in another period can no longer leak into a selected period merely because its date overlaps; legacy null assignments remain eligible only through each consumer's date range.

### `4bfed71` — explicit liquidity classification

- Migration `0014` adds an explicit `liquidity_class` to accounts. Legacy asset accounts become `cash_equivalent` for compatibility, while the Loans Receivable system account becomes `receivable`; non-assets remain `non_cash`.
- Account create/update validates the class. Cash flow, liquid net worth, runway, and canonical wallet facts now use that metadata instead of inferring cash from an account type or system-account name. Investment and other non-cash assets no longer inflate immediately available cash once classified.

### `6c532e5` — category reporting-account and allocation foundation

- Migration `0015` adds an optional category reporting-account FK and a durable, unique per-journal category-allocation table. Allocation amounts are signed net expenses, so a refund can reduce a category without mutating original history.
- Category create/update validates that a selected reporting account is active and an expense account. New simple categorized expenses post to that account; journals can carry multiple validated allocations whose sum must exactly equal their net expense. Entries without a reliable split remain deliberately unallocated.

### `3b6c13b` — period archive lifecycle and allocation-aware reads

- Periods now have an explicit, audited archive/restore lifecycle in migration `0016`. Only closed periods can be archived; default period lists omit archived history while `includeInactive=true` retains it for audit views. No period, budget, or journal history is deleted.
- Canonical facts, budget facts, reports/PDF spending breakdowns, dashboard consumers, and agent retrieval now consume journal category allocations. They fall back to legacy transaction categories and then disclose `Unallocated` for historic expense journals without an evidence-based split. This makes category totals reconcile to scoped net expense rather than hiding the gap.

### `b77a7e2` — explicit cash-flow lines and money-anomaly review

- Migration `0017` adds `transaction_line.cash_flow_class`. Cash-equivalent lines produced by simple transactions, transfers, loans, PayLater settlements, subscriptions, salary, imports, wishlist fulfilment, pending approval, generic edits, and reversals now retain an explicit `operating`, `investing`, `financing`, or `transfer` treatment. Cash-flow reports use it first; bounded counterpart inference is retained only for historic unclassified lines.
- Asset-to-asset movements distinguish cash-to-cash transfers from cash-to-investment movements, so the latter are investing flows rather than silently disappearing as wallet transfers. Loan receivable origin/collection is investing; borrowing and debt repayment are financing.
- Migration `0017` also adds a durable, audited money-anomaly review queue. An authenticated scan only flags likely 100× pairs with the same account/direction/type/normalized description and reconciliation-related historical journals. A reviewer must explicitly resolve or dismiss a candidate with a note; scanning never rescales, deletes, or reverses ledger data.

### `9aa73c3` — API contract and background-job foundation

- Fastify startup is split into an app builder and listener. Contract mode registers routes and Swagger without opening a port or starting maintenance timers.
- Zod validator/serializer compilers and a checked-in finance-pilot OpenAPI document are in place. Orval generation is reproducible through `generate:api` and `verify:generated`, with one shared credential/error/204-aware fetch transport.
- BullMQ queue and worker foundations cover cache invalidation, subscription renewal, and salary-posting maintenance. Interval mode remains the default until queue-mode equivalence is rehearsed in deployment.

### `62f84a8` — feature-owned query foundations

- Added canonical query-key factories and feature-owned React Query hooks for accounts, categories, periods, transactions, budgets, dashboard analytics, and agent conversations/memories.
- Added narrowly scoped Zustand stores for UI preferences, recoverable text drafts, and transient agent-session lifecycle. Server records remain outside Zustand.

### `456a0de` — React Query/Zustand pilot migration

- The Transactions page now derives filtered activity, totals, accounts, categories, tags, and periods from React Query instead of manual `useEffect` request state. Posting, reversal, deletion, import, and modal saves invalidate the shared financial-summary keys, preventing stale dashboard/account views.
- Agent conversations and memories now use their React Query caches. Conversation mutations update the canonical cache, while streaming text remains local/transient.
- Agent composer drafts are persisted per conversation and restored when switching chats or reloading. Drafts clear only after a successful send; active conversation, stream cancellation, and pending attachment IDs are exposed through the agent-session store.

### `feb9369` — generated-client transport correctness

- Successful generated API calls now return the `{ data, status, headers }` envelope expected by Orval's fetch client. HTTP errors retain the shared typed `ApiError` envelope and `204` responses are handled explicitly.

### `344d01f` — generated-client adoption for core reads

- Accounts, categories, periods, and dashboard query adapters now consume the checked-in generated client. Rich legacy fields remain available through the response's additional properties until each endpoint's schema is expanded, with explicit adapter casts at the feature boundary.
- The period contract now documents coverage, archive, and open/closed lifecycle fields so subsequent generated-client expansion can expose those states without another transport change.

### `8f70aa2` — query cancellation

- Core generated-client query hooks pass React Query's abort signal through the shared transport, so filter changes and unmounts can cancel stale requests.

### `e24b36b` — transaction form validation foundation

- Added shared Zod schemas for simple transactions, journals, and editable transaction metadata, including bounded text, tag, date/time, amount, and journal-line shapes.
- Simple and journal submissions now run schema validation before domain-specific account, balance, cash-flow, and category-allocation checks, producing a human-readable first error instead of relying only on browser constraints.
- The edit-details form now uses React Hook Form with the shared metadata resolver, including typed tag selection and reset behavior when the edited transaction changes. Transfer, PayLater, route-template, and attachment state remain isolated while the larger journal `useFieldArray` migration is staged separately.

### `303b778` — dynamic journal form state

- The journal editor now uses React Hook Form and `useFieldArray` for journal lines and category allocations. Add/remove/update operations mutate focused fields instead of rebuilding the complete form object.
- Journal submission receives the resolver-validated form snapshot before applying balance, cash-flow classification, and exact category-allocation checks. Existing simple, transfer, PayLater, route-template, and attachment state remains unchanged.

### `5dbe914` — Accounts query migration

- Accounts, filtered account rows, reconciliation history, and the net-worth summary now come from feature-owned React Query hooks with shared account/dashboard invalidation keys.
- Removed route-level request-version and manual server-record loading state. Failed refreshes retain the last successful query snapshot and expose React Query error/loading timestamps to the existing recovery UI.

### `0502f58` — Dashboard query migration

- Dashboard overview facts, accounts/categories/tags, reconciliation, loans, PayLater, subscriptions, and selected-period facts/budget/activity/outlook now use feature-owned React Query entries.
- Period changes are isolated to period-scoped queries. Refreshing after a transaction invalidates the shared dashboard/account/period keys instead of remounting the page or clearing unrelated data; the existing outlier-review follow-up invalidates only the selected period.

### `701a1b6` — Budget query migration

- Budget plans, period/category lists, comparisons, and reusable templates now use feature-owned React Query queries with stable period/comparison/template keys.
- Budget mutations invalidate the relevant cache families instead of clearing local rows before a request completes. A failed refresh keeps the last snapshot visible and exposes a retry affordance.

### `dbdf2f0` and `7d3094f` — high-priority completion wave

- Absence-period coverage now propagates through budget summaries/actuals, dashboard cards, reports and trends, PDF monthly reports, burn-rate averages, and agent comparison/variance tools. Skipped or unknown periods are disclosed as not tracked rather than rendered as zero activity.
- Cash-flow reports and CSV exports disclose whether each line was explicitly classified or retained bounded legacy inference. Recovery bridges remain outside CFO/CFI/CFF and are disclosed separately.
- Manual journals can now edit signed category allocations with exact net-expense reconciliation. Persisted allocations flow through transaction lists/details, budgets, spending reports, PDFs, dashboard cards, and agent facts.
- Categories now map to optional active expense reporting accounts in the UI. Account and category archive operations preserve history, expose dependency previews, support explicit restore, and keep archived records available only through an opt-in view.
- Money anomaly review has an authenticated scan/review screen, and legacy reconciliation-plug detection excludes already-labelled historical recovery adjustments.
- The cache path now has a durable SQLite invalidation outbox, a revision-update trigger that queues a full invalidation in the same write transaction, a retrying worker, and Redis success/failure results. A Redis outage cannot turn a committed mutation into a stale forever-cache; revision checks still force DB recomputation.
- Migration bootstrap now repairs incomplete pushed-schema migration history when the schema is already present, and the new migrations are safe around previously-created cache tables. No user data is deleted or rescaled.

## Data compatibility

- Existing data is not intentionally deleted or globally rescaled.
- New code treats stored monetary integers as whole rupiah, matching the dominant UI, salary, formatting, and manual-entry behavior.
- Historic 100× outliers remain a data-quality task: they must be detected and reviewed, not blindly divided because legitimate large transactions exist.
- Old reconciliation plug transactions remain historical ledger entries. They should be identified and reversed/classified through an explicit migration tool; the new reconciliation path does not add more.
- Domain-owned transactions are deliberately blocked from generic edit/delete until their owning reversal workflows are implemented.
- The `0008` migration adds posted/draft/reversed state without deleting transaction rows; existing rows are treated as posted and remain available for reversal.

## Verification completed

- Backend TypeScript checks pass for the changed code; the only remaining diagnostic is the pre-existing optional `puppeteer` module declaration in `scraper-enhanced.ts`.
- Frontend TypeScript project build and Vite production build pass after repairing the local pnpm-linked dependency tree with the project Node 22 runtime. Vite still reports the existing large-bundle advisory and the `.env` `NODE_ENV=production` warning.
- Drizzle migration journal/schema integrity check passes with migrations `0009`–`0024`, including the cache trigger and category archive lifecycle.
- Focused report/reconciliation/journal suite passes 9 tests after this wave; an earlier broader pure run passed 49 tests across journal validation, mutation policy, IDR parsing, report CSV behavior, and storage path confinement.
- The complete DB-backed suite is still blocked locally because installed `better-sqlite3` targets Node ABI 127 while the bundled Node runtime requires ABI 137. Do not treat this environment failure as a test pass.
- The local pnpm-linked dependency tree required a Node 22 reinstall because the bundled Node 24 runtime could not complete the Windows module relink. No source or user data was changed by that repair.

## High-risk work still open

1. **Implemented durable cache invalidation locally.** Revision updates enqueue a full invalidation in SQLite; the startup/periodic worker retries Redis failures indefinitely. A production outage rehearsal and metrics/alerting are still required.
7. **Implemented account/category archive dependency previews and restore flows.** The API and Accounts/Categories screens preserve history and require an explicit opt-in to view archived records. A richer cross-domain dependency graph remains an enhancement.
8. Add route-level rate-limit injection tests; audited expensive routes now use the intended scope configuration.
9. **Started the RHF/Zod form migration.** Simple/journal schemas, edit-details, and the dynamic journal lines/category allocation editor are migrated. The simple transaction form and remaining conditional subflows still use focused local state until their field boundaries can be moved without duplicating transfer/PayLater behavior.
10. **Accounts, Dashboard, and Budget are migrated to feature-owned React Query hooks.** Periods, reconciliation, and the remaining auxiliary screens still have legacy request orchestration and are next migration candidates.
11. **Implemented guarded agent write paths for budgets and transactions plus high-value retrieval/planning tools.** Budget-plan upserts and explicit journal transaction creation use durable pending actions and one-time approval tokens. Deterministic similar-transaction, cash-flow, category-variance, period-comparison, cash-forecast, account-health, and anomaly tools are available. Recurring occurrence decisions, recovery/reconciliation commands, and domain correction/reversal proposals still need their own contracts.
12. Run blank-DB migration integration, legacy-copy migration integration, and full DB-backed tests with a compatible native SQLite binary before merge.
13. **Implemented return-after-absence recovery and propagation.** Migration `0018` persists separate period coverage (`complete`/`partial`/`skipped`/`unknown`) and recovery-session metadata. The Periods UI previews and explicitly creates skipped shells; the Accounts reconciliation UI can post a confirmed full asset/liability recovery snapshot to a dedicated equity bridge. Budget/dashboard/PDF/trend/agent reads disclose gaps and exclude skipped/unknown periods from averages and comparisons. Guided statement import/catch-up orchestration remains a follow-up.

    - The Periods screen is now exposed in desktop and mobile navigation and redesigned as a current-period control card plus chronological history. Its detail view separates lifecycle from coverage, supports coverage review, archive/restore, and direct budget/activity links. Recovery backfill derives every shell from the configured payroll calendar (for example, 25th–24th), never a fixed 30-day cadence. Period dates are server-locked once posted activity or budget plans exist, so a boundary edit cannot silently reframe recorded history.

    - The Transactions UI now treats the selected period’s coverage as part of the activity scope, labels totals as **Spending in this view**, and defaults to effective user activity rather than reversal/recovery mechanics. Search, account/category/kind/date/amount filters, sorting, pagination, and scoped totals execute on the server; category filtering includes multi-category allocations. Accounting corrections remain inspectable only through an explicit opt-in.

## Return-after-absence period coverage policy

Missing calendar/accounting periods must be represented, not silently omitted and not treated as empty. A period created because the user was absent is a **skipped-coverage period**: it records that the ledger did not capture ordinary activity for that interval. It does not assert zero income, spending, cash movement, budget actuals, or account balance change.

### Required model

Keep `salary_period.status` for the accounting lock lifecycle (`open`/`closed`) and `is_active` for archive lifecycle. Add a separate durable `coverage_status` so those meanings are never conflated:

```text
complete  — user has tracked/reviewed this period sufficiently for comparisons
partial   — some historical events were added, but the period remains incomplete
skipped   — user intentionally did not track this period while absent
unknown   — legacy/imported history whose coverage cannot be asserted
```

New normal periods should begin as `complete` only when the product has an explicit tracking/review policy; otherwise use `unknown` or a separate current-period state until the period is closed. Existing periods must be migrated conservatively to `unknown`, never retroactively declared complete merely because they contain transactions.

### Backfill flow

On return, the app presents a read-only backfill preview using the configured salary-period cadence. It identifies every non-overlapping period between the latest existing period and the current period. The user explicitly confirms **Create skipped period shells**; page view, startup, and scheduler jobs must not create them implicitly.

For every confirmed historical shell:

- create the normal period header with deterministic start/end dates and name;
- set `coverage_status = skipped` and store an audited reason such as `return_after_absence`;
- create no transactions, opening balances, budget rows, reconciliation, or fabricated recurring entries;
- leave it open initially only if the user intends to backfill activity; otherwise close it after review according to the normal period-close policy.

If the preview also creates the active current period, that row is **not** a skipped absence. It starts `partial` with reason `return_started_current_period`: the user has resumed tracking, but any earlier slice of the period still needs explicit review before it can be marked `complete`. The return flow also offers an explicit, reviewed “I resumed at the start of this current period” option. It marks only that current shell `complete` with reason `return_started_at_period_start`; historical shells remain `skipped`. Startup repairs the earlier implementation bug that marked open current return rows as skipped, retaining an audit record and coverage warning rather than silently declaring them complete.

If the user later posts selected catch-up salary/subscription events or imports a partial statement into such a period, transition it to `partial`; do not silently promote it to `complete`. A deliberate period review/reconciliation workflow may later mark it `complete` only with an audited user decision.

### Recovery reconciliation on return

A conventional reconciliation remains **control evidence only**: it records an entered balance and the ledger difference, but does not manufacture an accounting entry. A user returning after an intentionally untracked span needs a separate, explicit **recovery reconciliation**. It is the opt-in recovery path for “my real balances are now these; I am not backfilling the gap.”

The recovery session is one dated, auditable balance snapshot across every active material asset and liability account. It must reject a partial snapshot, because a change in one bank account could simply be a transfer from another omitted account. For each account, the service compares its normal-balance ledger amount at the selected `as_of_date` to the user-confirmed actual amount, then posts a single balanced `historical_recovery_adjustment` journal:

```text
BNI ledger balance at 31 Aug:   Rp7m
BNI actual balance at 31 Aug:  Rp29m

Dr BNI cash                                      Rp22m
Cr Historical recovery adjustment (equity)       Rp22m
```

Liability differences use their normal balance in the opposite direction. The dedicated equity account is a disclosed bridge, not revenue, expense, a budget actual, or an operating/investing/financing cash flow. A cash-equivalent adjustment line is marked `recovery`, so cash-flow reports exclude it from CFO/CFI/CFF while still allowing beginning cash plus disclosed recovery bridge to reconcile to the actual ending cash.

The API must require an explicit confirmation and a non-empty acknowledgement that the historical source of every residual is unknown. It stores the session kind, note, original ledger balance, actual balance, difference, generated transaction ID, and audit snapshot atomically. Repeating a recovery later is safe: it uses the updated ledger and creates only the remaining difference. A recovery session cannot be normally voided, because voiding evidence without reversing its journal would corrupt the ledger; a later approved recovery/correction is the audit-preserving remedy.

If the as-of date falls in a skipped period, the posted recovery journal changes that period’s coverage to `partial`: it now contains a real current-balance bridge, but still does not claim complete activity. The user can subsequently import/classify transactions and explicitly review the period; no automatic action marks it complete.

### Read and insight semantics

Every period-aware read model must return coverage metadata and gaps:

```ts
{
  actuals: { income: number; expense: number; cashFlow: number },
  coverage: { complete: number[]; partial: number[]; skipped: number[]; unknown: number[] },
  isComparable: boolean,
  warnings: string[]
}
```

- A report whose selected range includes `skipped`, `partial`, or `unknown` coverage is labelled incomplete; it may show recorded actuals, but never calls a gap “zero activity.”
- Trend averages, savings rates, burn rates, forecasts, and period comparisons exclude skipped/unknown periods by default and disclose the exclusion. Partial periods require an explicit include decision.
- Budgets for skipped coverage are `not tracked`, never `under budget` because actuals happen to be zero. Do not clone a normal budget into a skipped shell without a user request.
- Dashboard cards must show a coverage-gap badge for selected/all-period scopes.
- Agent tools return coverage state and require the LLM to state the gap in answers. “No transactions” is valid only for a `complete` period with zero posted transactions.
- Cash/account balances are always shown as recorded facts, with no invented movement across skipped periods.

### Frontend requirements

- Add a return-after-absence wizard combining missing-period preview, skipped-shell confirmation, subscription/salary occurrence decisions, and optional statement-import/reconciliation next steps.
- Period cards/list views show coverage badges distinct from `OPEN`, `CLOSED`, and `ARCHIVED`.
- Reports, budget, dashboard, and agent cards disclose affected period gaps with links to the skipped periods.
- A user can open a skipped period, import/backfill activity, mark it partial, and only mark it complete through an explicit reviewed action.

## Frontend and operational-flow gaps

The backend integrity work is not equivalent to complete user workflows. The following capabilities are still backend-only or only partially surfaced in the current frontend.

1. **Manual-journal cash-flow classification.** Implemented in the transaction journal editor; each cash-equivalent line requires an explicit operating/investing/financing/transfer/recovery treatment where appropriate.
2. **Manual-journal category allocations.** Implemented with a multi-category editor, signed whole-rupiah amounts, exact net-expense reconciliation, and a visible allocation summary.
3. **Account liquidity class.** Implemented in account create/edit with explanations for `cash_equivalent`, `receivable`, `investment`, and `non_cash`.
4. **Category reporting-account mapping.** Implemented in category create/edit and displayed on category cards; inactive mappings are rejected for new proposals.
5. **Cash-flow provenance.** Implemented in report UI and CSV export; explicit classifications are separated from bounded legacy inference.
6. **Money-anomaly review.** Implemented with an authenticated client, scan/list/filter tabs, paired-transaction comparison, reason/note display, and resolve/dismiss audit actions.
7. **Historic 100x remediation.** The anomaly screen now links directly to each flagged/comparison journal and keeps resolution separate from mutation; a dedicated guided replacement/reversal wizard is still pending. Automatic rescaling remains prohibited.
8. **Legacy reconciliation-plug remediation.** Legacy plugs are now surfaced in the anomaly queue with direct journal links and review notes; a dedicated guided correction wizard is still pending.
9. **Salary occurrence correction.** Add a reasoned correction UI for posted salary occurrences, with replacement amount/account/date and an original-to-reversal-to-replacement timeline.
10. **Subscription occurrence correction.** Add the equivalent correction UI for posted renewal occurrences, including replacement amount/payment account/date and reason.
11. **Loan payment reversal.** Add an eligibility-aware, reasoned reversal action and show the restored loan balance, inverse journal, and payment status.
12. **Loan-origin reversal.** Add a guarded action for untouched loan origins and explain why repayments, write-offs, or split-bill origins make it unavailable.
13. **PayLater reversal.** Add protected reversal controls with reason capture, dependency explanation, and installment-allocation history.
14. **Split-bill reversal.** Add a guarded reversal action that explains derived-loan eligibility and reports which loans were archived with the inverse journal.
15. **Contact archive/restore.** Add inactive-contact management, restore actions, and a dependency preview for active outstanding loans.
16. **Budget-template archive/restore.** Add an inactive-template management view and restore controls rather than hiding archived templates permanently.
17. **Period archive/restore.** Add archived-history browsing and archive/restore actions alongside the already-surfaced close/reopen controls.
18. **Account/category archive dependency previews.** Implemented with API previews showing balances, children, posted history, linked categories, budgets, blockers, and safe archive/restore consequences.
19. **Agent workspace.** Implemented `/agent`: period scope selection, durable server-side multi-conversation history scoped to the authenticated user, bounded conversational context, tool-call trace with linked domain surfaces, source/result inspection, financial revision labels, budget-plan preview, conversation lifecycle controls (editable titles, pin/unpin, archive/restore, and confirmed deletion), and multimodal image questions with click/drop upload, inline/lightbox previews, and safe size/type limits. Image pixels are sent only for the current turn and are not retained in chat history. Budget proposals now have a durable pending-action state; contextual entry points and other domain write commands remain pending.
20. **Agent write approval UX.** Implemented for budget-plan upserts and explicit journal transaction proposals: the UI shows the normalized budget diff or journal lines, bound financial revision, expiry, and explicit confirmation/dismissal controls. Replays return the original receipt without repeating the write; stale revisions fail closed and require a fresh proposal. Future correction commands still need their domain-specific diff surfaces.
21. **Cross-domain correction timelines.** Transaction, loan, PayLater, subscription, and split-bill views need a consistent original → inverse → replacement chain with audit links.
22. **Attachment capability alignment.** Drive client file-size/type validation and error copy from backend capabilities; verify this against the separately modified attachment frontend before altering it.
23. **Operational visibility.** Consider an admin/support view for migration health, financial revision/cache freshness, cleanup-outbox failures, and anomaly-scan state.

Already surfaced in the frontend: reconciliation session evidence and voiding, generic transaction reversal, reports, period close/reopen, subscription catch-up, and salary catch-up. The regular Transactions feed now presents user-facing activity by default: superseded originals and inverse bookkeeping journals are omitted, while `includeReversals=true` remains available to audit/history consumers. This list therefore targets the remaining gaps rather than duplicating completed UI work.

## Agentic control-surface design

### Product intent

Chat is a first-class way to inspect and operate Fainens. It is not a second, opaque finance system and it must not automate the browser UI. The agent chooses modular domain tools, asks focused follow-up questions where information is missing, presents evidence and proposed effects, and invokes the same audited domain services used by the ordinary frontend only after explicit user approval.

```text
User message
  → agent chooses retrieval / planning / preparation tools
  → answer, clarification, or non-mutating proposal
  → user explicitly approves an exact effect
  → domain command revalidates and commits atomically
  → durable receipt with journal/domain/audit links
```

Existing page UI remains the transparent inspection and fallback surface. A chat action must link to the same transaction, account, budget, obligation, or reconciliation record that a normal user can inspect.

The modular tool set now includes `get_categories`, `prepare_transaction`, and
`prepare_transactions`. `get_categories` returns the small complete local
category list (including IDs and reporting-account links), so classification
does not depend on external search or a category-spending result. During an
authenticated conversation the preparation tools may create
one or more pending journal proposals after retrieval and validation, but their
bearer tokens are redacted before the model sees them and before assistant
response JSON is persisted. The live browser response carries each token only
long enough for the user to confirm or dismiss that individual transaction.

### Guarded write implementation (current milestone)

The first executable commands are `budget_plan_upsert` and
`transaction_journal_create`. The budget command intentionally does not
replace or delete unmentioned budget rows: it only creates or updates the
category plans displayed in the proposal. This makes the initial agent write
surface additive/explicit and avoids turning a model omission into a deletion.

`transaction_journal_create` accepts only an explicit balanced journal payload:
date, description, optional period/category metadata, debit/credit lines with
cash-flow classes for cash-equivalent accounts, category allocations, and tag
IDs. It fixes `txType = manual`, rejects domain-owned/system transaction types,
and runs the same `prepareJournalEntry` validation as the ordinary transaction
route. Execution inserts through `insertPreparedJournalEntrySync`, so ledger
balance, period-lock, audit, financial-revision, and transaction-cache rules
remain centralized. A transaction proposal cannot be executed twice: its
receipt carries the created transaction ID and audit ID, and replay returns that
receipt without another journal.

Category handling is confidence-calibrated: obvious merchant cues such as
“burger” or “cendol” may be mapped to the closest available Food & Dining
category after fetching `get_categories`, with the inference recorded as a
proposal assumption. The agent should ask only when materially different
categories remain equally plausible. Preparation itself is non-mutating, so it
should happen immediately once required facts are present; user confirmation
belongs to the review card and posting step.

1. `POST /api/agent/actions/prepare` validates the action kind, period, category
   IDs, non-negative integer IDR amounts, assumptions, and optional conversation
   ownership. For transaction journals it additionally validates every explicit
   debit/credit line, cash-flow class, category allocation, account, tag, and
   period through the ledger preparation service. It canonicalizes and sorts the payload, captures the current
   `financial_state.revision`, and creates `agent_pending_action` plus
   `agent_approval` rows. A random approval token is returned to the browser;
   only its SHA-256 hash is stored. The proposal expires after 15 minutes.
   An authenticated `POST /api/agent/approvals/:id/reissue` can rotate a fresh
   token for a still-pending or expired proposal after a reload; old tokens are
   invalidated and the financial revision guard still applies at execution.
2. The UI renders a practical review card first: transaction name, IDR amount,
   category, local date/time, place, reference, and notes. Ledger lines and
   revision/expiry evidence are available under a collapsed Ledger details
   section. Users can edit those fields inline; editing prepares a replacement
   proposal and rejects the old token before it can be accidentally posted.
   Several cards can be reviewed independently when one message contains
   multiple transactions. No financial row changes during preparation. The
   token is held in browser memory only and is never written to chat history;
   the card automatically reissues it when a saved conversation is reopened.
3. `POST /api/agent/approvals/:id/execute` requires the authenticated owner and
   token. In one SQLite transaction it checks expiry/status, re-reads the
   pending payload, verifies the financial revision has not changed, rechecks
   the target period and categories, upserts only the proposed rows, writes
   audit snapshots, bumps the revision once, and stores a receipt. A repeated
   request returns that stored receipt with `replay: true`; it cannot repeat
   the mutation. Revision changes, deleted categories, closed periods, and
   expired tokens fail closed.
4. `POST /api/agent/approvals/:id/reject` marks a pending proposal rejected
   without touching financial data. `GET /api/agent/actions` provides durable
   status for recovery after a page refresh, but cannot recover the raw token.

The approval tables are owner-scoped and conversation-linked with restrictive
input limits. This is an approval boundary, not authorization to bypass domain
rules: each future command must have its own normalized payload, domain
validator, atomic mutation, audit evidence, cache invalidation, and receipt.
Current remaining work is to deepen transaction clarification (natural-language
kind/amount/account inference, missing-field questions, and correction/reversal
flows), then add recurring
post/skip decisions, and recovery/reconciliation commands rather than widening
the budget command into a generic arbitrary-write endpoint.

### Agent response contract

The orchestration endpoint must return a structured response in addition to human-readable text. It must never hide a pending decision in prose.

```ts
type AgentResponse =
  | { kind: "answer"; text: string; evidence: Evidence[]; scope: Scope; revision: number; followUps: SuggestedAction[] }
  | { kind: "clarification"; text: string; pendingActionId: string | null; fields: RequiredField[] }
  | { kind: "proposal"; text: string; action: PreparedAction; assumptions: Assumption[]; approvalRequired: true }
  | { kind: "receipt"; text: string; execution: ExecutedAction; auditLinks: ResourceLink[] };
```

- **Answer** gives an evidence-backed response with the exact accounting scope/as-of date, financial revision, source record IDs, and any truncation or legacy-fallback disclosure.
- **Clarification** asks only for information that cannot be safely determined. The pending action survives the next user message rather than relying on raw chat history.
- **Proposal** is non-mutating and contains exact normalized command inputs plus assumptions. It cannot be executed merely because the model described it.
- **Receipt** exists only after a successful domain command and links to created/reversed journals, owning records, and audit history.

### Inference and clarification policy

The agent may make a clearly disclosed, user-approvable suggestion for category, merchant normalization, likely account, likely date, recurring subscription match, or potential duplicate/similar transaction. Every inference carries a confidence, reason, alternatives when meaningful, and an `acceptedByUser` field on the prepared action.

The agent must ask a clarification rather than infer: amount, debt/payment allocation, reconciliation balance, correction or reversal target, personal-versus-business treatment, an account choice that materially changes balances, or whether a missed recurring occurrence should be posted/skipped. It must never silently post, skip, reconcile, reverse, archive, delete, or change an existing journal.

### Tool model

Do not expose arbitrary SQL, generic CRUD, browser automation, or a universal database-write tool. Tools are domain functions with strict schemas, bounded results, input/output validation, explicit ownership checks, and deterministic accounting calculations.

```text
Read tools (automatically callable)
  get_financial_facts(scope)
  search_transactions(filters)
  find_similar_transactions(seed | query, filters)
  get_cash_flow(scope)
  get_category_variance(periodId, categoryId?)
  get_account_health(accountId, asOfDate)
  get_journal_provenance(transactionId)
  get_money_anomalies(filters)
  get_due_recurring(asOfDate)
  get_salary_catch_up()
  get_loan_balances(filters)
  get_paylater_obligations(filters)
  get_reconciliation_status(filters)

Planning tools (automatically callable, non-mutating)
  simulate_budget_scenarios(input)
  forecast_cash_position(input)
  compare_periods(input)
  build_budget_proposal(input)

Preparation tools (non-mutating, create durable proposal)
  get_categories()
  prepare_transaction(input)
  prepare_transactions({ transactions: input[] })
  prepare_budget_application(proposalId)
  prepare_recurring_decision(input)
  prepare_wishlist_fulfilment(input)
  prepare_domain_correction(input)

Execution tools (never auto-run; explicit user approval required)
  execute_approved_action(approvalToken)
```

The current read-only tool registry is the starting point. New tools should be added only when an evaluation task proves a high-value gap; do not create overlapping one-off tools such as `get_food_spending_this_month`.

The live agent prompt keeps a stable policy/profile prefix for provider prompt caching, then appends a request-scoped runtime footer containing one captured UTC and Asia/Jakarta timestamp. It addresses Ray by nickname, defaults user-facing amounts to IDR, and uses Bekasi/Asia-Jakarta for local date interpretation. The footer is captured once per request so streamed/tool-loop turns agree on what “today” means.

`find_similar_transactions` must use deterministic candidate retrieval—normalized merchant/description, category, amount band, account, recurrence signals, date history, and optional OCR/receipt metadata—then let the LLM explain the candidates. Semantic similarity alone is not accounting evidence.

### Evidence contract

Every read tool result used in an answer or proposal should include:

```ts
{
  data: unknown,
  scope: { periodId: number | null; startMs: number; endMs: number; asOfMs: number },
  financialRevision: number,
  sourceIds: { transactions: number[]; accounts: number[]; periods: number[] },
  completeness: { truncated: boolean; legacyFallbackUsed: boolean },
}
```

Retrieved transaction descriptions, notes, receipt OCR, contact names, and attachment text are untrusted data. The system prompt and rendering layer must treat them as evidence only, never as executable instructions. Answers must label actuals, forecasts, recommendations, drafts, and reconciliation evidence distinctly.

### Durable conversation and approval state

Add durable records rather than retaining all state only in model context:

```text
agent_conversation
  id, user_id, title, created_at, updated_at, archived_at

agent_message
  id, conversation_id, role, content, structured_response, created_at

agent_run
  id, conversation_id, status, started_at, completed_at,
  base_financial_revision, final_financial_revision, trace_json, error

agent_pending_action
  id, conversation_id, kind, normalized_input, missing_fields,
  assumptions, base_financial_revision, status, expires_at, created_at

agent_approval
  id, pending_action_id, token_hash, user_id, status,
  approved_at, executed_at, idempotency_key, execution_receipt, expires_at
```

The approval token binds the user, normalized payload, allowed action type, base financial revision, expiry, and idempotency key. Execution reloads relevant rows and revalidates every domain invariant. If a relevant revision/state changes, execution fails closed and produces a fresh proposal request. A financial approval is not reusable across conversations or users.

### Approval policy

| Capability | Model may call automatically | User approval | Notes |
|---|---:|---:|---|
| Read facts/search/compare | Yes | No | Return bounded evidence and revision. |
| Budget simulation | Yes | No | No plans are written. |
| Prepare any write | Yes | No | Creates no financial mutation. |
| Add expense/income/transfer | No | Always | Show balanced journal preview. |
| Post/skip recurring occurrence | No | Always | Show exact dated occurrences. |
| Apply budget proposal | No | Always | Show all category deltas and assumptions. |
| Fulfil wishlist | No | Always | Show generated journal and linked item. |
| Loan, PayLater, split-bill, salary, subscription correction | No | Always + reason | Route only to dedicated domain service. |
| Reconciliation, reversal, archive/restore, delete | No | Always + reason where applicable | Never hide the audit consequence. |

There is no generic “undo” for posted finance data. A receipt may offer the appropriate dedicated correction/reversal preparation flow only when eligibility checks pass.

### Chat UX

Build a persistent Agent workspace plus contextual entry points on Dashboard, Transactions, Budget, Accounts, Loans, PayLater, Subscriptions, and Reports. The user still sees one assistant, not a visible multi-agent graph.

- **Answer cards:** scope, as-of date, source links, revision, and disclosed assumptions.
- **Clarification cards:** one focused question at a time with typed controls (account/category selectors, dates, amount input, chips) instead of forcing free-text answers.
- **Proposal cards:** debit/credit journal preview or domain effect, assumption badges, alternatives, expiry, and `Edit`/`Confirm` actions.
- **Receipt cards:** execution status, record links, audit link, current revision, and eligible correction path.
- **Trace drawer:** collapsed by default; shows called tools, inputs, returned record counts, errors, and timing. Do not expose private model reasoning.
- **Plan cards:** scenario comparisons, assumptions, recurring commitments, debt effects, category deltas, and explicit “does not write” versus “ready for approval” state.

Examples:

```text
“What are my top 10 recent spendings?”
  → factual card with ten linked posted journals and a defined time range.

“Have I spent similarly before?”
  → deterministic similar-transaction candidates, match reasons, and links;
    the agent does not claim a match without evidence.

“I paid 55k for lunch.”
  → inferred category disclosed; asks for a wallet if ambiguous; shows balanced
    journal preview; posts only after Confirm.
```

### Orchestration and scope

Keep a single finance-manager agent initially. It may dynamically choose multiple modular tools in a bounded loop, but do not add a multi-agent graph until tool traces/evals demonstrate a real specialization boundary. Candidate later boundaries are complex retrieval, deterministic planning, and anomaly analysis—not separate chat personalities.

Tool visibility should be contextual and risk-tiered: read/planning tools are available in normal chat; preparation tools appear only for relevant user requests; execution is represented by a pending approval, not as a model-selectable unrestricted capability. Retain maximum rounds/calls, per-tool timeouts, pagination caps, cancellation, and model-visible recoverable errors.

Use context curation rather than one giant “finance context” prompt. Re-retrieve ledger facts for every financial claim. Persist only user-controlled preferences and planning context (planning horizon, target savings rate, approved category rules), never stale balances as memory. Tool results should be compacted after their evidence has been incorporated into a structured trace/note.

### Rollout

1. Ship a read-only Agent workspace with current tools, source links, revision/scope labels, tool trace, and conversation persistence.
2. Add missing high-value retrieval: cash flow, category variance, account health, journal provenance, anomalies, and deterministic similar-transaction search.
3. Add deterministic scenario/planning outputs and revision-bound budget proposals.
4. Build the generic pending-action/approval/receipt infrastructure.
5. Enable one command at a time: budget proposal application, explicit recurring post/skip, then normal transaction drafts.
6. Add wishlist fulfilment and only then protected loan/PayLater/split-bill/correction capabilities after their ordinary frontend flows and previews exist.
7. Expose the same modular read tools through MCP only after application-level authorization, consent UI, rate limits, and audit boundaries are in place.

### Evaluation and launch gates

Do not add financial write tools until trace-based, multi-turn evaluation passes against fixture ledgers. Grade both tool trajectories and resulting domain state, not pleasant-sounding prose.

- Correct tool selection, scopes, as-of dates, and result completeness.
- Exact reconciliation of reported amounts to canonical financial facts.
- Correct treatment of drafts, reversals, receivables, investments, and reconciliation evidence.
- Similar-spending results must include a deterministic match rationale and source IDs.
- Prompt-injection strings in descriptions/notes/OCR cannot alter tool policy or execution.
- Repeated trials, equivalent phrasings, malformed tool arguments, timeouts, rate limits, partial results, and stale-revision approval attempts fail safely.
- No mutation claim is allowed without a successful execution receipt from the domain service.
- Every financial mutation is idempotent, audited, and testable as a final database/domain state.

## Merge policy

Do not merge `majorfix` while the high-risk loan/PayLater/split-bill flows still bypass compound accounting invariants. No migration in this branch requires wiping the database, but a backup and migration rehearsal on a copy are mandatory before production deployment.
