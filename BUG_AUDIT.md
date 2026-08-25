# Fainens Bug Audit and Recovery Design

Last updated: 2026-08-25 (Asia/Jakarta)

Status: investigation and design notes only. No fixes described here have been implemented unless explicitly marked otherwise.

## Purpose

This document preserves the detailed context from a focused review of Fainens. It covers:

- Ledger and transaction integrity bugs.
- Delete, archive, cascade, audit, cache, and external-file cleanup bugs.
- Reconciliation correctness and concurrency problems.
- Recurring salary/subscription behavior.
- The missing workflow for returning after several months away from the app.
- Verification already performed and the tests still needed.

Priority meanings:

- **P1:** Can corrupt financial/domain state, disclose server files, create duplicates, or irreversibly lose cleanup information.
- **P2:** Produces incorrect behavior, misleading responses, stranded state, scheduling drift, or significant UX/data-consistency failures.
- **P3:** Defensive improvement or lower-impact inconsistency.

## Core invariants the implementation should enforce

1. Every journal entry must remain balanced: total debits equal total credits.
2. A domain action and its journal entry must commit or roll back together.
3. Deleting a domain-owned transaction must either be rejected or reverse/update the owning domain state.
4. Multi-row mutations must be atomic inside one database transaction.
5. External-object cleanup must be retryable; object keys must not be discarded before cleanup succeeds.
6. A successful HTTP response must mean the requested operation completed; a failure must not hide an already-committed destructive operation.
7. GET requests must not create financial transactions or otherwise mutate persistent state.
8. Recurring jobs must be idempotent under retries, concurrency, restarts, and multiple application instances.
9. Reconciliation must be dated, reviewable, concurrency-safe, and distinguish opening-balance adjustments from real income/expense.
10. Transactions that participate in period reporting must be assigned to the correct period or explicitly marked unassigned for review.

---

## 1. Security and file handling

### SEC-01 — P1 — Local attachment routes allow path traversal

**Evidence**

- `backend/src/routes/attachments.ts:234-238`
- `backend/src/routes/attachments.ts:269-273`
- `backend/src/services/r2.ts:167-169`

The wildcard URL portion is decoded and passed to `getLocalFilePath()`, which calls `path.join(LOCAL_STORAGE_PATH, key)` without verifying that the resolved path remains inside `LOCAL_STORAGE_PATH`.

**Failure scenario**

An authenticated request containing encoded `../` path segments can escape the attachment directory. The route calls `fs.stat()` and streams any resolved file, even when no attachment metadata record exists.

**Required behavior**

- Resolve both the storage root and candidate path to absolute paths.
- Reject the request unless the candidate is a strict descendant of the storage root.
- Prefer serving files only by attachment ID after looking up the authoritative stored key.
- Apply the same protection to wishlist image routes.
- Add tests for plain, encoded, double-encoded, Windows-separator, and mixed-separator traversal attempts.

### FILE-01 — P2 — Frontend and backend upload rules disagree

**Evidence**

- `frontend/src/components/ui/AttachmentUploader.tsx:32-44`
- `backend/src/routes/attachments.ts:16-30`

The frontend accepts files up to 10 MB and includes Word MIME types. The backend accepts only 5 MB and rejects Word MIME types.

**Impact**

The file picker accepts a file and presents it as ready, but the later API upload fails.

**Required behavior**

Define upload limits and MIME types once, or expose them from a backend capabilities endpoint. The client text, client validation, server validation, and body-size limit must agree.

### FILE-02 — P2 — Base64 validation is not strict

**Evidence**

- `backend/src/routes/attachments.ts:133-139`

`Buffer.from(value, "base64")` commonly accepts malformed input instead of throwing. The current `try/catch` does not prove the request contains canonical valid base64 or that the bytes match the claimed MIME type.

**Required behavior**

Strictly validate the base64 format and decoded length, and inspect magic bytes for types where feasible. Do not trust the submitted MIME type alone.

---

## 2. Transaction and ledger mutation integrity

### LEDGER-01 — P1 — Transaction update can create an unbalanced ledger

**Evidence**

- `backend/src/routes/transactions.ts:607-717`
- The line replacement occurs at `backend/src/routes/transactions.ts:693-703`.
- Balanced-entry validation exists in `backend/src/services/ledger.ts:430-432`, but this update route bypasses it.

**Failure scenario**

The PUT route accepts arbitrary replacement lines and never verifies debit/credit totals. A request can persist an unbalanced journal entry.

**Additional atomicity problem**

Metadata update, line deletion, line insertion, tag deletion, and tag insertion are separate commits. If insertion fails after deletion, the transaction is left with no journal lines.

**Required behavior**

- Validate line shape, account existence/activity, integer amounts, and debit/credit equality.
- Execute metadata, lines, tags, audit, and relevant domain updates in one database transaction.
- Reuse one ledger service rather than duplicating raw update logic.
- Invalidate caches only after commit.

### LEDGER-02 — P1 — Domain creation and journal creation are not consistently atomic

Examples include creating a loan journal entry before inserting the loan row and other service flows that insert a transaction before all related rows are guaranteed to succeed.

**Failure scenario**

If the domain insert fails after the journal insert, the ledger contains an entry with no owning domain object.

**Required behavior**

Every service that creates a journal entry plus a loan, payment, installment schedule, wishlist fulfillment, or subscription state change must accept and use the same transaction-scoped database handle.

### LEDGER-03 — P1 — Wishlist fulfillment creates incomplete journal state

**Evidence**

- `backend/src/routes/wishlist.ts:340-379`

Wishlist fulfillment inserts the transaction and then a single debit line. It does not create the balancing credit line and is not atomic with updating the wishlist item.

**Required behavior**

Use `createSimpleTransaction()` or the journal service inside one database transaction, then update the wishlist item and audit in that same transaction.

### LEDGER-04 — P1 — The journal service silently invents balancing income or expense

**Evidence**

- `backend/src/services/ledger.ts:390-428`
- `backend/src/services/ledger.test.ts:6-19`
- `backend/src/services/ledger.test.ts:64-82`

`createJournalEntry()` does not reject an unbalanced entry. When debits exceed credits it adds an `Income (Auto)` credit; when credits exceed debits it adds an `Expense (Auto)` debit. It also accepts a one-line journal and turns it into a superficially balanced journal by adding one of these artificial lines.

**Failure scenario**

A caller that forgets a cash, liability, revenue, or expense line does not fail. The defect is converted into plausible-looking profit or loss, corrupting financial statements while preserving a balanced trial balance. For example, the borrowed split-bill flow supplies only a credit to Loans Payable at `backend/src/routes/splitbill.ts:247-256` and relies on the ledger to invent its other side.

The tests say unbalanced and one-line journals should be rejected, but the implementation contradicts those expectations. The unbalanced test can also reject for an unrelated mock-query failure, so it is not reliable evidence that balance validation works.

**Required behavior**

- Require at least two meaningful lines.
- Require exactly one positive side on every line: `(debit > 0) XOR (credit > 0)`.
- Reject zero/zero and debit-plus-credit lines.
- Require exact debit/credit equality before any write.
- Keep convenience construction only in explicit helpers such as `createSimpleTransaction()`; the primitive journal API must never infer a financial event.

### LEDGER-05 — P1 — Journal persistence is not atomic and can advance subscriptions before the journal exists

**Evidence**

- Header insert: `backend/src/services/ledger.ts:458-482`
- Subscription mutation: `backend/src/services/ledger.ts:487-512`
- Line inserts and post-write verification: `backend/src/services/ledger.ts:515-536`

`createJournalEntry()` does not open its own database transaction. A failed line insert can leave a header-only transaction. A failed post-insert balance check can leave the already-written unbalanced lines in place.

The generic journal service also advances `subscriptions.nextBillingDate` before inserting journal lines and swallows any subscription-update error. That creates both possible inconsistencies: a subscription can advance without a valid journal, or a journal can commit without advancing the subscription.

**Required behavior**

Use an atomic public wrapper plus a transaction-scoped internal primitive. Move subscription schedule changes into the subscription domain service and commit them with the journal; never catch-and-continue an invariant-affecting update.

### LEDGER-06 — P1 — Several apparent transactions do not actually contain their journal writes

**Evidence**

- Bulk import opens `db.transaction(...)` but calls `createSimpleTransaction()` without `tx`: `backend/src/routes/transactions.ts:918-943`
- Pending approval posts the journal and changes pending status separately: `backend/src/routes/pending-transactions.ts:143-163`
- Loan creation posts the journal before inserting the loan: `backend/src/routes/loans.ts:257-287`
- Split-bill borrowing posts the journal before inserting the loan: `backend/src/routes/splitbill.ts:237-272`
- The transfer modal creates the transfer and transfer fee in separate HTTP calls: `frontend/src/components/transactions/TransactionModal.tsx:779-820`

**Failure scenarios**

- A bulk-import tag or later row fails. The outer transaction rolls back, but journals written through the global DB remain committed.
- Pending approval creates a journal, then the status update fails. A retry creates a duplicate journal.
- Loan insertion fails after posting, leaving an orphan journal.
- The main transfer succeeds but the fee request fails, leaving only half of the user command.

**Required behavior**

Make the transaction-scoped DB handle mandatory for compound commands, and expose one backend command for transfer plus fee. Add idempotency keys to retryable approval/import operations.

### LEDGER-07 — P1 — Money units are inconsistent, producing 100× entries

**Evidence**

- The schema and API names describe amounts as cents: `backend/src/db/schema.ts:73-74`
- The currency formatter displays the stored integer directly as rupiah: `frontend/src/lib/utils.ts:29-38`
- Normal manual transaction entry sends the parsed rupiah integer directly: `frontend/src/components/transactions/TransactionModal.tsx:789`
- Pending approval multiplies an already parsed rupiah amount by 100: `backend/src/routes/pending-transactions.ts:147`
- CSV import multiplies rupiah by 100: `backend/src/routes/transactions.ts:1003-1013`
- Split-bill approval multiplies receipt rupiah by 100: `backend/src/routes/splitbill.ts:225-227`
- Salary posting passes whole-rupiah payroll values directly: `backend/src/services/salary-posting.ts:124-133`
- Onboarding multiplies the entered budget by 100: `frontend/src/routes/onboarding.tsx:183-188`

**Failure scenario**

The same Rp100,000 economic event may be stored as either `100000` or `10000000`, depending on its entry path. Ledger balances, budgets, reconciliation, forecasts, and LLM analysis are therefore not comparable across sources.

**Required behavior**

Choose one canonical integer unit and enforce it at every boundary. Given the current IDR UI, integer rupiah may be the least disruptive choice, with legacy `*Cents` names migrated. Add a data audit/migration that identifies existing 100× outliers before changing code.

### LEDGER-08 — P1 — System-account caching can retain nonexistent or wrong-database IDs

**Evidence**

- Module-global caches: `backend/src/services/ledger.ts:64-65`
- Cached IDs are returned without checking the supplied DB/transaction: `backend/src/services/ledger.ts:67-96`

If an auto account is created inside a transaction that later rolls back, the module cache still holds its ID. Subsequent posts reference a nonexistent account. The same problem appears when tests replace the database, an account is archived/recreated, or concurrent first-use calls race.

**Required behavior**

Do not cache database IDs globally. Re-select by unique system key in the current DB context, validate active/system status, and recover from a unique-insert race by re-selecting. Prevent system accounts from normal archive/delete operations.

### LEDGER-09 — P1 — Cache refresh can observe pre-commit data or cache rolled-back balances

**Evidence**

- Fire-and-forget balance recomputation: `backend/src/services/ledger.ts:546-559`

The ledger starts asynchronous recomputation immediately, even when called with an outer transaction handle. The recomputation uses committed/global state, so it can run before the outer commit and cache stale balances. If the outer transaction later rolls back, it can cache balances for a journal that never committed.

**Required behavior**

Return the affected account/user IDs and invalidate only after the owning transaction successfully commits. Prefer invalidation over eager recomputation inside mutation code.

### LEDGER-10 — P1 — Spending and cash reports apply incompatible ledger semantics

**Evidence**

- A normal expense is debit Expense / credit Asset: `backend/src/services/ledger.ts:181-186`
- The income statement correctly evaluates expense accounts as debit minus credit: `backend/src/services/reports.ts:147-203`
- Insights instead derive spending from journal credits across transactions: `backend/src/routes/insights.ts:207-235`
- Budget queries mix credit-based and debit-based totals: `backend/src/routes/budget.ts:57`, `backend/src/routes/budget.ts:104`, and `backend/src/routes/budget.ts:485`
- Cash-flow reporting treats every asset account as cash: `backend/src/services/reports.ts:351-355`
- Cash-flow classification inspects only one counterparty line in a potentially multi-line journal: `backend/src/services/reports.ts:397-403`

**Failure scenario**

Transfers and loan principal can be reported as spending; liability-financed or multi-line expenses can be misclassified; receivables and other non-cash assets can be included in cash. Two dashboards or an LLM tool can therefore answer the same question differently while reading the same journal.

**Required behavior**

Centralize financial metrics in one read-model layer. Spending should be based on expense-account activity with explicit exclusions/reversals; cash flow should use accounts explicitly classified as cash/cash-equivalent and classify the complete journal, not one arbitrary line.

### LEDGER-11 — P2 — Account roll-up is advertised but not implemented

**Evidence**

- Accounts support `parentId`: `backend/src/db/schema.ts:28`
- `computeAccountBalanceRolledUp()` is a documented no-op: `backend/src/services/ledger.ts:378-383`
- The account API offers `includeChildren=true`: `backend/src/routes/accounts.ts:62-73`

Parent-account balances do not include descendants even when the API says they should. This is easy for an agent or report author to trust incorrectly.

**Required behavior**

Implement descendant traversal with cycle protection, or remove the option and rename the function until hierarchy-aware balances exist. Define whether callers that list parent and child accounts should sum only leaves to avoid double counting.

### LEDGER-12 — P2 — Parsed transfer approvals cannot construct a valid transfer

**Evidence**

- `backend/src/routes/pending-transactions.ts:125-156`

Pending approval always chooses one asset account and never supplies `toWalletAccountId`, even when the parsed kind is `transfer`. `createSimpleTransaction()` requires the destination wallet for transfers, so this approval path fails. The account lookup also does not filter for an active account.

**Required behavior**

Require the user or parser to resolve both source and destination accounts, validate that they are distinct active asset accounts, and approve the pending record plus journal in one idempotent database transaction.

---

## 3. Delete and archive behavior

### DELETE-01 — P1 — Generic transaction deletion does not reverse domain state

