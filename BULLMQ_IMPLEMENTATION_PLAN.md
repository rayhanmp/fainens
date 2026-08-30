# BullMQ Phase 2 Implementation Plan

> **Implementation status (29 Aug 2026):** Slices 1–5 are now implemented on
> `majorfix` in the current codebase. The implementation keeps the existing
> `queue.ts`/`worker.ts` filenames instead of introducing duplicate wrapper
> files, and keeps the budget-review POST at HTTP 200 for compatibility while
> returning an asynchronous task receipt. The remaining rollout item is
> production rehearsal with the standalone worker enabled.

Implemented pieces include the `background_task` migration, atomic task
claim/retry/cancel/dispatch helpers, three typed queues, BullMQ 6 schedulers,
worker heartbeats and graceful shutdown, asynchronous conversation-title and
budget-outlier jobs, interval-mode compatibility draining, queue-mode startup
without API timers, worker health, Docker worker wiring, regenerated OpenAPI
and frontend client output, and dashboard polling for review completion.

The implementation also adds Zod validation for task payloads, configurable
worker concurrency and agent-provider timeouts, owner-scoped internal task
list/detail/retry/cancel endpoints, and a worker container health check. The
remaining operational work is to run the production rehearsal with the worker
image, verify native `better-sqlite3` bindings in that image, and then make
queue mode the only production runner after the rehearsal passes.

## Purpose

Turn the current partial BullMQ setup into a durable background-work system for Fainens, with agent convenience work handled asynchronously and financial work protected by database idempotency.

This is an implementation plan, not a proposal to rewrite the backend. Keep React/Vite, Fastify, Drizzle, SQLite, Redis, and the existing `bullmq@6.3.1` dependency.

The key rule is simple:

> Redis/BullMQ schedules and retries work. SQLite remains the source of truth for financial state, financial idempotency, and durable task intent.

## Current baseline in this repository

Do not start from scratch. These pieces already exist and should be retained/refactored:

| Existing piece | Location | What to do |
| --- | --- | --- |
| One BullMQ maintenance queue | `backend/src/jobs/queue.ts` | Split/extend it into typed queues and schedulers. |
| Standalone BullMQ worker | `backend/src/jobs/worker.ts` | Turn it into a worker host that starts one worker per queue. |
| Queue-vs-interval feature flag | `JOB_RUNNER_MODE` in `backend/src/lib/env.ts` | Keep interval mode only as a rollout fallback, then remove it after a successful rehearsal. |
| Cache invalidation outbox | `cache_invalidation_outbox` and `services/cache-invalidation-outbox.ts` | Keep it as the durable intent. BullMQ only triggers processing. |
| Storage-deletion outbox | `storage_deletion_outbox` and `services/storage-cleanup.ts` | Move direct cleanup execution to a worker. |
| Recurring occurrence identity | `recurring_occurrence` | Keep it as the financial idempotency boundary for subscription and salary work. |
| Agent title generation | `services/agent-title.ts` and `routes/agent.ts` | Move provider invocation off the streaming request path. |
| Budget outlier review | `services/budget-outlook-review.ts` | Move LLM review off route/SSE paths while preserving deterministic forecasts. |

The current web server still runs `setInterval` in `backend/src/server.ts` and performs an initial synchronous `precomputeEverything()`. The worker currently processes only cache invalidation, subscription renewal, and salary posting. Docker Compose has no worker service yet.

## Non-goals and hard boundaries

These are deliberate constraints. Luna must preserve them.

- Do **not** move request-bound agent SSE streaming to BullMQ. The Fastify request owns streaming, cancellation, tool calls, and the visible response.
- Do **not** let a worker post or alter a financial journal merely because a queue job ran. Financial posting must still pass domain services and durable occurrence/proposal/approval checks.
- Do **not** use Redis keys as financial idempotency. Use `recurring_occurrence`, `agent_pending_action`, and database transactions/unique keys.
- Do **not** run migrations independently in multiple workers. The deployment starts the API/migration owner first; workers become ready only once the schema is available.
- Do **not** queue the existing browser-side PDF export. There is no persisted server PDF artifact today. Add a report-artifact queue only when the product actually needs generated downloadable server files.
- Do **not** expose raw BullMQ job data, provider prompts, image pixels, auth headers, approval tokens, or private model reasoning to the frontend.

