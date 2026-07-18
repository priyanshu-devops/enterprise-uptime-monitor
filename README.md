# Uptime Platform

**Enterprise website monitoring on 100% free-tier infrastructure.**

Monitor 350–1000+ websites for availability, SSL, DNS, performance, technologies, security headers, and hosting — with screenshots, scoring, incident tracking, analytics, and reports — using Google Sheets as the database, GitHub Actions as the scheduler, GitHub Pages as the CDN, Render for the API, and Vercel for the dashboard.

## How it works

```
                 ┌──────────────────────────────────────────────────────────┐
   09:00 IST ──▶ │ GitHub Actions: monitor.yml                              │
   21:00 IST ──▶ │  prepare ─▶ check ×N shards (DNS/HTTP/SSL/RDAP/tech/     │
   manual    ──▶ │             screenshots) ─▶ aggregate                    │
                 └──────┬──────────────────────────────┬────────────────────┘
                        │ batchUpdate (46 cols/row)    │ git push
                        ▼                              ▼
                 ┌────────────┐              ┌──────────────────────┐
                 │ Google     │              │ Storage repo (public)│
                 │ Sheet (DB) │              │ screenshots, JSON    │
                 └─────▲──────┘              │ cache, reports, logs │
                       │                     │ → GitHub Pages       │
                       │ cached reads        └──────────▲───────────┘
                 ┌─────┴──────┐                         │ read-only fallback
                 │ Backend    │◀──── Dashboard ─────────┘
                 │ (Render)   │      (Vercel, Next.js 15)
                 └────────────┘
```

- **Monitoring engine** (`monitor/`) runs on GitHub Actions twice daily (09:00 & 21:00 IST) and on demand. It shards up to 1000 domains across parallel jobs, collects ~40 signals per domain, captures desktop + mobile screenshots with Playwright, computes health/risk scores, detects incidents, updates the Google Sheet in batched writes, and publishes JSON cache + images to the storage repo.
- **Google Sheet** is the database: one row per domain, 46 columns (`Company` → `Category`), plus `AuditLog`, `IncidentLog`, `ImportHistory`, and `Settings` tabs.
- **Backend** (`backend/`) is a thin Express API on Render free: JWT auth, cached Sheet reads, domain CRUD, imports, analytics, report exports (XLSX/CSV/JSON/PDF/MD/HTML), and GitHub Actions triggers.
- **Frontend** (`frontend/`) is a Next.js 15 SaaS dashboard on Vercel free: enterprise data grid, import wizard, analytics, reports, jobs, logs, audit — with automatic read-only fallback to the GitHub Pages JSON cache while Render cold-starts.

## Monorepo layout

| Path | Package | Purpose |
| --- | --- | --- |
| `packages/shared` | `@uptime/shared` | Types, Zod schemas, sheet column map, scoring, utilities |
| `packages/gsheets` | `@uptime/gsheets` | Google Sheets client + repositories (retry, batching) |
| `monitor` | `@uptime/monitor` | Monitoring engine CLI (checks, screenshots, aggregate, reports) |
| `backend` | `@uptime/backend` | Express REST API (`/api/v1`) |
| `frontend` | `frontend` | Next.js 15 dashboard |
| `.github/workflows` | — | `monitor.yml`, `reports.yml`, `maintenance.yml`, `ci.yml` |
| `scripts` | — | Sheet setup, demo seed, local run, history squash |
| `docs` | — | Full documentation set |

## Quick start (local)

```bash
corepack enable
pnpm install
pnpm --filter @uptime/shared build && pnpm --filter @uptime/gsheets build

# Run the monitoring engine against demo domains — no Google Sheet needed:
pnpm --filter @uptime/monitor build
pnpm local-run

# Boot the API with in-memory demo data — no Google Sheet needed:
MOCK_DATA=1 ADMIN_EMAIL=admin@example.com JWT_SECRET=dev-secret pnpm dev:backend

# Dashboard:
pnpm dev:frontend   # http://localhost:3000
```

For full production setup (Google Sheet, service account, both GitHub repos, Render, Vercel), follow **[docs/setup.md](docs/setup.md)** and **[docs/deployment.md](docs/deployment.md)**.

## Documentation

- [Architecture](docs/architecture.md) — components, data flow, free-tier math
- [Setup guide](docs/setup.md) — Google Sheet, service account, repos, secrets
- [Deployment](docs/deployment.md) — Render, Vercel, GitHub Actions, Pages
- [API reference](docs/api.md) — every `/api/v1` endpoint
- [Sheet schema](docs/sheets-schema.md) — all 46 columns + auxiliary tabs
- [Scoring](docs/scoring.md) — health & risk score formulas
- [Runbook](docs/runbook.md) — operations, troubleshooting, maintenance
- [Security](docs/security.md) — auth, hardening, secret management

## License

MIT