**Evidence**

- Generic deletion: `backend/src/routes/transactions.ts:721-783`
- Loan payment link: `backend/src/db/schema.ts:329-347`
- PayLater `paidTxId`: `backend/src/db/schema.ts:94-110`
- Subscription renewal advancement: `backend/src/services/subscription-renewals.ts:70-102`

The transaction delete route treats every transaction as a generic journal entry. It does not dispatch based on `txType` or linked domain rows.

**Failure scenarios**

- Deleting a loan-payment journal leaves the `loan_payment` row and reduced `remainingCents`/repaid status intact.
- Deleting a PayLater settlement can leave an installment marked paid with a stale `paidTxId`.
- Deleting a subscription renewal does not rewind `nextRenewalAt`.
- Deleting a salary transaction does not coordinate with the salary-posted idempotency marker.
- Deleting one side of a linked transaction leaves other entries pointing to a missing `linkedTxId` because it is not enforced as a foreign key.

**Required behavior**

Choose and document one model:

1. Reject deletion of domain-owned transactions and require deletion/reversal through the owning domain endpoint; or
2. Implement domain-aware reversal commands for loan payments, loan creation, PayLater recognition/settlement, subscriptions, salary, transfers, and wishlist fulfillment.

For accounting history, a reversal entry is usually safer than destructive deletion after a period is closed.

### DELETE-02 — P1 — Deleting a loan-creation transaction bypasses the loan safeguard

**Evidence**

- Transaction route soft-deactivates linked loans: `backend/src/routes/transactions.ts:745-760`
- Dedicated loan deletion rejects loans with payments: `backend/src/routes/loans.ts:503-510`

Deleting the originating transaction soft-deactivates the loan without checking whether payments exist. This bypasses the dedicated endpoint's safety rule and can hide a loan while retaining repayment rows and repayment transactions.

**Required behavior**

The transaction endpoint must reject this operation and direct the user to the loan workflow, or call the exact same validated domain service.

### DELETE-03 — P1 — Single and bulk transaction deletion are not atomic

**Evidence**

- Single delete: `backend/src/routes/transactions.ts:725-782`
- Bulk delete: `backend/src/routes/transactions.ts:794-849`

Loan deactivation, tag deletion, line deletion, transaction deletion, audit logging, and cache invalidation are separate operations. Bulk deletion also commits item-by-item.

**Failure scenarios**

- A loan is deactivated but the journal entry remains.
- Tags and lines are deleted but the transaction row remains.
- Some bulk items are deleted, a later item fails, and the API returns one generic 500 without identifying committed items.
- Audit failure makes an already-completed delete appear to have failed.

**Required behavior**

- Wrap all database changes for one deletion in one transaction.
- Define whether a bulk request is all-or-nothing. Prefer all-or-nothing for financial records, or return explicit per-item committed results.
- Perform cache invalidation after commit and make it safely retryable.

### DELETE-04 — P1 — Transaction deletion leaks external attachment objects

**Evidence**

- Transaction delete removes database rows at `backend/src/routes/transactions.ts:762-764`.
- Attachment metadata cascades from the transaction in `backend/src/db/schema.ts:153-161`.
- External deletion exists only in the direct attachment route at `backend/src/routes/attachments.ts:209-215`.

Deleting a transaction can cascade-delete attachment metadata, but no code deletes the R2/local file. Loan-payment attachment cascades have the same external-resource problem.

**Required behavior**

- Collect all external object keys before the database delete.
- Commit the database state with durable cleanup jobs/outbox rows.
- Retry object deletion until successful.
- Preserve tombstone/cleanup records long enough to diagnose failures.

### DELETE-05 — P2 — Direct attachment deletion loses cleanup information

**Evidence**

- `backend/src/routes/attachments.ts:206-230`

The route deletes storage first, then metadata. When storage deletion fails, it still deletes metadata and returns success with a warning. That discards the only application-level key needed to retry cleanup. If storage succeeds but the database delete fails, metadata points to a missing file.

**Required behavior**

Use a durable state machine such as `active -> pending_delete -> deleted`, plus a cleanup outbox. A storage failure should remain visible and retryable.

### DELETE-06 — P2 — Period deletion leaves dangling transaction period IDs

**Evidence**

- `transactions.periodId` is an unenforced integer at `backend/src/db/schema.ts:42`.
- Period deletion is at `backend/src/routes/periods.ts:139-157`.

Budget plans cascade and wishlist references can be nulled, but transactions retain the deleted period ID.

**Required behavior**

Add a foreign key with a deliberate policy (`SET NULL` is likely safest), migrate existing invalid rows, invalidate period caches, and consider preventing deletion of closed/nonempty periods in favor of archive/reopen semantics.

### DELETE-07 — P2 — Loan deletion returns incorrect HTTP responses

**Evidence**

- Missing-loan reply inside callback: `backend/src/routes/loans.ts:498-500`
- Payment safeguard: `backend/src/routes/loans.ts:503-510`
- Unconditional 204 and generic 500: `backend/src/routes/loans.ts:527-532`

**Problems**

- A loan with payments produces an expected business-rule error but is converted to HTTP 500 instead of 400/409.
- A missing loan sends 404 inside the transaction callback, then execution continues and attempts to send 204.

**Required behavior**

Do not send replies from inside the database callback. Return a typed result or throw typed domain errors, then map them once after the transaction completes.

### DELETE-08 — P2 — Delete followed by audit can return a false failure

**Evidence**

- Categories: `backend/src/routes/categories.ts:127-141`
- Subscriptions: `backend/src/routes/subscriptions.ts:293-307`
- Wishlist: `backend/src/routes/wishlist.ts:291-310`
- Transactions: `backend/src/routes/transactions.ts:762-782`

The entity is deleted before `auditDelete()` runs, without one database transaction. If the audit insert fails, the API can return 500 even though the entity is already gone.

**Required behavior**

Persist the delete and audit row in the same transaction. If audit must be asynchronous, use an outbox and do not report the core deletion as failed after commit.

### DELETE-09 — P2 — Account “delete” can strand balances and dependencies

**Evidence**

- Active-only listing: `backend/src/routes/accounts.ts:21-57`
- Soft delete: `backend/src/routes/accounts.ts:211-230`

The endpoint only sets `isActive = false`. It does not check for a nonzero balance, active subscriptions, salary deposit settings, active loans, or child accounts. The normal account list immediately hides the account.

**Failure scenarios**

- A nonzero balance becomes hidden and cannot be selected for a closing transfer.
- Subscription renewals and salary posting continue referencing an inactive account and begin failing.
- The user has no obvious restore workflow.

**Required behavior**

- Treat this as archive, not delete.
- Block archive or require confirmation when balance/dependencies exist.
- Offer “transfer remaining balance and archive.”
- Expose an archived-account list and restore action.
- Decide whether archived balances remain in net-worth reporting and make that behavior visible.

### DELETE-10 — P2 — Category deletion has no dependency strategy

**Evidence**

- `backend/src/routes/categories.ts:127-141`
- Category relationships have mixed `NO ACTION`, `SET NULL`, and `CASCADE` policies in `backend/src/db/schema.ts` and the migrations.

A used category may fail deletion because transactions/budgets use `NO ACTION`, while template items can be cascaded and wishlist/subscription references can be nulled. The endpoint gives no dependency preview, reassignment option, or consistent policy.

**Required behavior**

Return a dependency summary and require reassignment, archive the category, or explicitly confirm which downstream records will be changed.

---

## 4. Cache invalidation and derived-state integrity

### CACHE-01 — P1 — Transaction edits never invalidate any cache

**Evidence**

- Transaction update: `backend/src/routes/transactions.ts:607-717`
- Cache invalidation is present for delete but absent from PUT: `backend/src/routes/transactions.ts:768-775`

The transaction PUT route can change the date, period, category, transaction type, and complete journal-line set without invalidating account balances, period summaries, net worth, burn rate, runway, trial balance, or generated insights.

**Failure scenario**

Moving an expense from account A to account B leaves both cached balances wrong. Moving it to another date leaves the old and new period summaries wrong. Changing an expense into a transfer leaves burn-rate and spending-derived answers wrong. The most important dashboards can remain wrong for up to the 24-hour analytics TTL.

**Required behavior**

Capture both the pre-mutation and post-mutation dependency sets. After commit, invalidate the union of old/new account IDs, old/new date-derived period IDs, analytics aggregates, and insight versions. Metadata-only edits should invalidate any generated narrative that embeds the changed metadata.

### CACHE-02 — P1 — Several direct ledger mutations bypass invalidation entirely

**Evidence**

- Wishlist fulfillment writes a transaction and one line directly: `backend/src/routes/wishlist.ts:340-359`
- Loan deletion deletes its journal inside a DB transaction but performs no post-commit invalidation: `backend/src/routes/loans.ts:491-526`
- Individual and bulk transaction deletion omit `affectedPeriodIds`: `backend/src/routes/transactions.ts:768-775` and `backend/src/routes/transactions.ts:835-842`

Wishlist fulfillment can leave every derived balance stale. Loan deletion leaves the affected wallet/loan account, net worth, trial balance, and period summary stale. Normal deletion invalidates account/analytics keys but leaves the deleted transaction in cached period summaries for their remaining TTL.

**Required behavior**

Prohibit route-level writes to journal tables. All journal changes must emit one committed mutation event containing old/new accounts, dates, periods, transaction type, and category. Cache consumers should invalidate from that event, not from whichever route happened to perform the write.

### CACHE-03 — P1 — Failed invalidation is reported as success and can preserve stale values

**Evidence**

- Redis delete and set helpers catch every error and return normally: `backend/src/cache/redis.ts:80-114`
- Mutation invalidation trusts those helpers: `backend/src/cache/invalidation.ts:71-89`
- The eager mutation path overwrites without first invalidating: `backend/src/cache/invalidation.ts:92-115`

If Redis is unavailable during a DB commit, invalidation silently does nothing. When Redis reconnects, the old 24-hour analytics value is still present and is served as valid. The eager path is worse: `cacheSet()` can fail silently while an older key remains, yet the mutation caller has no indication that derived state is dirty.

**Required behavior**

DB success must durably record a monotonic data revision or cache-invalidation outbox item. Reads should reject cached objects whose source revision is older than the DB revision. Redis failure may degrade performance, but must not make stale financial data look authoritative.

### CACHE-04 — P1 — Cache-aside and eager recomputation have stale-write races

**Evidence**

- Cache miss computes from the DB and later writes Redis: `backend/src/cache/invalidation.ts:117-126`
- Ledger recomputation is fire-and-forget: `backend/src/services/ledger.ts:546-559`
- Every ledger creation recomputes the same global aggregates: `backend/src/cache/invalidation.ts:92-115`
- Bulk import invokes the ledger once per row: `backend/src/routes/transactions.ts:918-943`

**Race examples**

1. A reader misses the cache and starts computing revision N.
2. A mutation commits revision N+1 and invalidates the key.
3. The old reader finishes last and writes revision N back into Redis.

Concurrent eager recomputations can also finish out of order. A large import launches global net-worth, burn-rate, runway, trial-balance, account, and period recomputation for every imported row, creating a cache/DB stampede and many opportunities for an older calculation to win.

**Required behavior**

Use revisioned cache values and compare-and-set, or invalidate after commit and recompute lazily with single-flight locking. Batch commands should publish one aggregate invalidation after their final commit, never one global recomputation per row.

### CACHE-05 — P1 — LLM insight caches are outside the invalidation system

**Evidence**

- Insight keys and 24-hour TTL: `backend/src/routes/insights.ts:7` and `backend/src/routes/insights.ts:137-151`
- Transaction invalidation deletes only `account:*`, `period:*`, and `analytics:*`: `backend/src/cache/invalidation.ts:12-44`
- Latest-insight endpoints report the request time as `generatedAt`: `backend/src/routes/insights.ts:572-600`

No financial mutation invalidates `insights:*`. A generated budget/dashboard narrative remains available after transaction edits, deletes, imports, reconciliations, period changes, and automatic postings. The latest endpoint then labels the old text with the current request time, making it appear freshly generated.

**Required behavior**

Store the actual generation timestamp and source data revision with every insight. Return `stale: true` when the ledger revision changes, and require regeneration before an agent treats it as current. Include insight namespaces in explicit financial invalidation; do not rely on TTL.

### CACHE-06 — P1 — Account and period mutations invalidate only fragments of their dependency graph

**Evidence**

- Account type/status/hierarchy can change, but PATCH only recomputes that account balance: `backend/src/routes/accounts.ts:143-209`
- Account archive performs no invalidation: `backend/src/routes/accounts.ts:213-230`
- Period deletion does not delete its summary key: `backend/src/routes/periods.ts:139-158`
- The period-summary API returns Redis before verifying the period exists: `backend/src/routes/analytics.ts:86-101`

Changing an account from asset to liability changes balance sign, net worth, runway, and report classification, but global analytics remain cached. Archiving an account leaves direct cache endpoints able to serve the old balance. A deleted period can continue returning a cached summary as HTTP 200 until its TTL expires.

**Required behavior**

Model dependencies by mutation type. Account type/status/parent changes must invalidate the account, ancestors/descendants, analytics, reports, and insights. Period deletion must remove its key before returning; cache-backed ID endpoints must still validate entity existence or encode entity revision/tombstones.

### CACHE-07 — P2 — Cache hits and misses return different API shapes and values

**Evidence**

- Cache-hit helpers return the full cached object, while misses return selected fields: `backend/src/cache/invalidation.ts:128-217`
- Runway uses `Infinity` when burn rate is zero: `backend/src/cache/precompute.ts:248-274`
- Redis values are JSON encoded: `backend/src/cache/redis.ts:80-91`

The first uncached response can omit `computedAt`, liquidity details, or gross burn fields, while a later cache hit includes them. `JSON.stringify(Infinity)` stores `null`, so a zero-burn runway can be `Infinity` on a miss and `null` on the next hit.

**Required behavior**

Define one response DTO per endpoint and return it identically on hit/miss. Represent an unbounded runway explicitly, for example `{ runwayMonths: null, isInfinite: true }`, rather than serializing non-JSON numeric values.

### CACHE-08 — P2 — Startup precomputation does not clear obsolete keys

**Evidence**

- Startup only overwrites current active accounts/periods/analytics: `backend/src/cache/precompute.ts:69-80` and `backend/src/cache/precompute.ts:303-313`
- Startup invokes precomputation without an initial namespace invalidation: `backend/src/server.ts:223-231`

