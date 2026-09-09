# Fainens

Fainens is a personal finance workspace with double-entry bookkeeping, planning tools, reports, and an optional AI financial assistant. It is designed for a single-owner deployment, with Google OAuth restricting access to the configured account.

## What it includes

- Double-entry transactions, accounts, categories, tags, transfers, and adjustments
- Budgeting, income and salary planning, loans, pay-later items, reimbursements, split bills, subscriptions, and savings goals
- Dashboard, financial reports, trends, CSV export, and PDF report export
- Profile and personalization settings, including preferred name and report personalization
- Agent context controls, saved memories, response preferences, and configurable OpenAI-compatible models
- Optional attachment storage through Cloudflare R2
- Background jobs through Redis and BullMQ, with an interval-based local mode
- Responsive web UI with quick transaction entry and configurable default accounts

## Stack

| Area | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, TanStack Router, TanStack Query, Tailwind CSS |
| Backend | Fastify, TypeScript, Zod, Google OAuth, JWT/session cookies |
| Data | SQLite, better-sqlite3, Drizzle ORM and migrations |
| Jobs | Redis, ioredis, BullMQ, dedicated worker container |
| Files | Local attachments by default, optional Cloudflare R2 |
| Deployment | Docker Compose, nginx, the guided `scripts/deploy.mjs` CLI |

## Requirements

- Node.js 22.12+ (or Node.js 20.19+)
- pnpm
- Docker and Docker Compose for a production-style deployment
- A Google OAuth client for non-local authentication

## Local development

Install dependencies and create the environment file:

```bash
pnpm install
cp .env.example .env
```

On PowerShell, use:

```powershell
pnpm install
Copy-Item .env.example .env
```

For a quick local-only session, set these values in `.env`:

```dotenv
NODE_ENV=development
LOCAL_AUTH_BYPASS=true
LOCAL_AUTH_EMAIL=local-dev@fainens.test
```

This bypass is development-only and is rejected by the application in production.

Start the services in separate terminals:

```bash
pnpm run dev:backend
pnpm run dev:frontend
```

The frontend runs on `http://localhost:8080` and proxies `/api` requests to the backend on `http://localhost:3000` by default. Adjust `VITE_DEV_PORT` or `VITE_API_PROXY_TARGET` in `.env` if those ports are already in use.

Useful local commands:

```bash
pnpm run build
pnpm run lint
pnpm run start
pnpm --filter backend test
```

## Guided deployment

The deployment CLI asks for the values needed to run Fainens instead of requiring a hand-written production `.env`. It creates or updates `.env`, validates the configuration, and can build, publish, and start the Docker services.

Run the interactive setup:

```bash
pnpm run deploy
```

On Windows, the wrapper is also available:

```powershell
.\deploy.ps1
```

On macOS/Linux:

```bash
./deploy.sh
```

The wizard covers:

1. Public app URL and derived Google OAuth callback URL
2. Google OAuth client ID and secret
3. Allowed sign-in email
4. Session secret generation
5. Optional OpenRouter key and model
6. Redis connection
7. Container registry, image namespace, image tag, and frontend port

The command `pnpm deploy` is reserved by pnpm and does not run this project’s CLI. Use `pnpm run deploy` or call the script directly:

```bash
node scripts/deploy.mjs --setup
```

### Deployment actions

```bash
# Inspect or update deployment configuration
node scripts/deploy.mjs config

# Build images locally
node scripts/deploy.mjs build

# Build and publish images
node scripts/deploy.mjs push --tag 2026-09-08

# Pull images and start the stack
node scripts/deploy.mjs deploy --tag 2026-09-08

# Build, publish, and deploy after confirmation
node scripts/deploy.mjs release --tag 2026-09-08

# Preview a release without changing Docker or the registry
node scripts/deploy.mjs release --dry-run

# Inspect services or follow logs
node scripts/deploy.mjs status
node scripts/deploy.mjs logs --service backend --follow
```

Use `--yes` for non-interactive releases after the configuration has already been reviewed.

## Docker Compose

The Compose stack contains four services:

- `frontend`: nginx serving the built React application
- `backend`: Fastify API and migrations
- `worker`: background job processor using the backend image
- `redis`: queue and cache service