## Target topology

```text
Browser
  │ normal HTTP/SSE
  ▼
Fastify API ───────────────► SQLite
  │                            │
  │ creates durable task intent │ financial occurrence/outbox rows
  ▼                            ▼
BullMQ queues ◄──────── worker host ───► domain services / Redis / provider
  │                                            │
  └──────────── Redis scheduling/retries       └── writes durable result/status
```

Use three queues, not one catch-all queue:

| Queue | Jobs | Concurrency | Purpose |
| --- | --- | ---: | --- |
| `fainens-maintenance` | cache outbox, storage cleanup, startup precompute | 2 | Short operational maintenance. |
| `fainens-recurring` | subscription renewal scan, salary occurrence scan | 1 | Serialised scheduler triggers for a SQLite-backed ledger. |
| `fainens-agent` | conversation title, budget-outlier review | 1 initially | Provider-limited, non-financial analysis work. |

Worker concurrency is intentionally conservative. SQLite permits one writer at a time, and OpenRouter calls should not be burst without a measured provider limit. Make each concurrency configurable through environment variables, but default to the values above.

## Durable task model

Add one checked-in Drizzle migration and schema table for non-financial/background task state. Name it `background_task`.

```text
background_task
  id                 text primary key             -- UUID/ULID generated by app
  queue_name         text not null
  job_name           text not null
  dedupe_key         text not null unique
  owner_email        text nullable                 -- only for user-visible agent tasks
  subject_type       text not null                 -- agent_conversation | salary_period | ...
  subject_id         text not null
  payload_json       text not null                 -- small references only, never pixels/tokens
  result_json        text nullable                 -- bounded, safe display/status data
  status             text not null                 -- queued | running | completed | retrying | failed | cancelled
  attempts           integer not null default 0
  max_attempts       integer not null
  available_at       integer not null
  started_at         integer nullable
  completed_at       integer nullable
  last_error         text nullable                 -- capped to 1000 chars
  created_at         integer not null
  updated_at         integer not null

unique(queue_name, dedupe_key)
index(status, available_at)
index(owner_email, created_at)
index(subject_type, subject_id)
```

`background_task` is both the durable intent and the product-visible receipt for non-financial asynchronous work. Do not store full prompt/response history in it. Store IDs, revision numbers, and compact result metadata only.

### State transitions

```text
queued ── worker claims ──► running ── success ──► completed
  │                           │
  │                           └─ retryable failure ──► retrying ──► queued
  │
  └─ enqueue/provider unavailable ───────────────────────────────► queued

running ── terminal/non-retryable failure ──► failed
queued/retrying ── product no longer needs it ──► cancelled
```

Every transition must be a conditional SQLite update. The processor should only proceed if it successfully claims the row:

```sql
UPDATE background_task
SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ?
WHERE id = ? AND status IN ('queued', 'retrying')
```

If zero rows change, the BullMQ delivery is stale/duplicate and must return successfully without doing work.

### Reliable dispatch pattern

Implement `createBackgroundTask()` in `backend/src/jobs/tasks.ts`:

1. Insert the task row in the same SQLite transaction as the domain event when possible.
2. Use a stable `dedupeKey` and `onConflictDoNothing`/read-existing behavior.
3. After commit, call `enqueueBackgroundTask(task.id)` as best effort.
4. If Redis is unavailable, leave the task `queued`; do not fail the user’s successful financial action or chat response.
5. A recurring `dispatch-background-tasks` maintenance job scans queued/retrying rows and re-enqueues them with `jobId = task.id`.

This closes the classic gap where the database commits but the process crashes before Redis enqueue.

## Typed queue contract

Replace the `MaintenanceJobName`-only union with a discriminated job contract in `backend/src/jobs/contracts.ts`.

```ts
export type MaintenanceJob =
  | { name: 'dispatch-background-tasks'; data: undefined }
  | { name: 'cache-invalidation-outbox'; data: { limit?: number } }
  | { name: 'storage-deletion-outbox'; data: { limit?: number } }
  | { name: 'precompute-warmup'; data: { scope: 'all' | 'analytics' } };

export type RecurringJob =
  | { name: 'subscription-renewals'; data: { asOfMs?: number } }
  | { name: 'salary-posting'; data: { asOfMs?: number } };

export type AgentJob =
  | { name: 'conversation-title'; data: { taskId: string } }
  | { name: 'budget-outlier-review'; data: { taskId: string } };
```