Keys for deleted periods, archived/deleted accounts, restored databases, or an earlier schema/data revision survive startup until TTL. A database restore can therefore start successfully while Redis still describes a different database snapshot.

**Required behavior**

Namespace all financial keys by a database/data revision. On restore or startup schema revision change, switch namespaces atomically or clear the old namespace. Avoid Redis `KEYS` for production-wide pattern deletion; use versioned prefixes or `SCAN`.

---

## 5. Recurring jobs, automatic payments, and dates

### SCHED-01 — P1 — Salary auto-posting can duplicate income

**Evidence**

- Redis check: `backend/src/services/salary-posting.ts:30-36`
- Ineffective database queries: `backend/src/services/salary-posting.ts:58-85`
- Transaction creation and later Redis write: `backend/src/services/salary-posting.ts:124-139`

The database checks query salary transactions but never use the result to stop posting and do not filter to the current payroll occurrence. Idempotency is a non-atomic Redis `GET`, followed much later by transaction creation and `SETEX`.

**Failure scenarios**

- Two app instances or requests see no key and both post salary.
- Redis data loss/restart on payroll day allows another posting.
- A process crash after transaction creation but before `SETEX` allows a retry duplicate.

**Required behavior**

Store a durable occurrence key in SQLite, e.g. `(job_type, schedule_id, occurrence_date)` with a unique constraint, and create the journal entry in the same transaction that claims the occurrence.

### SCHED-02 — P2 — Monthly/yearly date addition drifts at month ends

**Evidence**

- `backend/src/services/subscription-renewals.ts:17-28`

Using `Date.setMonth()` on January 31 can roll into March. Using `setFullYear()` on February 29 can roll into March of the following year.

**Required behavior**

Preserve an explicit billing-day policy and clamp to the last valid day of the target month. Add tests for the 28th-31st, leap years, time zones, and DST boundaries.

### SCHED-03 — P1 — Subscription catch-up mutates on GET and can post months immediately

**Evidence**

- Listing subscriptions invokes renewals: `backend/src/routes/subscriptions.ts:51-68`
- Catch-up loop: `backend/src/services/subscription-renewals.ts:56-107`

Opening the subscriptions page can generate financial transactions. The loop repeats until every past due occurrence is posted.

**Failure scenario**

After a six-month absence, simply viewing the page can synthesize six charges per active subscription before the user confirms whether the subscription remained active.

**Required behavior**

- Never mutate on GET.
- Detect missed occurrences and return a preview/queue.
- Let the user confirm, skip, edit, cancel, or resume from today.
- Add a maximum catch-up count and durable occurrence-level idempotency.

### SCHED-04 — P2 — Stricter route-specific rate limits appear unscoped from real routes

**Evidence**

- `backend/src/server.ts:92-188`

The code registers rate-limit plugins inside prefixed encapsulated scopes that contain no actual routes. The real route modules are registered later as siblings and use `/api/...` paths. The global 1000/minute limit remains, but the stricter auth/import/upload/report/scraper limits may never apply.

**Required behavior**

Attach route-specific rate limits directly in route options or register the routes inside the same encapsulated plugin scope. Verify with injection tests that the 11th/21st/etc. request receives 429 as intended.

### AUTOPAY-01 — P1 — Concurrent renewal runners can duplicate every subscription occurrence

**Evidence**

- Due subscriptions are selected without a claim/lock: `backend/src/services/subscription-renewals.ts:52-64`
- The journal is posted before an unconditional schedule update: `backend/src/services/subscription-renewals.ts:70-96`
- Renewals can run from startup, hourly interval, GET, and a manual POST: `backend/src/server.ts:259-274` and `backend/src/routes/subscriptions.ts:48-75`
- Transaction `reference` is not unique and there is no recurring-occurrence table: `backend/src/db/schema.ts:37`

Two workers can both read the same `nextRenewalAt`, both post `sub:{id}:{dueMs}`, and both set the same next date. During multi-month catch-up, they can duplicate each missed month. SQLite write serialization does not prevent this because the due read, journal writes, and schedule update are not one conditional occurrence claim.

**Required behavior**

Insert/claim a durable occurrence with a unique `(job_type, schedule_id, occurrence_date)` key, then create the journal and mark the occurrence posted in one DB transaction. Updating the schedule must use compare-and-swap on the expected due date. Multiple runners should turn into harmless unique conflicts, not duplicate money.

### AUTOPAY-02 — P1 — A renewal retry can duplicate a successfully posted charge

**Evidence**

- Posting and schedule advancement are separate writes: `backend/src/services/subscription-renewals.ts:70-96`
- Journal creation is itself non-atomic: `backend/src/services/ledger.ts:458-536`

If the journal commits and subscription advancement fails—or the process exits between them—the due date remains unchanged. The next hourly/request/manual run posts the same occurrence again. The textual reference cannot prevent this because it has no unique constraint.

**Required behavior**

The occurrence claim, journal header/lines, subscription pointer update, and audit record must commit together. Retry the same occurrence ID rather than rerunning an inferred due-date loop.

### AUTOPAY-03 — P1 — Invalid subscription configurations are accepted and then retry forever

**Evidence**

- Create/update validate only that the linked account exists, not active state or asset/liability type: `backend/src/routes/subscriptions.ts:102-114` and `backend/src/routes/subscriptions.ts:194-208`
- The route accepts amount zero: `backend/src/routes/subscriptions.ts:115-118` and `backend/src/routes/subscriptions.ts:215-222`
- The worker rejects zero amounts and unsupported/inactive accounts: `backend/src/services/subscription-renewals.ts:64-87` and `backend/src/services/ledger.ts:253-305`
- `skippedNoAccount` is returned but never incremented: `backend/src/services/subscription-renewals.ts:7-12` and `backend/src/services/subscription-renewals.ts:49-50`

These subscriptions remain due, fail every hour and every list request, and have no persisted failure state, retry count, next retry time, or actionable status. The API can misleadingly report zero skipped accounts while returning repeated error strings.

**Required behavior**

Reject impossible configurations at write time. Persist occurrence failures with an error code and bounded retry policy, then mark the schedule `needs_attention` instead of retrying forever. Validate positive integer amount, active account, supported account type, category existence, and a valid next date.

### AUTOPAY-04 — P1 — Manual “subscription payment” linkage advances schedules for the wrong transaction kinds

**Evidence**

- The frontend sends `subscriptionId` for transfer, income, or expense forms: `frontend/src/components/transactions/TransactionModal.tsx:830-889`
- `createSimpleTransaction()` forwards it for every kind: `backend/src/services/ledger.ts:161-236`
- The generic journal primitive advances the subscription whenever the field is present: `backend/src/services/ledger.ts:487-512`

An income entry or internal transfer can advance a subscription even though no subscription expense was recorded. The advancement is based on the schedule’s current pointer, not on the transaction date or a selected occurrence. Early, late, duplicate, and backdated payments therefore cannot be matched reliably.

**Required behavior**

Remove subscription mutation from the generic ledger. Expose an explicit `recordSubscriptionOccurrencePayment` command that accepts a concrete occurrence ID, validates the permitted journal shape, and posts/links/advances atomically.

### AUTOPAY-05 — P1 — Automatic and manual subscription transactions cannot be safely deleted or traced

**Evidence**

- Automatic renewal helper does not set `transaction.subscriptionId`; it stores only a free-text reference: `backend/src/services/ledger.ts:240-303` and `backend/src/services/subscription-renewals.ts:70-83`
- Manual linked transactions advance the schedule, but generic deletion does not rewind it: `backend/src/routes/transactions.ts:720-781`
- Transaction-to-subscription FK has no deletion policy: `backend/src/db/schema.ts:58-59`
- Subscription’s linked account uses `ON DELETE CASCADE`: `backend/src/db/schema.ts:201-205`

Deleting an automatic renewal cannot reliably locate or reverse its schedule occurrence. Deleting a manual subscription payment leaves `nextRenewalAt` advanced. Deleting a subscription that has manual linked transactions can fail on the FK; hard-deleting a payment account can instead cascade-delete the subscription configuration.

**Required behavior**

Link every recurring journal to an immutable occurrence row. Reverse/cancel the occurrence through a domain command, never by guessing from `reference`. Use deliberate FK policies (`RESTRICT` or `SET NULL` plus dependency workflow); a payment-account deletion must pause/reassign subscriptions, not silently delete schedules.

### AUTOPAY-06 — P1 — Salary occurrence identity uses UTC while payroll eligibility uses local time

**Evidence**

- Payroll day uses local `Date.getDate()`: `backend/src/services/salary-posting.ts:25-27`
- Redis key uses `toISOString()` UTC date: `backend/src/services/salary-posting.ts:10-12`

In Jakarta, one local payroll day spans two UTC date strings. A run shortly after local midnight can set one Redis key and a later hourly run after the UTC boundary can see a different key and post the same local salary again.

**Required behavior**

Define the payroll calendar and time zone explicitly. Occurrence identity should be a logical payroll period such as `salary:settings-1:2026-08`, stored durably and uniquely in SQLite—not a process-local current timestamp converted through two different calendars.

### AUTOPAY-07 — P1 — Salary posting misses absences and payroll days that do not exist

**Evidence**

- Posting requires `todayDay === payrollDay`: `backend/src/services/salary-posting.ts:48-51`
- Settings permit payroll days 1 through 31: `backend/src/routes/salary-settings.ts:181-184`
- The scheduler only asks about the current day: `backend/src/server.ts:276-290`

If the service is offline on payroll day, that month is never posted. After months away, there is no missed-occurrence detection. Payroll day 31 never occurs in several months; day 29/30 also fails in shorter February. Manual `post-salary` uses the same exact-day guard and cannot recover a missed month.

**Required behavior**

Generate logical monthly occurrences with an explicit “last valid day” policy. On return, preview missing occurrences and allow backfill/skip/resume decisions. Salary settings should define whether day 31 means month-end.

### AUTOPAY-08 — P1 — Salary’s Redis dependency can either stop posting or allow duplicates

**Evidence**

- Salary uses raw Redis calls rather than failure-tolerant cache wrappers: `backend/src/services/salary-posting.ts:30-36` and `backend/src/services/salary-posting.ts:136-139`
- Redis `GET`, journal creation, and `SETEX` are separate operations: `backend/src/services/salary-posting.ts:30-139`

Redis unavailable during the initial GET prevents salary posting entirely. Redis failure or process exit after the journal but before `SETEX` reports failure even though money was posted; the next run can duplicate it. Two callers can pass GET concurrently. The purported DB duplicate queries are unused and do not filter by date.

**Required behavior**

Redis must never be the source of truth for financial idempotency. Claim and post a unique SQLite occurrence transactionally. Redis may cache the result after commit.

### AUTOPAY-09 — P1 — Recurring timers have no leader election or in-flight guard

**Evidence**

- Each web-server process starts its own timers: `backend/src/server.ts:259-290`
- `setInterval()` starts a new async run without awaiting the prior run: `backend/src/server.ts:270-290`

Multiple application instances all act as schedulers. A slow catch-up can overlap the next interval, and routes can launch the same worker concurrently. There is no lease, heartbeat, fencing token, or job-run record.

**Required behavior**

Use a single durable job runner or database-backed leases with fencing. Even with leader election, occurrence uniqueness remains mandatory because leases expire and processes crash.

### AUTOPAY-10 — P1 — Checked-in migrations do not contain `transaction.subscription_id`

**Evidence**

- The runtime schema writes `subscription_id`: `backend/src/db/schema.ts:58-59` and `backend/src/services/ledger.ts:478-480`
- The checked-in transaction migration has no such column: `backend/drizzle/0000_broad_cerise.sql:156-181`
- Later migrations do not add it.
- Startup explicitly does not run migrations: `backend/src/db/migrate.ts:8-17`

A database created or upgraded only from the checked-in migrations lacks the column that every journal insert includes, potentially breaking all transaction creation—not only subscription payments. Existing manually pushed databases may hide the defect.

**Required behavior**

Generate and test a real forward migration, run migrations before serving traffic, and add a startup schema-version check that fails fast with a precise message. CI should build a blank DB solely from migrations and run integration tests against it.

### AUTOPAY-11 — P2 — “Auto-pay” records bookkeeping but performs no external payment

**Evidence**

- Subscription processing only creates local journal entries and advances a local date: `backend/src/services/subscription-renewals.ts:70-96`
- A liability-linked subscription credits the card/liability, increasing the amount owed: `backend/src/services/ledger.ts:282-303`

For a card-linked subscription this records a charge, not settlement of the card. There is no bank/card/provider instruction or confirmation. Calling the feature auto-pay can cause a user or agent to believe an external bill was actually paid.

**Required behavior**

Label the current feature “auto-record” or “scheduled posting.” If real payment initiation is later added, model requested/authorized/submitted/confirmed/failed states separately and post final ledger effects from provider-confirmed events.

### AUTOPAY-12 — P2 — Salary posting preview can disagree with the actual posting

**Evidence**

- Actual posting supplies customized payroll/BPJS settings: `backend/src/services/salary-posting.ts:102-119`
- Preview calls `estimatePayroll()` with only gross salary and PTKP: `backend/src/services/salary-posting.ts:170-171`

Users can approve or expect one net amount while the automatic job posts another.

**Required behavior**

Use one shared calculation function and settings object for preview and posting, and include a settings revision/hash in the occurrence preview.

### PAYMENT-01 — P1 — PayLater settlements never mark installments paid

**Evidence**

- Installments have `status` and `paidTxId`: `backend/src/db/schema.ts:94-113`
- Settlement only posts a journal; it never updates installments: `backend/src/services/paylater.ts:367-447`
- Obligation calculation ignores settlement children whenever pending installments exist: `backend/src/services/paylater.ts:556-619`

For installment-based obligations, making a settlement leaves every installment pending. Outstanding balance is calculated as the sum of pending installments, so it does not decrease even though cash and liability ledger balances changed. The schedule continues showing paid installments as due/overdue.

**Required behavior**

Require either a specific installment allocation or a deterministic oldest-due-first allocation. Post the settlement, update fully/partially paid installment state, link `paidTxId` or a payment-allocation table, and audit it in one transaction. Deleting/reversing the settlement must restore the allocation.

### PAYMENT-02 — P1 — PayLater recognition relies on fabricated auto-balancing and can leave a partial schedule

**Evidence**

- Recognition debits only principal but credits principal plus interest/fees: `backend/src/services/paylater.ts:202-238`
- The ledger silently inserts the missing expense debit: `backend/src/services/ledger.ts:404-428`
- Journal metadata and installments are written afterward in separate commits: `backend/src/services/paylater.ts:240-268`