For a manually configured deployment:

```bash
cp .env.example .env
# Edit .env with production values
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

The default public port is `8082`, configurable with `FAINENS_FRONTEND_PORT`. The backend and worker share the `./data` and `./attachments` directories so SQLite data and uploaded files survive container recreation.

## Configuration

The complete template is in [.env.example](.env.example). The most important production values are:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_CALLBACK_URL` | OAuth callback; normally `<public-url>/api/auth/google/callback` |
| `FRONTEND_URL` | Canonical public URL |
| `CORS_ORIGINS` | Allowed browser origins |
| `ALLOWED_EMAIL` | The email allowed to sign in |
| `SESSION_SECRET` | Secret used to protect sessions; keep it private and stable |
| `REDIS_URL` | Redis connection used by the API and worker |
| `OPENROUTER_API_KEY` | Optional server-side key for the Agent |
| `AGENT_OPENROUTER_MODEL` | Optional default Agent model |
| `VITE_DEV_PORT` | Local Vite port |
| `FAINENS_FRONTEND_PORT` | Docker public port |

For production, the deploy wizard automatically switches the job runner to queue mode and applies production defaults. Do not commit `.env`, API keys, OAuth secrets, session secrets, or local database files.

## Google OAuth setup

1. Create or select a project in Google Cloud Console.
2. Configure the OAuth consent screen.
3. Create a Web application OAuth client.
4. Add the exact callback URL shown by the deployment wizard, for example:

   ```text
   https://finance.example.com/api/auth/google/callback
   ```

5. Put the client ID, client secret, public URL, and allowed email into the wizard or `.env`.
6. Restart the backend after changing OAuth settings.

The callback URL, frontend URL, and CORS origin must use the same public origin. Google will reject a callback URL that differs by scheme, hostname, port, or path.

## Generated API contract

The backend OpenAPI contract and generated frontend client are checked into the repository.

```bash
pnpm run generate:openapi
pnpm run generate:api
pnpm run generate:all
pnpm run verify:contract
pnpm run verify:generated
```

When an API route changes, regenerate the contract and client before opening a pull request.

## Project layout

```text
backend/
  src/routes/       Fastify route modules
  src/services/     Domain and Agent services
  src/db/           Drizzle schema and database access
  src/jobs/         Queue worker and recurring jobs
  drizzle/          SQL migrations
frontend/
  src/routes/       TanStack Router pages
  src/components/   Shared UI and feature components
  src/generated/    Generated API client
  public/           Static assets, favicon, manifest, and service worker
contracts/          OpenAPI contract
scripts/            Guided deployment CLI
docker-compose.yml  Production-style service stack
nginx/              Frontend and reverse-proxy configuration
```

## Data and security notes

- Fainens currently targets a single-owner deployment; `ALLOWED_EMAIL` is the access boundary.
- Keep `.env` and the `data/` directory private.
- Back up `data/` and `attachments/` before upgrading or moving the deployment.
- R2 is optional. If it is not configured, attachments use the local mounted storage path.
- Agent memories and profile context are personalization inputs, not authorization to mutate financial data.
- Keep the local authentication bypass disabled in production.

## Troubleshooting

### `ERR_PNPM_NOTHING_TO_DEPLOY`

`pnpm deploy` invokes pnpm’s reserved deployment command. Run the Fainens CLI with:

```bash
pnpm run deploy
```

### The frontend cannot reach the API

Check that the backend is listening on port `3000`, that `VITE_API_PROXY_TARGET` points to it, and that the browser is using the Vite frontend URL. For Compose, inspect both `backend` and `frontend` logs.

### Docker services are unhealthy

```bash
docker compose ps
docker compose logs --tail=200 backend worker redis
```

The backend waits for Redis and runs database migrations during startup. If you intentionally need to rebuild local state, stop the stack first and understand that removing volumes or the `data/` directory deletes local data.

## Contributing

Keep API changes, OpenAPI output, generated clients, and migrations in sync. Prefer focused commits, run the relevant package checks, and never commit secrets or runtime database files.

The repository does not currently include a `LICENSE` file; add one before distributing Fainens outside your own deployment.