Requirements:

- Validate every job payload with Zod before enqueue and again in the worker.
- Queue job data contains only `taskId` for agent jobs. The worker reloads the authoritative task, conversation, messages, owner, and financial revision from SQLite.
- Use stable BullMQ job IDs. For task-backed jobs use `background_task.id`; for periodic jobs use fixed IDs/scheduler IDs.
- Set `attempts`, exponential backoff, `removeOnComplete`, and bounded failed retention per queue.
- Explicitly mark provider errors retryable only when they are transient: 429, 5xx, connection timeout, temporary DNS/Redis failure. Authentication/403, validation failure, manual cancellation, and stale subject state are terminal/non-retryable.

## Queue-specific job designs

### 1. Maintenance queue

#### `dispatch-background-tasks`

- Schedule every 30 seconds.
- Reads at most 100 `queued`/eligible `retrying` rows.
- Enqueues each by stable task ID, then records no success state yet. Worker claim remains authoritative.
- This job is safe to run in parallel because `dedupe_key`, stable BullMQ ID, and task claim prevent duplicate work.

#### `cache-invalidation-outbox`

- Keep `cache_invalidation_outbox` as the source of truth.
- Existing `processCacheInvalidationOutbox(limit)` remains the domain processor.
- Run every 60 seconds plus a startup enqueue.
- Job success does not mean every row was processed; log/metric `processed` and `failed` counts.
- Redis being unavailable must leave rows retryable and must never roll back ledger writes.

#### `storage-deletion-outbox`

- Move direct calls from attachment/transaction routes to enqueue this job after the deletion/outbox transaction commits.
- Run every 5 minutes as a safety sweep.
- Reuse `processStorageDeletionOutbox`, preserving its idempotent deletion and `needs_attention` terminal state after its capped attempts.

#### `precompute-warmup`

- Replace blocking `precomputeEverything()` during API startup with a queue job.
- API boot must be fast and serve cache-miss reads from SQLite while warmup runs.
- Schedule once on worker/API deployment startup with fixed dedupe ID `warmup:<financialRevision>` or simply `warmup:latest`; compute code must still be revision-safe.
- Do not make warmup a prerequisite for readiness.

### 2. Recurring queue

#### `subscription-renewals`

- Schedule hourly, plus one explicit enqueue at worker startup.
- Calls `processDueSubscriptionRenewals(db)`.
- Keep `recurring_occurrence(job_type, schedule_id, occurrence_date)` as the only occurrence identity.
- The worker must tolerate a duplicate BullMQ delivery, a retry after a crash, and a manual route trigger. All three should become a harmless existing occurrence, not a second journal.
- One queue concurrency avoids unnecessary SQLite contention, but correctness must not depend on it.

#### `salary-posting`

- Schedule hourly, plus one explicit enqueue at worker startup.
- Calls `postSalaryIfPayrollDay(db)` with the logical Jakarta date captured inside the service.
- Keep salary occurrence identity in `recurring_occurrence`; never restore Redis-based idempotency.
- Catch-up remains user-driven through existing salary preview/post/skip routes. The scheduled job only handles the currently due logical occurrence.

### 3. Agent queue

Agent jobs are optional enrichment. A failed job must never turn a completed chat or deterministic dashboard calculation into an error.

#### `conversation-title`

Current issue: `routes/agent.ts` calls OpenRouter title generation inline after persisting the assistant answer. This makes the visible chat request wait on a second provider call.

New flow:

1. Persist the user message and assistant response exactly as today.
2. Leave a new auto-titled conversation as `title = 'New conversation'`, `titleSource = 'auto'` so existing skeleton UI can render.
3. In the same post-response database transaction, create task:

   ```text
   queueName: fainens-agent
   jobName: conversation-title
   dedupeKey: conversation-title:<conversationId>:<firstUserMessageId>
   subjectType: agent_conversation
   subjectId: <conversationId>
   payloadJson: { conversationId, firstUserMessageId, assistantMessageId }
   maxAttempts: 3
   ```