Interest and fees are silently dumped into the generic auto-expense account instead of explicit accounts/timing. If metadata or installment insertion fails, the journal remains with zero or only some schedule rows.

**Required behavior**

Define the intended recognition policy explicitly: recognize interest/fees upfront in named accounts or accrue them per installment. Construct a genuinely balanced journal and create its full schedule atomically. The ledger primitive must reject the current incomplete input.

---

## 6. Reconciliation audit

### RECON-01 — P1 — Reconciliation misclassifies every difference as income or expense

**Evidence**

- `backend/src/routes/accounts.ts:286-311`

Positive differences become income and negative differences become expense through `createSimpleTransaction()`.

**Failure scenario**

An omitted transfer of Rp1,000,000 from Bank A to Bank B produces Rp1,000,000 of expense on A and Rp1,000,000 of income on B. Net worth may match, but income, spending, budgets, burn rate, and reports are polluted.

**Required behavior**

Let the user classify the difference as:

- Missing transfer.
- Missing income/expense.
- Fee/interest.
- Liability adjustment.
- Opening-balance equity adjustment.
- Temporary reconciliation suspense pending investigation.

Do not default unexplained return-after-absence differences into current-period P&L.

### RECON-02 — P1 — Adjustments are dated today and left without a period

**Evidence**

- Date is `new Date()` at `backend/src/routes/accounts.ts:293` and `:306`.
- No `periodId` is passed.

There is no statement/as-of date. A six-month gap becomes one adjustment today, while period-filtered reports may omit the adjustment because `periodId` is null.

**Required behavior**

- Require `asOfDate` for a reconciliation session.
- Resolve the matching period explicitly.
- If no period exists, require the user to create one, choose an opening-balance restart, or leave the item in a visible unassigned review queue.

### RECON-03 — P1 — Partial failure is displayed as success

**Evidence**

- Per-item errors are caught: `backend/src/routes/accounts.ts:321-323`.
- API always returns `success: true`: `backend/src/routes/accounts.ts:326`.
- Frontend ignores response results and closes: `frontend/src/components/reconciliation/ReconciliationModal.tsx:117-134`.

Some accounts can fail while others post adjustments, yet the user receives no account-level failure notice.

**Required behavior**

Prefer atomic all-or-nothing reconciliation. If partial completion is intentional, return a non-success status and keep the modal open with explicit committed/failed rows.

### RECON-04 — P1 — Reconciliation is vulnerable to stale previews and duplicate submission

The modal shows balances captured when it opens, but the server does not receive an expected ledger balance/version. It recalculates at submission and may post a different adjustment from the one the user reviewed. Two concurrent requests can both calculate and post the same difference.

**Required behavior**

- Include expected ledger balance or account version in each submitted row.
- Lock/check versions inside one transaction.
- Reject with 409 if balances changed and return a refreshed preview.
- Give the reconciliation session an idempotency key.
- Disable and deduplicate repeat submissions server-side, not only in the UI.

### RECON-05 — P2 — Only active asset accounts can be reconciled

**Evidence**

- `frontend/src/components/reconciliation/ReconciliationModal.tsx:49-51`

Credit cards, PayLater liabilities, loan balances, and archived accounts are excluded. The backend also routes adjustments through `createSimpleTransaction()`, which expects an active asset wallet.

**Required behavior**

Support asset and liability statement balances with account-type-aware journal direction. Archived nonzero accounts must remain available for closing reconciliation or restoration.

### RECON-06 — P2 — No durable reconciliation record exists

The current operation only creates transactions. It does not store:

- Statement/as-of date.
- Starting ledger balance.
- Submitted statement balance.
- Adjustment classification and explanation.
- Cleared/reconciled transaction state.
- Attachments such as statements.
- Who/when confirmed the session.
- Whether the session was later reversed.

**Required behavior**

Add reconciliation session and per-account reconciliation item records. A minimal design is outlined below.

### RECON-07 — P1 — The app conflates reconciliation with an adjustment transaction

**Evidence**

- The reconciliation endpoint has no session or matching phase; any nonzero difference immediately calls `createSimpleTransaction()`: `backend/src/routes/accounts.ts:233-320`
- A zero-difference account only produces an ephemeral response row: `backend/src/routes/accounts.ts:278-282`

Reconciliation is a control process, not inherently a financial transaction. A successful reconciliation may create no journal at all: it can simply prove that a dated statement balance agrees with the ledger after cleared items and valid timing differences are considered. The current implementation cannot record that evidence.

Conversely, when a real omission is found, the resulting adjustment is a normal accounting event discovered during reconciliation. It should be classified by its economic substance and linked back to the session—not treated as “the reconciliation” itself.

**Required behavior**

1. Create a draft reconciliation session for one account and statement/as-of date.
2. Record statement opening/ending balance and statement evidence.
3. Match/clear existing ledger transactions against statement items.
4. Record legitimate timing differences without changing the ledger.
5. Present the remaining unexplained difference.
6. Only after explicit classification/approval, create any necessary adjustment journal.
7. Complete the session even when no adjustment transaction was needed.

### RECON-08 — P1 — Timing differences are forced into false P&L instead of remaining outstanding

The system has no cleared/reconciled status, statement line, deposit-in-transit, outstanding payment, pending card charge, or unmatched-item model. Therefore a payment that is in the ledger but has not reached the bank statement—or vice versa—looks like a balance error and is plugged into income/expense.

**Failure scenario**

The ledger contains a Rp500,000 transfer dated August 31, but the receiving bank posts it September 1. Reconciling the August 31 statements should show an outstanding transfer/timing difference. The current flow instead creates expense on one account and income on the other, then the real transfer appears later and duplicates the economic effect.

**Required behavior**

Track statement lines and their match state separately from posted journals. Timing items remain outstanding and roll into the next reconciliation; they do not create P&L unless evidence shows a genuine fee, interest item, loss, or other omitted event.

### RECON-09 — P1 — “Reconciliation” category/source is used as economic classification and reports disagree about it

**Evidence**

- Every adjustment is assigned the same `Reconciliation` category: `backend/src/routes/accounts.ts:245-310`
- LLM insight queries hide transactions by a description substring: `backend/src/routes/insights.ts:202-230`
- The formal P&L includes the generic auto-income/expense account activity: `backend/src/services/reports.ts:114-203`

A genuine bank fee discovered during reconciliation should be a bank-fee expense; interest should be interest income; a missing transfer should remain a transfer; an opening correction should use equity/suspense. `Reconciliation` describes provenance, not economic category.

The current formal P&L includes these plugs while insight calculations hide descriptions containing “Reconciliation,” so the UI/LLM and financial statements disagree.

**Required behavior**

Store reconciliation as `source_type/source_id` metadata on the matched or created event. Preserve the real category/account classification. Exclude only explicitly defined opening/suspense items from operational metrics; do not filter financial facts using description text.

### RECON-10 — P1 — Reversal must reverse the adjustment without erasing reconciliation evidence

There is no model for reopening or reversing a completed reconciliation. Deleting its generated transaction would leave no durable explanation and, under the current generic delete behavior, would not restore any session state.

**Required behavior**

A completed reconciliation should be immutable. Reopen through an audited command, post a linked reversing journal for any adjustment, unmatch affected statement items as necessary, and preserve both the original completion and reversal history.

---

## 7. Returning after months away

### Current behavior

| Area | Current result after an absence |
| --- | --- |
| Subscriptions | All overdue occurrences are posted automatically in a loop; opening the subscription list can trigger it. |
| Salary | No backfill. Salary posts only if the app runs on the configured payroll day. |
| Salary periods | “Auto-create” creates only one next historical period per request. Several missed months require repeated creation. |
| New transactions | Dates outside existing salary periods receive `periodId = null`. |
| Budgets | Missing periods and budget plans are not rebuilt or intentionally skipped. |
| Reconciliation | The whole balance gap is collapsed into income/expense adjustments dated today. |
| Loans | Overdue state is derived, but missing real payments are not reconstructed. |
| PayLater | Installments can display overdue, but missing settlements are not reconstructed. |

### Required return workflow

When the latest period/activity is materially behind today, show a **Return to Fainens** workflow before running recurring mutations.

The user should choose one of three explicit modes.

#### Mode A — Backfill history

Use when the user wants accurate historical reporting.

1. Generate all missing salary periods in a preview, up to the current period.
2. Import bank/card statements for the gap.
3. Detect duplicates against existing transactions.
4. Preview missed subscription occurrences and salary occurrences.
5. Let the user deselect, edit, cancel, or confirm each occurrence.
6. Assign confirmed entries to the correct historical period.
7. Reconcile each account to a dated statement only after imports and recurring entries are posted.

#### Mode B — Resume from today

Use when historical accuracy is not required.

1. Record the skipped interval explicitly.
2. Do not synthesize salary or subscription transactions for the skipped months.
3. Move each recurring schedule to the next occurrence on or after the selected resume date.
4. Create only the current period.
5. Reconcile current balances using opening-balance equity/suspense adjustments, not ordinary income/expense.

#### Mode C — Opening-balance restart

Use when the user wants a clean current starting point but preserved old history.

1. Choose an `asOfDate` and enter asset and liability statement balances.
2. Preserve all prior transactions as historical/closed.
3. Post adjustments against a dedicated Opening Balance Equity account, or a reviewable Reconciliation Suspense account.
4. Do not include these adjustments in normal income/expense analytics.
5. Start a new current period and recurring schedule baseline.

### Important UX requirement

Do not assume one mode globally. The user may want to backfill one bank account, restart another, skip a canceled subscription, and resume salary only from the current month.

---

## 8. Suggested data model

This is a design sketch, not a final migration.

### Reconciliation session

Suggested fields:

- `id`
- `account_id`
- `as_of_date`
- `statement_opening_balance`, `statement_ending_balance`
- `ledger_revision_at_preview`
- `mode`: `normal | backfill | opening_restart`
- `status`: `draft | matching | previewed | committed | reopened | reversed`
- `idempotency_key` (unique)
- `statement_attachment_id` or external evidence reference
- `notes`
- `created_at`, `committed_at`, `reopened_at`, `reversed_at`

### Reconciliation item

Suggested fields:

- `id`
- `session_id`
- `account_id`
- `expected_ledger_balance`
- `actual_statement_balance`
- `difference`
- `classification`
- `counterparty_account_id` or `adjustment_account_id`
- `period_id`
- `adjustment_transaction_id`
- `error`

### Reconciliation statement line and match

Suggested fields:

- Statement line: `id`, `session_id`, `posted_date`, `value_date`, `description`, `reference`, `amount`, `running_balance`, `source_fingerprint`.
- Match/allocation: `statement_line_id`, `transaction_id`, optional `transaction_line_id`, `matched_amount`, `status`, `match_method`, `confidence`, `confirmed_at`.
- Outstanding item: `session_id`, `kind` (`deposit_in_transit | outstanding_payment | pending_charge | other`), `amount`, `expected_clear_date`, `carried_to_session_id`, `resolved_transaction_id`.
- Unique source fingerprint per account/import to prevent the same statement line being imported twice.

The adjustment journal, when one is genuinely required, should reference the reconciliation item/session as provenance. It is not a substitute for these records.

### Recurring occurrence

Suggested fields:

- `job_type`: salary/subscription/etc.
- `schedule_id`
- `occurrence_date`
- `status`: pending/confirmed/skipped/posted/failed
- `transaction_id`
- Unique constraint on `(job_type, schedule_id, occurrence_date)`.

### External cleanup outbox

Suggested fields:

- `object_key`
- `provider`
- `entity_type`, `entity_id`
- `status`: pending/running/succeeded/failed
- `attempt_count`, `last_error`, `next_attempt_at`

---

## 9. Accounting and financial semantics deep audit

This section separates bookkeeping mechanics from financial meaning. A balanced journal can still be economically false, and a technically correct cache can still cache the wrong metric.

### ACCOUNTING-01 — P1 — Split bills paid by the user produce the wrong journal

**Evidence**

- One journal is created per other participant, and each journal can include the full personal expense: `backend/src/routes/splitbill.ts:216-247` and `backend/src/routes/splitbill.ts:465-490`
- The newer frontend omits the user's own split when the user paid: `frontend/src/routes/split.tsx:459-480`
- The older modal submits all split results: `frontend/src/components/splitbill/SplitBillModal.tsx:352-372`

Depending on which caller is used, the backend either records the user's personal expense once per borrower or records it zero times. It also credits the wallet separately for each constructed loan rather than recording the receipt as one economic event.

**Correct journal shape**

For a Rp300 receipt where the user consumed Rp100 and two friends owe Rp100 each:

- Dr Food expense Rp100
- Dr Receivable — Friend A Rp100
- Dr Receivable — Friend B Rp100
- Cr Cash/Bank Rp300

This must be one atomic receipt-level journal linked to two loan subledger records.

### ACCOUNTING-02 — P1 — Borrowed split bills lose the payer and depend on fabricated expense

**Evidence**

- Borrowed flow supplies only a Loans Payable credit: `backend/src/routes/splitbill.ts:248-257`
- The ledger invents the debit to the generic auto-expense account: `backend/src/services/ledger.ts:404-428`
- The newer frontend sends only the user's result, while the backend searches for a non-user payer in that result set: `frontend/src/routes/split.tsx:465-480` and `backend/src/routes/splitbill.ts:445-466`

The newer flow can create no loan at all because payer identity is discarded. When a journal is created, its expense exists only because the ledger silently balances it, and it lacks the intended expense category.

**Required behavior**

Pass an explicit payer contact ID and create Dr expense / Cr payable for the user's share. Do not infer the payer from the first non-user split result.

### ACCOUNTING-03 — P1 — Split allocation does not guarantee that parts equal the receipt total

**Evidence**

- Item shares, tax, service, and discounts are independently rounded per person: `backend/src/routes/splitbill.ts:145-210`

`Math.round(item / people)` for every participant can create or lose rupiah. Independent proportional rounding of tax/service/discount can add another residual. There is no final invariant comparing allocated totals with the receipt total.

**Required behavior**

Allocate integer residuals deterministically—largest-remainder or explicit final-participant adjustment—and reject confirmation unless item shares, tax, service, discount, personal expense, receivables/payables, and cash all reconcile exactly.

### ACCOUNTING-04 — P1 — Future-dated transactions affect today's balances and net worth immediately

**Evidence**

- Current account balance sums every journal line without a transaction-date cutoff: `backend/src/services/ledger.ts:324-344`
- Current net worth and runway use that balance: `backend/src/services/analytics.ts:49-86` and `backend/src/services/analytics.ts:260-281`

