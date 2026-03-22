# Fainens - Personal Finance Bookkeeping App

A Docker-deployable, accrual-based double-entry personal finance app with a React frontend, Fastify backend, Drizzle ORM with SQLite, Redis caching, Google OAuth login, and Cloudflare R2 attachments.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)

## Features

### Core
- **Double-entry ledger** with trial balance checks and optional full journal entries
- **Wallets & categories** — asset/liability accounts with emoji/color; flat spending categories
- **Simple transactions** — expense / income / transfer with automatic posting
- **Salary periods & budgets** — planned vs actual by category
- **Tags & audit log** for labeling and history

### Paylater & reporting
- **Paylater** — recognize purchases, interest, and settlement payments (API + UI)
- **Reports** — income statement, balance sheet, cash flow, spending, trends; CSV export
- **Analytics** — net worth, burn rate, runway, period summaries (Redis-backed where configured)

### Technical
- Single-user mode with Google OAuth
- Redis-cached analytics for fast dashboard loads
- **Responsive UI** — desktop sidebar + mobile bottom navigation; calm minimal design system
- Docker Compose deployment ready

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18 + TypeScript + Vite + Tailwind CSS |
| **Routing** | TanStack Router (file-based) |
| **UI** | Custom shadcn/ui-inspired components |
| **Charts** | Recharts |
| **Backend** | Fastify + TypeScript |
| **ORM** | Drizzle ORM |
| **Database** | SQLite (better-sqlite3) |
| **Cache** | Redis (ioredis) |
| **Auth** | Google OAuth 2.0 + JWT |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **Deployment** | Docker Compose |

## Quick Start

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm
- Docker & Docker Compose (for production deployment)
- Google Cloud account (for OAuth)

### Local Development

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd fainens
pnpm install
```

2. **Set up environment variables:**
```bash
cp .env.example .env
# Edit .env and fill in your values
```

3. **Start development servers:**

Terminal 1 (Backend):
```bash
cd backend
pnpm dev
```

Terminal 2 (Frontend):
```bash
cd frontend
pnpm dev
```

The app will be available at:
- Frontend: http://localhost:8080
- Backend API: http://localhost:3000

### Docker Deployment

1. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with production values
```

2. **Start all services:**
```bash
docker compose up -d
```

3. **Check status:**
```bash
docker compose ps
docker compose logs -f backend
```

4. **Access the app:**
- Open http://localhost (nginx serves frontend)
- API available at http://localhost/api

### Stopping
```bash
docker compose down
# To also remove data volumes:
docker compose down -v
```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `ALLOWED_EMAIL` | Your email address (single-user mode) |
| `SESSION_SECRET` | Random string for JWT signing |
| `REDIS_URL` | Redis connection URL |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `R2_*` | Cloudflare R2 for attachments | (optional) |
| `NODE_ENV` | production or development | production |

## Project Structure

```
fainens/
├── docker-compose.yml      # Docker orchestration
├── .env.example            # Environment template
├── .env                    # Your secrets (gitignored)
├── backend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.ts       # Fastify entry
│   │   ├── db/             # Drizzle schema & migrations
│   │   ├── routes/         # API routes
│   │   ├── services/       # Business logic
│   │   ├── cache/          # Redis layer
│   │   └── lib/            # Utilities
│   └── data/               # SQLite database volume
├── frontend/
│   ├── Dockerfile
│   ├── src/
│   │   ├── routes/         # TanStack Router pages
│   │   ├── components/       # React components
│   │   ├── lib/            # API client & utilities
│   │   └── index.css        # Tailwind + neo-brutalism
│   └── dist/               # Production build
└── nginx/
    └── nginx.conf          # Reverse proxy config
```

## API Endpoints

### Authentication
- `GET /api/auth/google` - Initiate OAuth flow
- `GET /api/auth/google/callback` - OAuth callback
- `GET /api/auth/me` - Get current user
- `POST /api/auth/logout` - Logout

### Core CRUD
- `/api/accounts` - Chart of accounts
- `/api/transactions` - Journal entries
- `/api/categories` - Account categories
- `/api/tags` - Transaction tags
- `/api/periods` - Salary periods
- `/api/budgets` - Budget plans

### Workflows
- `/api/workflows/paylater/*` - Paylater management
- `/api/workflows/split-bill/*` - Split bill tracking
- `/api/workflows/barter/*` - Barter settlements
- `/api/workflows/sinking-fund/*` - Sinking fund rules
- `/api/workflows/opportunity-cost/*` - Opportunity cost sim

### Reports & Analytics
- `/api/reports/income-statement` - P&L report
- `/api/reports/balance-sheet` - Balance sheet
- `/api/reports/cash-flow` - Cash flow statement
- `/api/reports/spending` - Spending breakdown
- `/api/reports/trends` - Period trends
- `/api/import/*` - CSV import endpoints

## Database Schema

### Core Tables
- `account` - Chart of accounts
- `transaction` - Journal header
- `transaction_line` - Journal lines (debits/credits)
- `category` - Account categories
- `tag` - Transaction tags
- `transaction_tag` - Tag junction
- `salary_period` - Budget periods
- `budget_plan` - Period budgets
- `sinking_fund_rule` - Auto-allocation rules
- `attachment` - File attachments
- `audit_log` - Change history

## Design System

### Neo-Brutalist Aesthetic
- **Background:** Warm off-white (#F5F0EB)
- **Surface:** White with thick black borders (2-3px)
- **Accent:** Sage green (#8BA888)
- **Typography:** Space Mono (headings) + DM Sans (body)
- **Shadows:** Hard offset shadows (4px 4px 0px black)
- **No rounded corners** (or very slight)
- **No gradients or blur effects**

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. **Authorized redirect URI** must match the **same origin as your browser** (where Vite serves the app), not only the API port:
   - **Local dev (Vite default port 8080):** `http://localhost:8080/api/auth/google/callback`  
     Vite proxies `/api` to the backend; Google returns here so the `token` cookie is set on the UI origin.
   - **Production:** `https://your-domain/api/auth/google/callback`
6. Set in `.env`: `GOOGLE_CALLBACK_URL` to that exact URI, and **`FRONTEND_URL`** to the app origin (e.g. `http://localhost:8080` or `https://your-domain`). After login the backend redirects there; without `FRONTEND_URL`, the callback used to send you to `/` on the **API** host (e.g. `:3000`) instead of the SPA.
7. Copy Client ID and Secret to `.env`

## Troubleshooting

### Database Issues
```bash
# Reset database (deletes all data!)
docker compose down -v
rm -rf backend/data/*.db
docker compose up -d
```

### Cache Issues
- Clear Redis: `docker compose exec redis redis-cli FLUSHALL`
- Or restart: `docker compose restart redis backend`

### Port Conflicts
If port 80 is taken, modify `docker-compose.yml`:
```yaml
ports:
  - "8080:80"  # Use 8080 instead
```

## License

MIT License - See LICENSE file

## Contributing

This is a personal finance app designed for single-user deployment. Contributions are welcome but the primary use case is individual deployment on personal VPS/home server.

## Roadmap (redesign)

- [x] Phase 1–2: Ledger, schema, APIs, caching
- [x] Phase 3: Core UX (dashboard, transactions, wallets, categories, budget, paylater)
- [x] Phase 4: Design system refresh, responsive shell (mobile nav), skeleton loading, reports tab UX, docs

---

**Fainens** - Salary-to-salary bookkeeping for the modern age.