4. Enqueue after commit. Do not await the LLM call in the SSE request.
5. Worker reloads the conversation and verifies all conditions before calling OpenRouter:
   - it belongs to the requested owner;
   - `titleSource === 'auto'`;
   - title is still `New conversation`;
   - the referenced first user and assistant messages still exist;
   - the conversation has not been deleted.
6. Call existing `generateConversationTitle()` using reloaded message excerpts.
7. Update title only with the same auto/new-title conditional predicate. A manual rename always wins.
8. Mark task completed with `{ generatedBy: 'llm' | 'fallback' }`; no model text beyond the final 72-character title is stored in task results.

Frontend follow-up:

- While a conversation has `titleSource: 'auto'` and `title: 'New conversation'`, refetch the conversation list every 3 seconds, stopping immediately when no pending title remains or after 30 seconds.
- Keep the existing skeleton; never show “Generating title…”.
- If it remains unresolved after the poll window, next normal list refresh is sufficient. Do not show an error toast for a convenience title.

#### `budget-outlier-review`

Current issue: `POST /api/budgets/:periodId/outlook/review` and the agent tool run `reviewBudgetOutlook(periodId)` inline, including an OpenRouter call. This can delay dashboards/chat and competes with response streaming.

New flow:

1. Deterministic `getBudgetOutlook(periodId)` continues to serve immediately.
2. Add `requestBudgetOutlierReview(periodId, requestedBy)` that captures the current `financial_state.revision` and creates:

   ```text
   queueName: fainens-agent
   jobName: budget-outlier-review
   dedupeKey: budget-outlier-review:<periodId>:<financialRevision>:<promptVersion>
   subjectType: salary_period
   subjectId: <periodId>
   payloadJson: { periodId, evidenceRevision, promptVersion }
   maxAttempts: 3
   ```

3. Replace the current POST route response with `202 Accepted` containing `{ taskId, status: 'queued' | 'running' | 'completed', existing: boolean }`. If a same-revision task/result exists, return it rather than queueing duplicate model work.
4. The agent tool should request the review and report that the deterministic forecast is available now while the optional pattern review is being prepared. It must not wait for the job.
5. Worker reloads the task and verifies `financial_state.revision === evidenceRevision` before starting provider work. If it changed, mark the task `cancelled`/`stale` and do not write a review.
6. Update `reviewBudgetOutlook()` to accept an expected revision and check it again immediately before persisting `forecast_purchase_review` rows. A changed revision means no result write.
7. On success, persist existing review rows, mark task complete, and invalidate the relevant budget-outlook query/cache family.
8. Dashboard budget outlook uses deterministic values when no current review exists. It may show a subtle “pattern review ready” state only after task completion; it must never imply a provider result was included when it was not.

### Future report artifact queue, intentionally deferred

Do not implement this in the first BullMQ PR. Current report endpoints return structured data/CSV and the PDF is browser-generated.

When the product needs persistent server-generated reports, add a fourth queue (`fainens-artifacts`) and a separate `report_artifact` table with owner, parameters hash, source financial revision, storage key, lifecycle, and expiry. The queue must generate an immutable artifact for that revision, not a mutable “latest report.”

## Scheduler and worker host implementation

### Files to create

```text
backend/src/jobs/contracts.ts          typed Zod job contracts and common options
backend/src/jobs/queues.ts             queue instances and enqueue helpers
backend/src/jobs/tasks.ts              background_task persistence, dedupe, dispatch
backend/src/jobs/schedulers.ts         BullMQ v6 job-scheduler registration
backend/src/jobs/processors/
  maintenance.ts                       maintenance switch/handlers
  recurring.ts                         recurring switch/handlers
  agent.ts                             title and outlier-review handlers
backend/src/jobs/worker-host.ts        starts workers, heartbeats, graceful shutdown
backend/src/routes/internal-jobs.ts    authenticated internal health/failed-job view
```

### Files to refactor

```text
backend/src/jobs/queue.ts              replace or split into queues.ts
backend/src/jobs/worker.ts             tiny executable that calls startWorkerHost()
backend/src/server.ts                  remove queue-mode intervals; enqueue startup work only
backend/src/lib/env.ts                 add worker/queue env settings
backend/src/routes/agent.ts            enqueue title task, remove inline title provider call
backend/src/routes/budget.ts           request outlier-review task, return 202/status
backend/src/services/budget-outlook-review.ts
                                      expected-revision guard and worker-only provider path
backend/src/routes/attachments.ts
backend/src/routes/transactions.ts     enqueue storage cleanup instead of processing inline
backend/src/app.ts                     register internal jobs route
backend/src/db/schema.ts               background_task schema
backend/drizzle/...                    checked-in migration
docker-compose.yml                     add worker service and health checks
```