A transaction dated next month changes today's wallet balance, liabilities, net worth, and runway as soon as it is entered. The historical net-worth path correctly has an as-of filter, so current and historical calculations follow different temporal rules.

**Required behavior**

Separate `effectiveDate`, `postedAt`, and optional scheduled/draft status. Current balances should include only posted entries effective on or before the requested as-of instant. Future plans belong in forecasts, not actual balances.

### ACCOUNTING-05 — P1 — Historical balance sheets can include future profit in retained earnings

**Evidence**

- Balance-sheet assets/liabilities use the requested as-of cutoff: `backend/src/services/reports.ts:219-288`
- Retained earnings calls `generateIncomeStatement(undefined, 0, date)`: `backend/src/services/reports.ts:290-303`
- `generateIncomeStatement()` treats `startDate = 0` as false and falls back to the all-transaction min/max range: `backend/src/services/reports.ts:72-111`

A balance sheet as of an earlier date can include revenue/expense transactions after that date in retained earnings while excluding their asset/liability effects. The historical balance sheet can therefore be unbalanced and materially wrong.

**Required behavior**

Use explicit `undefined` checks, not truthiness, and calculate cumulative P&L from the ledger epoch through the exact as-of instant. Return the accounting equation difference and fail/report when it is nonzero.

### ACCOUNTING-06 — P1 — Period boundaries exclude most of the final day and different modules use different membership rules

**Evidence**

- Manual period dates are parsed from date-only strings into midnight timestamps: `backend/src/routes/periods.ts:66-91`
- Period matching uses `date <= endDate`: `backend/src/routes/transactions.ts:13-25`
- Period create/update permits overlaps: `backend/src/routes/periods.ts:65-137`
- Reports use date range; budgets mix explicit `periodId` with date fallback; insights use only `periodId`: `backend/src/services/reports.ts:72-166`, `backend/src/routes/budget.ts:42-119`, and `backend/src/routes/insights.ts:194-235`

Almost every transaction after midnight on the nominal end date falls outside the period. Manual and auto-created periods also use different UTC/local-midnight paths. Overlapping periods make the first unordered match arbitrary. The same journal can appear in a P&L but not a budget/insight, or vice versa.

**Required behavior**

Store date-only accounting boundaries or use half-open instants `[start, nextStart)`, with one configured time zone. Prevent overlaps and gaps unless explicitly supported. Derive membership in one service and use it everywhere.

### ACCOUNTING-07 — P1 — Expense/revenue classification is split between GL accounts, categories, and free-text transaction types

**Evidence**

- Simple expenses/revenue all post to one generic system account: `backend/src/services/ledger.ts:181-199`
- Categories are transaction metadata, not mapped to GL accounts: `backend/src/db/schema.ts:33-45`
- Spending breakdown advertised by category actually groups expense accounts: `backend/src/services/reports.ts:479-545`
- Cash flow and UI classification depend on free-text/substrings in `txType`: `backend/src/services/reports.ts:427-441` and `frontend/src/routes/index.tsx:38-46`

The P&L generally collapses ordinary activity into `Expense (Auto)` and `Income (Auto)`, while budgets use categories and other screens use `txType`. A category on an income transaction can make the dashboard call it an expense. Editing free-text `txType` can change report classification without changing the journal.

**Required behavior**

Define typed economic events and a deliberate mapping from user categories to reporting accounts. Reports must derive accounting meaning from journal accounts plus controlled event metadata—not arbitrary strings or description text.

### ACCOUNTING-08 — P1 — Savings and debt-payment budgets cannot be represented correctly

**Evidence**

- A default `Savings` category is seeded: `backend/src/db/seed.ts:4-15`
- Budget actuals count only expense-account debits: `backend/src/routes/budget.ts:89-119`
- Simple transfers work only asset-to-asset and do not create expense: `backend/src/services/ledger.ts:200-210`

Moving money to a savings account is an asset transfer, so it never satisfies a Savings budget. Recording it as an expense makes the budget move but falsely reduces income/net worth. Loan principal payments are cash outflows but not expenses, so they also cannot satisfy an ordinary expense budget.

**Required behavior**

Give plan lines an explicit basis: operating expense, cash outflow, savings/goal contribution, debt principal, investment purchase, or income. Compare each plan against the corresponding read model rather than forcing every financial goal through expense accounting.

### ACCOUNTING-09 — P1 — Loan domain status can contradict the controlling ledger account

**Evidence**

- Loan status can be changed directly: `backend/src/routes/loans.ts:410-479`
- Borrowed-loan write-off sets remaining principal to zero without clearing Loans Payable: `backend/src/routes/loans.ts:432-459`
- A loan can be marked repaid through PATCH without a payment journal: `backend/src/routes/loans.ts:460-469`

A forgiven borrowed loan remains a liability in the GL while the loan record says zero/written-off. A loan can say repaid while retaining both `remainingCents` and its receivable/payable balance. There is no control-account reconciliation between the sum of loan subledger balances and Loans Receivable/Payable.

**Required behavior**

Status must be derived from posted principal allocations or changed through domain commands. Debt forgiveness requires Dr Loans Payable / Cr debt-forgiveness gain (subject to the chosen reporting policy). Add an invariant that each control-account balance reconciles to its active subledger.

### ACCOUNTING-10 — P1 — Loan payments assume every rupiah is principal

**Evidence**

- Payment journal reduces only receivable/payable: `backend/src/routes/loans.ts:348-363`
- `amountCents` and `principalCents` are stored as the same value: `backend/src/routes/loans.ts:364-375`

There is no accrued interest, interest income/expense, fee, or allocation order. Interest-bearing loans will show an incorrect remaining principal and incorrect P&L even though account metadata includes an interest-rate field elsewhere.

**Required behavior**

Either explicitly support principal-only loans or model scheduled/accrued interest and payment allocations (`principal`, `interest`, `fee`). The journal and subledger allocation must use the same components.

### ACCOUNTING-11 — P1 — PayLater can recognize future interest twice

**Evidence**

- Recognition credits total principal plus all scheduled interest/fees: `backend/src/services/paylater.ts:202-238`
- Auto-balancing adds the unmatched debit as generic expense: `backend/src/services/ledger.ts:404-428`
- A separate interest-posting API can debit interest expense and credit the same liability again: `backend/src/services/paylater.ts:286-365`

Future contractual interest/fees are included in the initial liability and silently expensed, yet the app also supports posting interest separately. Using both paths double-counts liability and expense. Even without double posting, current net worth is reduced by future unaccrued financing cost.

**Required behavior**

Choose one policy: accrue interest over time, or explicitly recognize a valid upfront fee. Principal, accrued interest, unearned future charges, and payments need separate components/accounts. Do not call total contractual installments `principal`.

### ACCOUNTING-12 — P1 — The cash-flow statement is not a cash-flow statement

**Evidence**

- Every asset account is treated as cash: `backend/src/services/reports.ts:351-355`
- Classification is based on `txType` substrings and one arbitrary counterparty line: `backend/src/services/reports.ts:391-441`

Loans receivable, investments, deposits, and other non-cash assets enter beginning/ending “cash.” Lending and collections can net to zero because both the wallet and receivable lines are treated as cash. All loan activity is classified as financing even though lending/collection is normally distinct from borrowing/repayment. Internal transfers appear as offsetting operating rows.

**Required behavior**

Add explicit account subtypes and a cash/cash-equivalent flag. Classify the whole journal using controlled event semantics: operating purchases, asset acquisition/disposal, lending/collection, borrowing/principal repayment, interest, and owner flows.

### ACCOUNTING-13 — P1 — Dashboard and LLM insight inputs contain mathematically false finance metrics

**Evidence**

- Insight income requires `tx_type = 'income'`, while normal and salary income use `simple_income`/`salary_income`: `backend/src/routes/insights.ts:194-203`
- Insight spending sums credits on every non-income transaction: `backend/src/routes/insights.ts:205-235`
- Dashboard forecast adds period income-minus-expense to a wallet balance that already contains those transactions: `frontend/src/routes/index.tsx:210-239`

Monthly income can be zero despite posted salary. Transfers, lending, loan payments, and other balance-sheet movements become spending. The projected ending wallet double-counts historical net activity before subtracting projected spending. An LLM receives these values as facts and can produce confident but invalid advice.

**Required behavior**

Build one tested financial-facts service and feed both UI and LLM tools from it. Forecast from current liquid cash plus only future expected cash flows, never by adding already-realized net activity again.

### ACCOUNTING-14 — P1 — The monthly PDF treats most non-income balance-sheet movements as expenses

**Evidence**

- PDF logic classifies by income-like `txType`, then sums total transaction debits as expense: `frontend/src/components/pdf/MonthlyReportModal.tsx:52-101`

Asset transfers, loan creation, loan principal payment, PayLater settlement, and custom journals can all appear as expense because they have debits and are not named like income. The exported report can disagree with the backend P&L and budget screen.

**Required behavior**

Render PDFs from the same backend financial-statement/read-model DTOs. The frontend should format reports, not independently invent accounting logic.

### ACCOUNTING-15 — P1 — Budget actuals and income ignore refunds and reversals

**Evidence**

- Budget income sums revenue credits without revenue debits: `backend/src/routes/budget.ts:51-69`
- Budget spending sums expense debits without expense credits: `backend/src/routes/budget.ts:97-113` and `backend/src/routes/budget.ts:478-492`
- Planned amounts accept negative/non-integer values and uniqueness is enforced only by a pre-insert query: `backend/src/routes/budget.ts:146-203`

Refunds, rebates, and reversing entries do not reduce budget spending; revenue reversals do not reduce income. Concurrent creates can duplicate a category/period plan because the database has no unique constraint. Negative plans produce meaningless utilization/variance.

**Required behavior**

Use net account activity (debit minus credit for expenses, credit minus debit for revenue), validate non-negative canonical-unit integers, and add a unique `(period_id, category_id)` constraint.

### ACCOUNTING-16 — P2 — “Lifestyle creep / MPC” is neither marginal nor actual consumption

**Evidence**

- Every planned budget is treated as discretionary spending: `backend/src/services/analytics.ts:312-321`
- The metric is computed as planned spending divided by income: `backend/src/services/analytics.ts:322-366`

This is an average planned-spending ratio, not marginal propensity to consume (change in consumption divided by change in income), and not observed lifestyle creep. Essential budgets are also labeled discretionary.

**Required behavior**

Rename it to an accurate planning ratio, or compute lifestyle change from categorized actual consumption across comparable periods with explicit essential/discretionary policy and income-change analysis.

### ACCOUNTING-17 — P1 — Changing an account type rewrites the meaning of all history

**Evidence**

- Account PATCH permits changing `type` on an existing account: `backend/src/routes/accounts.ts:143-204`
- Historical and current balances apply today's account type to every past line: `backend/src/services/ledger.ts:324-375`

Changing an asset to a liability flips its normal-balance sign and moves its entire history between financial-statement sections. The PATCH route does not runtime-validate the new type and can also mutate system accounts.

**Required behavior**

Treat account class/normal balance as immutable once posted activity exists. Reclassify via a dated journal/new account, or maintain effective-dated account classification. Protect system accounts from ordinary editing.

### ACCOUNTING-18 — P1 — Posted journals are mutable/deletable and periods cannot be closed

**Evidence**

- PUT replaces journal lines in place: `backend/src/routes/transactions.ts:607-717`
- DELETE erases the journal: `backend/src/routes/transactions.ts:720-781`
- Salary periods have no open/closed/locked status: `backend/src/db/schema.ts:115-120`

Historical statements and reconciled balances can change without a traceable reversing entry. There is no posting state, reversal link, close date, or reopen authorization. This is especially unsafe for agentic writes.

**Required behavior**

Use draft → posted → reversed/voided states. Posted journals should be corrected with linked reversals and replacement entries. Reconciled/closed periods need a lock and explicit audited reopen workflow.

### ACCOUNTING-19 — P1 — CSV import hard-codes an ambiguous and often inverted sign convention

**Evidence**

- Positive amount becomes expense; negative becomes income: `backend/src/routes/transactions.ts:921-934`
- The importer supports one amount column rather than debit/credit or configurable direction: `backend/src/routes/transactions.ts:853-908`

Many bank exports use positive for deposits and negative for withdrawals; others use separate debit/credit columns. The importer cannot know which convention applies, so a valid statement can invert all income and expenses. It also has no transfer matching, causing the same inter-account transfer imported from two accounts to become income/expense twice.

**Required behavior**

Preview the inferred direction, require a statement sign/debit-credit mapping, and support per-row correction. Import into pending normalized bank events, then match transfers/refunds/duplicates before posting journals.

### ACCOUNTING-20 — P2 — Salary posting records net cash as total income without stating the accounting basis

**Evidence**

- Payroll calculates gross, tax, and benefit deductions but posts only net cash / generic revenue: `backend/src/services/salary-posting.ts:102-133`

This is acceptable for a deliberately cash-basis personal budget, but it cannot answer gross-income, withheld-tax, employer/employee benefit, or deduction questions. Calling the result salary income without exposing the basis makes tax and compensation analysis misleading.

**Required behavior**

Declare the product's basis. For simple cash budgeting, label it net salary receipt and keep payroll estimates non-ledger. For gross compensation accounting, post explicit gross revenue and deduction/tax/benefit accounts with appropriate liabilities/expenses.

### ACCOUNTING-21 — P2 — The app mixes cash, accrual, and contractual recognition without a policy

Examples:

- Net salary is recognized on cash receipt.
- Asset-linked subscriptions reduce cash on an inferred due date without bank confirmation.
- Liability-linked subscriptions accrue expense/liability.
- PayLater recognizes future contractual interest upfront.
- Loan interest is not recognized at all.
- Reconciliation differences become current income/expense.

These choices make P&L, net worth, cash flow, and forecasts internally incomparable.

**Required behavior**

Write an accounting policy for each event family: recognition date, cash/accrual basis, principal versus income/expense, refund/reversal treatment, and report inclusion. The event model and tests should encode that policy.

### ACCOUNTING-22 — P2 — Account metadata cannot support liquidity, debt, or investment analysis

**Evidence**

- Accounts have only five top-level types; credit limit, rate, billing day, and provider are mostly unused metadata: `backend/src/db/schema.ts:9-28`
- Analytics treats every asset as liquid: `backend/src/services/analytics.ts:49-76`

An agent cannot reliably distinguish cash, e-wallet, term deposit, receivable, investment, prepaid asset, credit card, PayLater, tax payable, or long-term debt. Available credit, statement balance, minimum payment, maturity, valuation basis, and currency are absent or not operationalized.

**Required behavior**

Add controlled account subtypes and finance attributes needed by the intended scope: currency, liquidity/cash-equivalent flag, debt/credit subtype, statement cycle/due date, credit limit, interest model, valuation source/date, and current/non-current classification.

---

## 10. Report generation audit

The report surfaces are not currently alternate renderings of one accounting result. The reports page, CSV endpoints, dashboard summary, and monthly PDF each select and transform data differently. That makes it possible for two reports bearing the same period name to show different income, expenses, net worth, or transaction counts.

### REPORT-01 — P1 — Monthly PDFs silently truncate after 100 transactions

**Evidence**

- The modal asks for 10,000 transactions and does not paginate: `frontend/src/components/pdf/MonthlyReportModal.tsx:42-48`
- The transaction route clamps every request to 100: `backend/src/routes/transactions.ts:10-12`, `backend/src/routes/transactions.ts:57-72`

The modal reads only `transactionsData.data` and ignores `hasMore`/pagination metadata. A period with 101 or more records produces a professional-looking PDF whose totals, category breakdown, transaction count, and appendix are based only on the first page. There is no warning that the document is incomplete.

**Required behavior**

Generate official reports from a server-side report snapshot, or fetch every page with a deterministic `(date, id)` ordering. Return `includedTransactionCount`, `sourceTransactionCount`, `isComplete`, and the source revision; refuse to label an incomplete result as a final report.

### REPORT-02 — P1 — The monthly PDF mixes a selected historical month with today's balance sheet

**Evidence**

- Transactions use the selected period, but the balance sheet call has no as-of date: `frontend/src/components/pdf/MonthlyReportModal.tsx:38-46`
- The PDF presents those current totals as the selected report's net-worth summary: `frontend/src/components/pdf/MonthlyReportModal.tsx:134-147`, `frontend/src/components/pdf/MonthlyReportPDF.tsx:281-298`

A report for an old month combines that month's transaction subset with assets and liabilities as of now. Because current balances also include future-effective transactions, the mismatch can extend in both directions. The reports-page balance sheet does pass the selected period end, so the two UI report paths can disagree for the same period.

**Required behavior**

Use the selected period's inclusive end-of-day as the balance-sheet date, after fixing `ACCOUNTING-05` and `ACCOUNTING-06`. The exported DTO must carry the exact start, end, time zone, and as-of instant used.

### REPORT-03 — P1 — The monthly PDF reimplements accounting from transaction type strings

**Evidence**

- Income is inferred from `txType` containing `income`: `frontend/src/components/pdf/MonthlyReportModal.tsx:66-76`
- Income sums every credit in the journal and everything else sums every debit as expense: `frontend/src/components/pdf/MonthlyReportModal.tsx:78-98`
- The transaction page then prints every non-income amount with a minus sign: `frontend/src/components/pdf/MonthlyReportPDF.tsx:409-416`

In a balanced journal, total debits and credits describe both sides of the entry; they are not automatically income or expense. Transfers, debt principal, savings moves, investment purchases, opening balances, custom journals, and reconciliation adjustments are therefore misrepresented. Revenue reversals and expense refunds are also mishandled. See `ACCOUNTING-14`.

**Required behavior**

Delete the frontend accounting calculation. The monthly PDF should render the same versioned income statement, balance sheet, cash-flow facts, and category read model used by the API and reports page.

### REPORT-04 — P1 — The PDF transaction scope can disagree with the formal statement scope

The monthly PDF selects transactions by stored `periodId`, while the formal income statement selects journal lines by the period's date bounds. A transaction whose period is null, stale, or incorrectly assigned can appear in one result but not the other. Period-end midnight handling compounds the mismatch.

**Evidence**

- PDF query: `frontend/src/components/pdf/MonthlyReportModal.tsx:42-44`
- Formal report date predicates: `backend/src/services/reports.ts:126-166`

**Required behavior**

Resolve one immutable report scope once, then use it for the statement, detailed transactions, categories, budget comparison, and balance-sheet as-of date. Include scope diagnostics for unassigned and out-of-range transactions.

### REPORT-05 — P1 — Cash-flow CSV export always returns an empty document

**Evidence**

- The export route accepts `cash-flow` and passes a cash-flow object to the serializer: `backend/src/routes/reports.ts:89-124`
- The serializer implements only `revenue in report` and `assets in report`; there is no cash-flow branch: `backend/src/services/reports.ts:548-595`

The request succeeds and downloads a zero-byte/empty-text CSV, which can be mistaken for a valid no-activity report.

**Required behavior**

Implement and test a cash-flow export containing period metadata, operating/investing/financing sections, beginning cash, net change, independently calculated ending cash, and reconciliation difference. An unsupported serializer shape must fail explicitly instead of returning an empty string.

### REPORT-06 — P1 — Balance-sheet CSV ignores the period shown on screen

The balance-sheet card loads `balanceSheet(periodEndDate)`, but the shared export handler sends only `periodId`. The balance-sheet export branch ignores `periodId` and reads only `asOfDate`, so the CSV defaults to now.

**Evidence**

- On-screen request: `frontend/src/routes/reports.tsx:549-556`
- Export invocation sends only the selected period ID: `frontend/src/routes/reports.tsx:146-160`, `frontend/src/routes/reports.tsx:260-265`
- Backend balance export expects `asOfDate`: `backend/src/routes/reports.ts:105-108`

**Required behavior**

Export the exact report snapshot displayed. At minimum, pass `selectedPeriod.endDate` as `asOfDate`; preferably use a snapshot/revision identifier so the screen and download cannot race a ledger mutation.

### REPORT-07 — P1 — CSV output is neither safely escaped nor spreadsheet-safe

Account names and transaction descriptions are concatenated directly with commas. Commas, quotes, CR/LF characters, and leading spreadsheet formula characters (`=`, `+`, `-`, `@`) are not handled.

**Evidence**

- Raw string concatenation throughout `exportReportToCSV`: `backend/src/services/reports.ts:548-595`

User/import/LLM-controlled text can corrupt columns and rows. Opening a malicious name or description in Excel or another spreadsheet can also trigger CSV formula injection.

**Required behavior**

Use one RFC 4180 encoder for every field, double embedded quotes, normalize row endings, and apply an explicit formula-neutralization policy to untrusted text. Set a charset and test commas, quotes, newlines, Indonesian text, and all formula prefixes.

### REPORT-08 — P1 — “All Periods” means a different time range in each tab

With no selected period:

- Income statement uses the minimum and maximum transaction dates: `backend/src/services/reports.ts:102-112`
- Balance sheet uses now: `backend/src/services/reports.ts:218-221`
- Cash flow silently uses the last 365 days: `backend/src/services/reports.ts:343-349`
- Spending silently uses the last 30 days: `backend/src/services/reports.ts:501-506`

The shared selector says “All Periods,” but the resulting tabs cannot be compared. A user can reasonably read the cash-flow or spending total as all-time when it is not.

**Required behavior**

Make the scope explicit and consistent. Either define a shared all-time range for period reports or expose independent, accurately labelled ranges such as “Last 30 days.” Never infer materially different scopes from the same selector value.

### REPORT-09 — P2 — Reports default to the oldest period and compare against a newer one

**Evidence**

- The API returns periods newest first: `backend/src/routes/periods.ts:12-19`
- Reports page and monthly modal select the final array item: `frontend/src/routes/reports.tsx:60-66`, `frontend/src/components/pdf/MonthlyReportModal.tsx:24-30`
- “Previous period” uses `index - 1`: `frontend/src/routes/reports.tsx:93-105`

The default report is therefore the oldest period. In newest-first order, `index - 1` is chronologically newer, so the “vs last period” comparison points forward in time. Selecting the newest period produces no comparison at all.

**Required behavior**

Declare the sort contract. For newest-first data, default to index `0` and use index `+1` for the prior chronological period, with an explicit prior-period ID/name in the comparison DTO.

### REPORT-10 — P1 — Spending is grouped by GL accounts but labelled as user categories

**Evidence**

- The service groups expense-account balances and returns `accountName` as `category`: `backend/src/services/reports.ts:509-544`
- The UI tries to match those names to the independent category table for colors: `frontend/src/routes/reports.tsx:824-890`

Most simple expenses post to generic automatic expense accounts, so many real categories collapse into one bucket. Conversely, separately named expense accounts are presented as budget/spending categories even when they are not category records. This breaks meaningful category analysis and agent queries.

**Required behavior**

Define separate reports for expense-account activity and user spending categories. Category spending should be based on controlled transaction/category allocation and reconcile back to net expense activity with an explicit bridge for uncategorized/manual entries.

### REPORT-11 — P1 — Refunds can make spending percentages exceed 100% and totals disagree

`totalExpenses` includes positive and negative account totals, but the returned breakdown filters out every non-positive account. Percentages use the pre-filter net denominator, while the route's returned `total` is recomputed from only the retained positive rows.

**Evidence**

- Denominator computed before filtering: `backend/src/services/reports.ts:535-544`
- Route recomputes total from the filtered breakdown: `backend/src/routes/reports.ts:72-85`

For example, one category at 100 and another at -20 yields a visible total of 100 but a percentage of 125%. The chart and headline can contradict each other.

**Required behavior**

Choose and label gross versus net spending. Preserve refunds/contra-expense in the model, make the denominator equal the displayed total, and require percentages to reconcile under a documented policy.

### REPORT-12 — P2 — The monthly PDF advertises data it never generates

**Evidence**

- All income is stored under key `0`, which resolves to “Uncategorized”: `frontend/src/components/pdf/MonthlyReportModal.tsx:53-54`, `frontend/src/components/pdf/MonthlyReportModal.tsx:86-90`, `frontend/src/components/pdf/MonthlyReportModal.tsx:112-118`
- Budget comparison is hard-coded to an empty array: `frontend/src/components/pdf/MonthlyReportModal.tsx:130-147`
- The PDF's Budget vs Actual section is conditional on that array: `frontend/src/components/pdf/MonthlyReportPDF.tsx:347-370`

“Income by Source” is effectively one Uncategorized row, and “Budget vs Actual” can never render.

**Required behavior**

Source income from controlled revenue accounts/income categories and fetch the same budget actuals used elsewhere. If those datasets are unavailable or cannot reconcile, remove the claims or display a visible unavailable/data-quality state.

### REPORT-13 — P2 — Charts and empty states can misrepresent the returned data

- The spending pie and legend discard every row after the first eight without adding an “Other” slice: `frontend/src/routes/reports.tsx:882-950`. The card total still includes all rows, so the visible pie is not a complete composition of the headline total.
- The income service returns one row for every revenue/expense account even when its period amount is zero: `backend/src/services/reports.ts:168-204`. The UI tests array length rather than activity, so an empty period can display a populated-looking all-zero statement: `frontend/src/routes/reports.tsx:425-436`.

**Required behavior**

Aggregate omitted chart rows into “Other” and disclose the item count. Filter zero-activity statement rows for presentation while retaining complete drill-down metadata, and base no-data state on actual activity.

### REPORT-14 — P2 — Report failures and invalid parameters become silent partial or misleading success

**Evidence**

- Numeric query values are accepted as arbitrary strings and parsed without finite/range/order validation: `backend/src/routes/reports.ts:15-20`, `backend/src/routes/reports.ts:27-85`, `backend/src/routes/reports.ts:130-146`
- All failures, including server/database errors, are returned as generic HTTP 400 responses: `backend/src/routes/reports.ts:38-40`, `backend/src/routes/reports.ts:50-52`, `backend/src/routes/reports.ts:67-69`, `backend/src/routes/reports.ts:84-86`
- Trends drops failed periods and returns the remaining periods without a warning: `backend/src/routes/reports.ts:148-168`
- Previous-period comparison failures are swallowed: `frontend/src/routes/reports.tsx:102-112`
- Monthly preview errors are console-only and do not clear an earlier report: `frontend/src/components/pdf/MonthlyReportModal.tsx:150-153`

**Required behavior**

Validate finite integer IDs/timestamps, range order, maximum trend count, and period existence. Distinguish validation errors from server failures. Official reports should fail atomically, or return an explicit `partial` status with missing scopes and errors; never silently omit failed periods.

### REPORT-15 — P2 — A period change can download the previously previewed monthly report

`reportData` is not cleared when `selectedPeriodId` changes. After previewing period A, selecting period B leaves Download enabled and downloads the period-A blob/filename unless Preview is clicked again. If the new preview fails, the old data remains available with no visible error.

**Evidence**

- Selection only updates `selectedPeriodId`: `frontend/src/components/pdf/MonthlyReportModal.tsx:215-225`
- Download is enabled whenever any prior `reportData` exists: `frontend/src/components/pdf/MonthlyReportModal.tsx:239-250`

The Preview button also has no in-flight state and uses the same CSS variable for its background and text, which can make its label unreadable: `frontend/src/components/pdf/MonthlyReportModal.tsx:229-238`.

**Required behavior**

Bind preview data to a scope key/revision, clear it on selection changes, show generation errors, disable duplicate generation, and allow download only when the preview key equals the current selection.

### REPORT-16 — P1 — Reconciliation adjustments flow into ordinary reports as income or expense

**Evidence**

- A positive reconciliation difference posts generic income and a negative difference posts generic expense: `backend/src/routes/accounts.ts:284-310`
- Income and spending reports include all revenue/expense ledger lines in their date range with no reconciliation classification: `backend/src/services/reports.ts:126-204`, `backend/src/services/reports.ts:509-544`
- The monthly PDF explicitly classifies `reconciliation_income` as income and `reconciliation_expense` as expense: `frontend/src/components/pdf/MonthlyReportModal.tsx:66-98`

Reconciliation is a control process, not inherently a new economic event. The current shortcut can manufacture profit or spending, alter savings rate and budget actuals, and make reports “agree” only because an unexplained plug was posted. This is the reporting consequence of `RECON-07`.

**Required behavior**

Record reconciliation sessions, cleared items, timing differences, and classified corrections separately. A genuine missing fee, interest item, transfer, or opening balance must use its actual accounting classification and link to the session. Reports should disclose material reconciliation adjustments and support an adjusted/operational view without erasing GAAP-style ledger facts.

### REPORT-17 — P2 — Generated documents lack the provenance needed for trustworthy agent use

The generic PDF contains only a title, generation date, and raw object table: `frontend/src/routes/reports.tsx:128-143`. CSV/PDF outputs do not carry a ledger revision, snapshot ID, accounting basis, currency, time zone, inclusive/exclusive boundary semantics, transaction count, reconciliation status, or data-quality warnings.