### Scheduler registration

Use BullMQ v6 job schedulers, not `setInterval`, when `JOB_RUNNER_MODE=queue`. Register idempotently on API startup and worker startup. Use stable scheduler IDs:

| Scheduler ID | Queue/job | Cadence |
| --- | --- | --- |
| `maintenance-dispatch-tasks` | maintenance / dispatch-background-tasks | 30 seconds |
| `maintenance-cache-outbox` | maintenance / cache-invalidation-outbox | 60 seconds |
| `maintenance-storage-cleanup` | maintenance / storage-deletion-outbox | 5 minutes |
| `recurring-subscriptions` | recurring / subscription-renewals | 1 hour |
| `recurring-salary` | recurring / salary-posting | 1 hour |

Use the BullMQ 6 `upsertJobScheduler` API available in the installed version. Do not use deprecated repeatable-job APIs for new work.

API startup in queue mode:

1. Bootstrap/verify database as it does today.
2. Connect Redis for API cache/rate limit.
3. Register/upsert schedulers.
4. Enqueue one-off startup maintenance jobs: task dispatcher, cache outbox, storage cleanup, and cache warmup.
5. Start HTTP listener.

No timers are created in queue mode. Keep interval mode code temporarily behind the existing flag until the rollout checklist succeeds.

### Worker process and graceful shutdown

`pnpm --filter backend worker` should:

1. Load env and ensure database schema has already been migrated/verified.
2. Start three `Worker` instances with queue-specific concurrency.
3. Start `QueueEvents` only if needed for metrics, not for core correctness.
4. Publish a Redis worker heartbeat key every 15 seconds with a 45-second TTL:

   ```text
   fainens:worker:<instanceId> = { startedAt, queues, version }
   ```

5. On SIGTERM/SIGINT, stop accepting jobs, wait a bounded grace period for active jobs, close workers/queues/Redis connections, then exit.

Do not use a single global `process.exit()` before `worker.close()` settles.

## Retry, timeout, and retention policy

| Job family | Attempts | Backoff | Timeout | Complete retention | Failed retention |
| --- | ---: | --- | --- | --- | --- |
| Cache outbox | 8 | exponential, 5s base | 30s | 24h / 500 jobs | 14d / 1,000 jobs |
| Storage cleanup | 5 | exponential, 30s base | 60s | 7d / 500 jobs | 30d / 1,000 jobs |
| Subscription/salary scan | 4 | exponential, 30s base | 2 min | 7d / 500 jobs | 30d / 1,000 jobs |
| Conversation title | 3 | exponential, 5s base | 20s | 24h / 1,000 jobs | 7d / 1,000 jobs |
| Budget outlier review | 3 | exponential, 30s base | 45s | 7d / 500 jobs | 14d / 1,000 jobs |

Use an `AbortController` with a timeout around OpenRouter calls. Do not rely on BullMQ timeout alone to cancel an outgoing HTTP request.

The worker must cap `lastError` and logs. Never include API keys, prompt bodies, attachment/image data, cookies, authorization headers, or approval tokens.

## Internal operations API

Add an owner-authenticated, non-public operational route group. It should be hidden from ordinary navigation and documented in OpenAPI as `system`/`jobs`.

```text
GET /api/internal/jobs/health
  -> queue counts, known workers, stale worker indicator, scheduler IDs, Redis reachable flag

GET /api/internal/jobs?status=failed&queue=fainens-agent
  -> bounded safe task/job metadata, no raw payload/prompt

POST /api/internal/jobs/:taskId/retry
  -> only retry eligible failed non-financial task; creates/requeues same stable task

POST /api/internal/jobs/:taskId/cancel
  -> cancels only queued/retrying non-financial task
```

For recurring financial work, expose domain-specific review/occurrence pages rather than a generic “retry financial job” button.