Without provenance, an LLM or user cannot determine whether two files represent the same ledger state, whether a cache was stale, or why a later regeneration changed.

**Required behavior**

Every generated report should include: report ID/snapshot ID, source ledger revision, generated-at time, effective start/end/as-of instants and time zone, currency/unit, accounting basis, completeness status, included transaction count, reconciliation/close status, and any data-quality warnings. Provide a machine-readable JSON companion for agent queries rather than making the LLM parse presentation PDFs.

### Report-specific acceptance tests

- A 99-, 100-, 101-, and 1,000-transaction period yields identical totals across API, UI, PDF, CSV, and ledger control queries.
- A historical monthly PDF's balance sheet equals the reports-page balance sheet at the same inclusive period-end instant.
- Transactions with null, stale, and out-of-range `periodId` values are reported as scope errors rather than silently changing one rendering.
- Cash-flow CSV is non-empty and reconciles beginning cash + net change to independently queried ending cash.
- A balance-sheet CSV downloaded from a historical view has the same as-of timestamp and totals as the displayed card.
- CSV fixtures safely round-trip commas, quotes, CR/LF, Unicode/Indonesian text, and `=`, `+`, `-`, `@` prefixes.
- “All Periods” has one declared scope across every relevant report, or each exception is explicitly labelled.
- Newest, middle, and oldest selected periods compare only to the correct prior chronological period.
- Category spending reconciles to net expense activity through an explicit uncategorized/manual-entry bridge.
- Refund-heavy fixtures cannot produce contradictory totals or unintended percentages over 100%.
- More than eight spending categories produces a correct “Other” slice and a chart that sums to the headline total.
- Empty-account and zero-activity fixtures render a true no-activity state.
- One failed trend period makes the response/report visibly partial or fails it; the period is never silently removed.
- Changing the modal selection invalidates the old preview and cannot download the previous period under the new selection.
- A zero-difference reconciliation changes no income/expense report; classified corrections remain linked and disclosed.
- Two exports from the same snapshot contain the same revision/provenance and totals even if a new transaction commits concurrently.

---

## 11. Frontend semantic and insight-consistency audit

The principal frontend risk is not cosmetic. Several screens independently reinterpret journal entries, keep stale period data during navigation, and present mixed-scope values under one selected-period heading. These bugs can make correct backend data look wrong and can also hide incorrect AI inputs behind a coherent-looking narrative.

### FRONTEND-01 — P1 — Changing periods can leave the previous period's AI insight on screen

`AIInsightCard` preserves `insight` and `generatedAt` when `type` or `periodId` changes. The new cache lookup only updates state when it receives a non-null insight; a cache miss does not clear the old text.

**Evidence**

- Persistent component state: `frontend/src/components/insights/AIInsightCard.tsx:13-18`
- Period-dependent cache lookup that does nothing on a null result: `frontend/src/components/insights/AIInsightCard.tsx:42-58`
- Dashboard and budget pages reuse the same component instance while changing `periodId`: `frontend/src/routes/index.tsx:711`, `frontend/src/routes/budget.tsx:1076-1082`

After switching from period A to period B, the selector/header can say B while the card still displays A's advice. Because the card title is only “AI Insight” and does not show the period name or scope, the mismatch is hard to detect.

**Required behavior**

Key insight state by `{type, periodId, sourceRevision}`. Clear the prior result immediately on scope change, render an explicit no-insight/loading state, and display the resolved period name, effective dates, and revision beside the narrative.

### FRONTEND-02 — P1 — Out-of-order requests can overwrite the currently selected period

The AI card, dashboard period reload, budget reload, and report components start asynchronous requests without aborting the previous request or verifying the scope when it resolves.

**Evidence**

- AI cache/generation responses write state unconditionally: `frontend/src/components/insights/AIInsightCard.tsx:20-58`
- Dashboard period effect writes many shared state fields without a cancellation/scope guard: `frontend/src/routes/index.tsx:286-415`
- Budget reload has the same pattern: `frontend/src/routes/budget.tsx:165-218`

If the user selects A, then B quickly, a slower A response can finish last and repaint A's numbers/insight under B's selected label. Network latency makes this intermittent and therefore especially misleading.

**Required behavior**

Use abortable queries keyed by scope. Before every state commit, verify that the response key still equals the active selection. Prefer one period-view DTO/query over many independently committed state variables.

### FRONTEND-03 — P1 — The visible dashboard silently uses at most 100 period transactions while AI uses a different full query

**Evidence**

- Dashboard requests `limit: '500'` and consumes only `response.data`: `frontend/src/routes/index.tsx:137-190`, `frontend/src/routes/index.tsx:299-337`
- The transaction API clamps the limit to 100: `backend/src/routes/transactions.ts:10-12`, `backend/src/routes/transactions.ts:57-72`
- Dashboard ignores pagination completeness, while the AI insight route queries the database independently: `backend/src/routes/insights.ts:195-235`

For busy periods, income, expense, burn rate, budget usage, top expenses, and the category pie use only the newest 100 rows. The AI narrative is then generated from a separate dataset and can contradict the visible cards even if both calculations were otherwise correct.

**Required behavior**

Do not aggregate a paginated presentation endpoint in the browser. Load a server-computed period-facts DTO and expose `isComplete`, row counts, scope, and revision. Detailed lists must paginate separately without altering aggregate totals.

### FRONTEND-04 — P1 — Transaction amounts and economic type are reinvented from the largest journal line

**Evidence**

- Dashboard amount is the largest debit or credit in the entry: `frontend/src/routes/index.tsx:177-186`, `frontend/src/routes/index.tsx:321-333`
- Dashboard treats any category-bearing transaction as an expense: `frontend/src/routes/index.tsx:192-205`, `frontend/src/routes/index.tsx:248-269`
- Transaction list uses the same largest-line rule and checks category before income/transfer type: `frontend/src/routes/transactions.tsx:386-452`

Multi-line journals, split receipts, refunds, loan allocations, PayLater entries, transfers with fees, and custom journals do not have one universally meaningful “largest line” amount. An income carrying a category is displayed as an expense. This frontend definition differs from the budget API, formal P&L, PDF, and AI SQL.

**Required behavior**

The backend should return controlled event type plus display amount/direction and accounting facets such as `incomeEffect`, `expenseEffect`, `cashEffect`, and `principalEffect`. Frontend code should format those facts rather than infer them from raw lines.

### FRONTEND-05 — P1 — Stale AI text is presented with a freshly fabricated timestamp

The card trusts `generatedAt` and displays it as the insight time: `frontend/src/components/insights/AIInsightCard.tsx:51-54`, `frontend/src/components/insights/AIInsightCard.tsx:96-100`. The latest endpoints return the current request time for any cached text rather than the original generation time: `backend/src/routes/insights.ts:572-600`.

No transaction mutation invalidates these 24-hour insight keys (`CACHE-05`). A day-old narrative based on deleted or edited transactions can therefore appear as if it were generated seconds ago.

**Required behavior**

Return and display actual `generatedAt`, `sourceRevision`, and `staleReason`. Visibly mark stale narratives, prevent them from being described as current analysis, and offer regeneration against the current revision.

### FRONTEND-06 — P1 — Historical and future periods are analysed as though they are active today

The dashboard and budget selectors allow any period to be passed to the AI card. Insight time math always compares that period to the current clock and does not clamp elapsed days to the period.

**Evidence**

- Arbitrary selected period passed to AI: `frontend/src/routes/index.tsx:488-494`, `frontend/src/routes/index.tsx:711`; `frontend/src/routes/budget.tsx:1076-1082`
- Dashboard insight day calculation: `backend/src/routes/insights.ts:176-184`
- Budget insight day calculation: `backend/src/routes/insights.ts:421-427`

An old 30-day period may become “Day 400 of 30,” causing expected utilization over 1,000% and false “under budget” praise. A future period can have negative elapsed days, too many remaining days, and false over-budget warnings at zero spend.

**Required behavior**

Use an analysis as-of date. For closed historical periods, analyse final outcomes and comparisons; for a future plan, produce a forecast/planning view; only an active period may receive pace-to-date language.

### FRONTEND-07 — P1 — The LLM is instructed to discuss transaction patterns but the prompt omits them

The dashboard insight data object contains weekly transactions, total spent, income, savings rate, top category, and largest transaction. `formatDashboardPrompt` sends none of those fields; it sends only timing, velocity, warnings, and budget summaries.

**Evidence**

- Data assembled: `backend/src/routes/insights.ts:352-389`
- System prompt demands specific purchases/categories/patterns: `backend/src/services/insightGenerator.ts:4-43`
- Actual dashboard prompt excludes the relevant values: `backend/src/services/insightGenerator.ts:155-188`

The model cannot truthfully follow instructions such as mentioning the largest purchase or what was bought this week. It may fall back to generic advice or overinterpret budget lines, while the frontend labels the output “AI-powered analysis of your spending.”

**Required behavior**

Generate insight input from the validated shared facts DTO, include only the necessary evidence with clear units/scope, and require structured output with claim-to-fact references. Test that every allowed numeric claim is grounded in supplied data.

### FRONTEND-08 — P1 — One selected-period dashboard mixes historical flows with current balances and rolling-today charts

The selected period controls period income/expense, budget rows, pie, top expenses, and AI insight. It does not scope wallet balances, net worth, recent transactions, or the net-worth chart.

**Evidence**

- Current accounts/analytics/recent rows are loaded once independently of selection: `frontend/src/routes/index.tsx:141-153`, `frontend/src/routes/index.tsx:209-245`
- Period selection only reloads period-specific subsets: `frontend/src/routes/index.tsx:286-415`
- Net-worth chart always rolls backward from today: `frontend/src/components/analytics/NetWorthChart.tsx:45-80`, `frontend/src/components/analytics/NetWorthChart.tsx:130-140`

The page header appends the selected period name to a current-time status line, visually implying one coherent scope. A historical period can therefore sit beside today's cash, today's net worth, and today's recent transactions.

**Required behavior**

Separate “current financial position” from “selected-period performance” with explicit section-level as-of labels. If the whole page is period-scoped, request historical position and transaction data at that same scope.

### FRONTEND-09 — P2 — Dashboard labels describe data sources and meanings that are not true

Examples:

- “Latest period in summaries” is shown beneath a browser-calculated selected-period income value: `frontend/src/routes/index.tsx:529-541`.
- “From analytics period summaries” is shown beneath a browser-calculated transaction subset: `frontend/src/routes/index.tsx:544-561`.
- “Daily budget” is actually `(income - classified expense) / days remaining`, ignoring planned budgets, savings goals, debt obligations, and cash already committed: `frontend/src/routes/index.tsx:221-235`, `frontend/src/routes/index.tsx:346-360`.
- “Cash in wallets” sums all non-system asset accounts, which is not a controlled cash/cash-equivalent classification: `frontend/src/routes/index.tsx:209-211`, `frontend/src/routes/index.tsx:510-525`.

**Required behavior**

Derive labels from metric metadata rather than hand-written assumptions. Rename provisional calculations accurately and expose tooltips with basis, scope, and formula.

### FRONTEND-10 — P2 — Dashboard and budget pies silently omit categories without an “Other” slice

**Evidence**

- Dashboard spending keeps only six categories: `frontend/src/routes/index.tsx:271-279`
- Budget mix keeps only six planned categories while shares use the all-category denominator: `frontend/src/routes/budget.tsx:470-483`

The visible slices can sum to less than 100%, but the charts do not say data was omitted. Users and an observing agent can mistake the displayed mix for the complete allocation.

**Required behavior**

Aggregate every omitted row into “Other,” show included/total counts, and ensure displayed slices reconcile to exactly the disclosed total subject to rounding.

### FRONTEND-11 — P2 — The lifestyle-creep gauge uses the wrong metric and an undefined period order

The component labels `expenses / income` as marginal propensity to consume and claims it measures the share of *new* income going to spending. That formula is an average spending ratio, not a marginal change. It also assumes the final API row is current, while `/period-summaries` has no ordering contract.

**Evidence**

- Formula and claim: `frontend/src/components/analytics/LifestyleCreepGauge.tsx:34-55`, `frontend/src/components/analytics/LifestyleCreepGauge.tsx:203-206`
- “Current” and trend use the final two array items: `frontend/src/components/analytics/LifestyleCreepGauge.tsx:60-72`
- Backend returns unsorted periods: `backend/src/routes/analytics.ts:139-160`

The gauge can label an arbitrary historical row “current,” reverse the trend, and apply HEALTHY/CRITICAL language to a metric that is not lifestyle creep. See also `ACCOUNTING-16`.

**Required behavior**

Remove the health judgement until the metric is correctly defined. Return chronologically ordered, dated observations and compute either an accurately named average spending ratio or a genuine change-in-consumption/change-in-income measure.

### FRONTEND-12 — P2 — Net-worth comparison labels overstate the actual lookback

The seven-day series contains today plus six prior days; the 30-day series contains today plus 29 prior days. Three/six/twelve-month series contain the current partial month plus prior month ends. The frontend compares first to last but labels them “vs 7 days ago,” “vs 30 days ago,” and so on.

**Evidence**

- Bucket construction: `backend/src/services/analytics.ts:139-188`
- First-to-last comparison and fixed labels: `frontend/src/components/analytics/NetWorthChart.tsx:82-109`

**Required behavior**

Use exact `asOfMs` values returned by the API to render “since [date/time]” or include N+1 points when an exact N-day comparison is intended.

### FRONTEND-13 — P1 — Budget period changes temporarily or permanently show old rows under the new period heading

`loadData` does not set loading on subsequent selection changes and does not clear the prior rows. The selector changes immediately, so `selectedPeriod`/header switch before the new request resolves. The loader also has no catch/error state; on failure, old data remains indefinitely.

**Evidence**

- Selection-triggered reload: `frontend/src/routes/budget.tsx:165-167`
- State is retained until an unguarded response arrives: `frontend/src/routes/budget.tsx:181-209`
- Header derives directly from the new selection: `frontend/src/routes/budget.tsx:230`, `frontend/src/routes/budget.tsx:510-518`

Totals, rows, comparison state, and AI text can consequently refer to different periods on the same screen.

**Required behavior**

Use a keyed loading/error state, clear or visibly dim prior data on scope change, reset comparison data, and commit the period header and dataset atomically from one resolved response.

### FRONTEND-14 — P1 — Reconciliation input can lose negative signs, accept invalid values, and close after partial failure

**Evidence**

- Existing balances are formatted into strings such as `-Rp ...`: `frontend/src/components/reconciliation/ReconciliationModal.tsx:54-63`
- `parseIdNominalToInt` strips every non-digit, including the minus sign: `frontend/src/lib/utils.ts:22-27`
- Empty/invalid input produces `NaN`; JSON serializes `NaN` as `null`, but the modal has no finite validation: `frontend/src/components/reconciliation/ReconciliationModal.tsx:68-80`, `frontend/src/components/reconciliation/ReconciliationModal.tsx:95-123`
- The per-account result body is ignored and the modal always closes after HTTP success: `frontend/src/components/reconciliation/ReconciliationModal.tsx:117-137`

An overdraft/negative asset can be converted to a positive number. Clearing an input can turn into a null/zero-like adjustment. The backend can return `success: true` with item errors, yet the UI reports success and closes. Those adjustments then alter reports and AI insights as ordinary income/expense.

**Required behavior**

Use a signed canonical money input with explicit validity state. Reject non-finite values client and server side. Render the reconciliation preview/session result per account and close only when every requested item committed under the chosen atomicity policy.

### FRONTEND-15 — P2 — Budget category drill-down links do not apply the category filter

Budget rows navigate to `/transactions` with `categoryId`, but the transaction route's search validator and state omit that parameter. Category filtering exists only as local component state initialized to empty.

**Evidence**

- Link supplies the category: `frontend/src/routes/budget.tsx:847-860`
- Route discards it: `frontend/src/routes/transactions.tsx:42-47`, `frontend/src/routes/transactions.tsx:153-175`
- Category select is unrelated local state: `frontend/src/routes/transactions.tsx:633-648`

Clicking a category amount therefore opens all transactions for the period, which can make the budget actual look irreproducible.

**Required behavior**

Add validated `categoryId` search state, initialize the filter from it, send it to the backend, and display the active filter in the page scope label.

### FRONTEND-16 — P1 — “All transactions,” counts, totals, and CSV export silently stop at 100 records

The transaction page asks for 500 records, but the backend clamps it to 100. It ignores `hasMore`, performs filters and pagination locally, reports `filtered.length` as the activity count, calculates the expense total from that subset, and exports only that subset.

**Evidence**

- One clamped fetch: `frontend/src/routes/transactions.tsx:272-303`
- Local count/totals/pagination: `frontend/src/routes/transactions.tsx:465-515`, `frontend/src/routes/transactions.tsx:522-542`
- CSV receives only locally loaded rows: `frontend/src/routes/transactions.tsx:128-150`, `frontend/src/routes/transactions.tsx:534-542`

The “All periods” view can claim there are exactly 100 activities and download a plausible but incomplete CSV without warning.

**Required behavior**

Use server-side filter/pagination with total counts. Aggregate totals must come from a complete server query. A full export should use a dedicated streaming/export endpoint or fetch every page with completeness checks.

### FRONTEND-17 — P2 — Loan cash outflows lose their negative sign in the transaction UI

Loan display logic assigns a negative amount when money leaves a wallet, but mobile/desktop rendering only prepends `+` for positive values and formats the absolute value. The negative sign is never printed for `kind === 'loan'`.

**Evidence**

- Signed loan amount: `frontend/src/routes/transactions.tsx:393-420`
- Rendering discards the sign: `frontend/src/routes/transactions.tsx:724-751`, `frontend/src/routes/transactions.tsx:795-808`

A loan disbursement or payment that reduced cash can visually appear as an unsigned/positive amount, reinforcing incorrect cash-flow interpretation.

**Required behavior**

Render an explicit cash direction separate from economic event type, and test borrowing, lending, collections, repayments, interest, and fees from both counterparty perspectives.

### Frontend/insight acceptance tests

- Switching among periods with cached, uncached, and failed insights never shows text from a different period.
- Rapid A → B → C selection with deliberately reordered network responses leaves only C state visible.
- Dashboard aggregates for 99, 100, 101, and 1,000 transactions match the shared backend facts and AI inputs.
- Income with a category, transfers with fees, refunds, split receipts, loans, PayLater, and custom journals render the correct event label, cash direction, and accounting effect.
- Cached insight timestamps remain the original generation time and become visibly stale after any source-revision change.
- Historical, active, and future periods use outcome, pace, and forecast language respectively.
- Every numeric AI claim is traceable to a structured fact supplied to the prompt/tool call.
- Current-position cards and selected-period performance sections always show independent, explicit scope labels.
- Every pie chart, legend, and headline total reconciles, including an “Other” row when truncated.
- Lifestyle/trend fixtures are sorted chronologically and cannot label an arbitrary row current.
- Net-worth comparison text is generated from exact returned timestamps.
- Budget page network failure clears or marks stale old rows; it never presents them as the newly selected period.
- Signed, empty, malformed, and extreme reconciliation inputs are rejected safely; partial backend results remain visible and do not trigger success closure.
- Clicking a budget category opens a transaction list filtered to exactly the records contributing to that actual, plus a disclosed reconciliation bridge if needed.
- Transaction list/export completeness is explicit and full export contains every matching row.
- Loan cash inflows/outflows show unambiguous signs on mobile, desktop, and CSV.

---

## 12. Recommended implementation order

### Phase 1 — Stop new corruption

1. Protect local file paths against traversal.
2. Add/run the missing database migration and a startup schema-version gate.
3. Make the journal primitive atomic and reject all inferred/auto-balancing.
4. Choose and migrate to one canonical money unit.
5. Make transaction update/delete atomic, balanced, and post-commit invalidating.
6. Reject generic deletion of domain-owned transactions.
7. Remove mutation from subscription GET.
8. Replace salary/subscription inference with durable unique occurrences.
9. Make PayLater recognition and settlement allocations atomic.
10. Replace split-bill posting with one receipt-level balanced command.
11. Exclude future-effective entries from current actual balances.
12. Fix historical balance-sheet retained earnings and period end boundaries.
13. Fix reconciliation false-success behavior.

### Phase 2 — Safe destructive operations

1. Centralize domain-aware delete/reversal services.
2. Add external cleanup outbox/tombstones.
3. Fix period/category/account archive dependency policies.
4. Put audit writes in the same transaction as database mutations.
5. Add restore flows for archived accounts/contacts/templates.

### Phase 3 — Correct reconciliation

1. Add reconciliation sessions/items and as-of dates.
2. Add preview and optimistic concurrency checks.
3. Support liabilities and opening-balance equity.
4. Add classification/matching for transfers and missing transactions.
5. Add reversal of committed reconciliation sessions.

### Phase 4 — Return-after-absence workflow

1. Gap detection.
2. Backfill/resume/restart mode selection.
3. Bulk period generation.
4. Recurring occurrence preview and confirmation.
5. Statement import/deduplication.
6. Final dated reconciliation.

### Phase 5 — Coherent accounting and planning semantics

1. Adopt a written recognition policy for salary, subscriptions, loans, PayLater, refunds, reconciliation, and opening balances.
2. Separate account type, subtype, liquidity, and planning category.
3. Make posted journals immutable and add reversals plus period close/reopen.
4. Reconcile loan and PayLater subledgers to their GL control accounts.
5. Split expense, cash-outflow, savings, debt-principal, and investment plan bases.
6. Replace dashboard, PDF, cash-flow, lifestyle, and insight calculations with shared tested financial facts.

### Phase 6 — Trustworthy derived data and agent access

1. Publish one committed ledger/domain mutation event with a monotonic source revision.
2. Version every financial cache and generated insight against that revision.
3. Centralize account, period, spending, cash-flow, net-worth, and budget read models.
4. Add stale-result metadata and deterministic cache hit/miss DTOs.
5. Expose read-only agent tools over those read models first.
6. Add preview/dry-run/approval/idempotency around agent-proposed financial writes.

---

## 13. Tests required before considering the fixes complete

### Transaction and deletion tests

- Reject unbalanced transaction updates.
- Roll back metadata when line/tag insertion fails.
- Roll back linked-loan changes when transaction deletion fails.
- Reject deletion of loan-owned transactions through the generic endpoint.
- Correctly reverse or reject loan-payment, PayLater, subscription, salary, transfer, and wishlist transactions.
- Bulk delete atomicity or explicit per-item committed-result behavior.
- Audit failure cannot produce a false failure after an untracked commit.
- Cache invalidation occurs after commit and is safe to retry.

### Cache consistency tests

- Editing lines invalidates both removed and added accounts.
- Editing dates invalidates both old and new date-derived periods.
- Deleting transactions, loan journals, periods, and archived accounts cannot return stale cache objects.
- Redis failure during commit cannot make an old value authoritative after reconnect.
- A cache-miss computation from revision N cannot overwrite a cache for revision N+1.
- Concurrent mutations finishing recomputation out of order retain only the newest revision.
- Bulk import emits one post-commit invalidation and does not recompute global analytics per row.
- Cache hits and misses return identical response shapes.
- Zero-burn runway serializes consistently without `Infinity` becoming `null`.
- Generated insights expose their actual generation time and become stale on ledger revision change.
- Startup after database restore cannot serve keys from the previous database revision.

### Automatic posting and payment tests

- Two renewal workers claiming the same occurrence create exactly one journal.
- Failure after occurrence claim, header insert, line insert, or schedule advancement retries safely.
- GET subscription list is side-effect free.
- Invalid/archived/unsupported payment accounts enter `needs_attention` without hourly unbounded retries.
- Income and transfer transactions cannot advance a subscription.
- Deleting/reversing a subscription payment restores or cancels its occurrence deterministically.
- Jakarta local payroll day maps to one occurrence across the UTC date boundary.
- Payroll days 29–31 follow the configured short-month policy.
- Redis outage does not suppress or duplicate salary posting.
- Salary preview and posting use the same settings revision and amount.
- PayLater settlement updates outstanding balance and installment allocation atomically.
- Reversing a PayLater settlement reopens the correct installment allocation.
- A blank database built only from checked-in migrations supports every posting path.

### Accounting and financial-report tests

- A multi-person split bill produces one expense, one receivable per borrower, and one cash credit equal to the receipt.
- Every split allocation reconciles exactly after integer rounding.
- A borrowed split links the explicitly selected payer and posts expense/payable once.
- Future-effective transactions do not affect current balances but appear in forecasts.
- Historical balance sheets satisfy assets = liabilities + equity at multiple as-of dates, including dates before future entries.
- End-date transactions throughout the final local day belong to exactly one period.
- Overlapping period creation/update is rejected.
- P&L, budgets, dashboard, PDF, insights, and CSV exports agree on shared test fixtures.
- Transfers, savings contributions, loan principal, and investment purchases are not ordinary expenses.
- Expense refunds and revenue reversals reduce actuals correctly.
- Loans Receivable/Payable equal their respective subledger totals after create, payment, forgiveness, write-off, reversal, and delete attempts.
- Interest-bearing loan payments allocate principal/interest/fees deterministically.
- PayLater interest is recognized exactly once under the selected policy.
- Account type cannot be changed after posting without a dated reclassification.
- Closed/reconciled periods reject edits and require audited reopen.
- CSV fixtures cover positive-deposit, positive-withdrawal, separate debit/credit, refund, and matched-transfer conventions.
- Salary net-receipt and gross-compensation modes produce explicitly different, internally balanced journals.

### Attachment tests

- Path traversal variants cannot escape storage root.
- Transaction deletion enqueues all attachment object keys for cleanup.
- Storage failures retain retryable cleanup state.
- Database failures do not lose the external object reference.
- Frontend/backend file sizes and MIME types match.

### Reconciliation tests

- A zero-difference reconciliation completes with durable evidence and creates no journal.
- Matching/clearing existing statement lines creates no duplicate financial transaction.
- Deposits in transit, outstanding payments, and pending charges remain timing items and carry forward without P&L.
- A genuine missing bank fee creates a bank-fee expense linked to the session, not a generic Reconciliation expense.
- A missing inter-account transfer creates one linked transfer and reconciles both sides without income/expense.
- Transfer-like differences do not become income/expense without confirmation.
- Assets and liabilities use correct debit/credit direction.
- Adjustments use the selected as-of date and matching period.
- Any item failure rolls back the session when atomic mode is selected.
- Stale expected balances return 409 with a new preview.
- Duplicate idempotency keys cannot post twice.
- Frontend displays every per-item error and does not close on partial failure.
- Opening-balance adjustments are excluded from ordinary P&L analytics.
- Reopening a completed session reverses linked adjustments and unmatches affected lines without erasing the original evidence.
- The same statement/import fingerprint cannot be reconciled twice.

### Absence/catch-up tests

- Returning after 1, 6, 12, and 36 months.
- Backfill, resume, and opening-restart modes.
- Canceled subscriptions during the missing interval.
- Month-end billing on the 28th, 29th, 30th, and 31st.
- Leap-year annual renewals.
- Multiple app instances running recurring jobs concurrently.
- Process crash between occurrence claim and journal creation.
- Missing periods never silently misassign historical transactions.

---

## 14. Verification performed during the review

- Backend TypeScript typecheck passed.
- Frontend TypeScript typecheck passed.
- Eighteen tests passed.
- One ledger test suite could not load because the installed `better-sqlite3` native binary was compiled for a different Node ABI than the available runtime (`NODE_MODULE_VERSION 127` vs `137`).
- Existing tests do not meaningfully cover deletion, cascade cleanup, reversal, reconciliation, cache consistency, automatic posting, payment allocation, financial statements, split-bill accounting, period boundaries, budget semantics, or multi-month catch-up behavior.
- The working tree already contained substantial unrelated/uncommitted changes before this document was created. Those changes were preserved.

## 15. Definition of done

The work is not complete merely when endpoints stop throwing. It is complete when:

- Financial mutations are balanced, atomic, idempotent, and domain-aware.
- Delete/reversal behavior is explicit for every transaction type.
- External files cannot leak silently and cleanup is retryable.
- Reconciliation produces a reviewable, dated accounting trail.
- A returning user can safely choose backfill, resume, or opening restart without automatic surprise transactions.
- Every automatic posting is represented by a durable, unique, retryable occurrence.
- Every cached/read-model result carries or is validated against the committed financial data revision.
- Financial statements reconcile to the ledger and all user/agent surfaces use the same definitions of income, expense, cash flow, net worth, and plan progress.
- Loan and PayLater control accounts reconcile to their subledgers.
- Current actuals, future forecasts, drafts, posted entries, and reversals are distinct states.
- An LLM can distinguish current facts, stale derived data, previews, proposed writes, and committed writes.
- The full behavior is covered by integration tests using a compatible SQLite runtime.