`/health` should remain fast and return API health only. Add `/health/worker` if deployment needs a separate worker readiness probe; it should require Redis plus a fresh heartbeat and current schema availability.

## API and frontend contract changes

### Generated API updates

Add Zod request/response schemas and regenerate OpenAPI/client for:

- `POST /api/budgets/:periodId/outlook/review` → `202` task receipt.
- `GET /api/budgets/:periodId/outlook/review` → includes current task/status and review freshness.
- Internal job health/list/retry/cancel routes.
- Optional `GET /api/agent/conversations/:id/title-status` only if list polling is not sufficient. Prefer extending existing conversation list/detail response instead of adding this route.

### React Query behavior

- Add `queryKeys.jobs` only for internal operations UI. Do not place job/task records in Zustand.
- Agent conversations query polls only while unresolved auto titles exist. Use `refetchInterval` computed from data, not a page-level `setInterval`.
- Budget outlook query starts a background review mutation then invalidates/refetches its own scoped key when task status changes. The deterministic outlook must stay usable if the review is queued/failed.
- Use Zustand only for transient UI state, such as whether an internal job drawer is open. Server task status remains React Query data.

## Docker and deployment changes

Add a `worker` service to `docker-compose.yml` using the backend image:

```yaml
worker:
  image: rayhanmp/fainens-backend:latest
  command: ["pnpm", "worker"]
  volumes:
    - ./data:/app/data
    - ./attachments:/app/data/attachments
  environment:
    - NODE_ENV=production
    - REDIS_URL=redis://redis:6379
    - JOB_RUNNER_MODE=queue
  env_file:
    - .env
  depends_on:
    backend:
      condition: service_healthy
    redis:
      condition: service_started
  restart: unless-stopped
```

Also add:

- A backend health check which only returns healthy after migration/schema verification and the HTTP listener is live.
- A worker health check based on a fresh worker heartbeat.
- `JOB_RUNNER_MODE=queue` in production only after the worker service is confirmed healthy.
- Worker concurrency/timeout env vars with Zod validation, for example `WORKER_AGENT_CONCURRENCY`, `WORKER_MAINTENANCE_CONCURRENCY`, and `WORKER_RECURRING_CONCURRENCY`.

Local development:

```text
Terminal 1: pnpm --filter backend dev
Terminal 2: pnpm --filter backend worker
Terminal 3: pnpm --filter frontend dev
```

Queue mode should degrade safely when Redis is down: normal financial writes still commit, durable SQLite outboxes/tasks remain pending, and the UI reports the deterministic result. It must not silently fall back to running provider jobs inside API requests.

## Implementation order for Luna

### Slice 0 — Baseline and guardrails

Estimated effort: 0.5 day.

1. Read the existing files listed in “Current baseline”.
2. Confirm `pnpm --filter backend worker` starts against Redis without the API process.
3. Add a short architecture comment to queue/task modules explaining Redis is not financial truth.
4. Do not change agent streaming yet.

Done when: existing maintenance jobs still run identically in interval mode.

### Slice 1 — Typed queues and worker host

Estimated effort: 1 day.

1. Add job Zod contracts, queue instances, options, scheduler registration, and worker host.
2. Convert current maintenance worker switch into the maintenance processor.
3. Add recurring worker for subscription/salary scans with concurrency 1.
4. Change `server.ts` queue mode to scheduler registration/startup enqueue only; no queue-mode intervals.
5. Keep interval mode behavior unchanged.

Done when: queue mode has no `setInterval` calls, and maintenance/subscription/salary jobs execute from the worker.

### Slice 2 — Durable background tasks and task dispatcher

Estimated effort: 1 to 1.5 days.

1. Add migration/schema for `background_task`.
2. Implement task creation, unique dedupe keys, conditional claim, final status writes, re-enqueue dispatcher, retry/cancel helpers, and safe error serialization.
3. Add maintenance dispatcher scheduler/job.
4. Make worker processors no-op safely for stale/duplicate task deliveries.

Done when: killing the process after SQLite task commit but before Redis enqueue still leads to eventual execution after dispatcher runs.

### Slice 3 — Agent conversation title job

Estimated effort: 0.5 to 1 day.

1. Move only the title-provider call out of `routes/agent.ts`.
2. Preserve existing fallback title and manual-title protection.
3. Add conversation-list polling for skeleton titles.
4. Add task receipt/logs, timeout, retry policy, and provider error classification.

Done when: first chat answer streams/finishes without waiting for title LLM; manual rename cannot be overwritten; title is eventually updated or retains fallback safely.

### Slice 4 — Budget outlier-review job

Estimated effort: 1 to 1.5 days.

1. Split deterministic candidate collection/persistence guard from provider execution in `budget-outlook-review.ts`.
2. Create revision-bound tasks and make POST return `202` rather than block.
3. Update the agent tool and dashboard query flow to request/reuse the task rather than await it.
4. Recheck financial revision immediately before persistence and cancel stale tasks.

Done when: dashboard remains quick; one-off classification is applied only for the exact reviewed revision; a financial change causes a fresh task rather than stale metadata.

### Slice 5 — Storage cleanup, warmup, operations, deployment

Estimated effort: 1 day.

1. Queue storage cleanup and startup warmup.
2. Add internal health/failed-job visibility.
3. Add worker Docker service, health checks, docs, and production config.
4. Rehearse queue mode with interval mode disabled.

Done when: backend and worker can restart independently, task/queue health is visible, and no API instance executes recurring/maintenance timers in queue mode.

### Total effort

About **4 to 6 focused engineering days** for a careful implementation, or roughly **28 to 45 agent-hours** for Luna including migrations, generated contract updates, verification, and deployment wiring.

The risk is moderate, not because BullMQ itself is difficult, but because duplicate deliveries, Redis outages, SQLite contention, and provider failures must all be boring and safe. Do not compress the durable-task and idempotency slices to save time.

## Verification plan

Luna should implement these checks even if the first PR keeps them as focused/manual verification rather than a huge suite.

### Automated checks

- Contract generation and generated client are reproducible.
- Worker starts with valid/invalid Redis settings and shuts down cleanly.
- Queue payload Zod validation rejects malformed jobs.
- A duplicate BullMQ delivery only lets one `background_task` claim succeed.
- Redis enqueue failure after task insert leaves the task dispatchable later.
- A conversation title task cannot overwrite a manual title or a deleted conversation.
- A stale revision outlier task writes no `forecast_purchase_review` rows.
- Two recurring job deliveries produce one `recurring_occurrence` and one journal.
- Storage cleanup retry preserves `needs_attention` after its cap.

### Manual/rehearsal checks

1. Start API + Redis + worker in queue mode.
2. Create a transaction, verify cache invalidation outbox drains from the worker.
3. Start a new agent chat with OpenRouter enabled. Confirm the answer completes before title generation and the skeleton resolves.
4. Rename the chat immediately. Confirm a late title job does not overwrite it.
5. Trigger budget review, then post a transaction before it completes. Confirm the stale task is cancelled and no old review appears.
6. Stop Redis, post a transaction/delete an attachment, restart Redis. Confirm the SQLite outbox/task sweep eventually completes.
7. Restart the worker while a provider job is active. Confirm task retry/claim behavior is safe.
8. Run subscription/salary scans twice and from a manual path. Confirm no duplicate financial event.

## Acceptance checklist

- [x] Queue mode has no API-process maintenance or recurring timers.
- [x] Queue-mode API startup is not blocked by cache warmup or provider title/review calls.
- [x] Worker is a separate Docker service with graceful shutdown and health visibility.
- [x] Redis outage cannot lose a committed financial invalidation, storage cleanup, or agent task intent.
- [x] Agent SSE remains request-bound and cancellable.
- [x] Conversation title generation is asynchronous, manual-title safe, and skeleton-compatible.
- [x] Budget review is revision-bound, asynchronous, and never blocks deterministic outlook.
- [x] Financial duplicate prevention depends on SQLite occurrence/proposal rules, not BullMQ uniqueness alone.
- [x] Generated OpenAPI/client and TypeScript builds pass.
- [ ] Queue mode rollout has been rehearsed before removing interval mode.

## Follow-up work explicitly outside this implementation

- Persistent server-generated PDF/report artifacts.
- A user-facing general “background tasks” inbox.
- Multi-user per-tenant queue sharding.
- Dead-letter replay UI for financial jobs. Financial replay should remain domain-specific, not a generic retry action.
- Queue telemetry service/Prometheus integration beyond the internal health endpoint.
