# Deployment Guide

## Backend → Render (free)

The repo root contains `render.yaml` (Blueprint). Two options:

**Option A — Blueprint**: Render dashboard → New → Blueprint → point at the code repo. Render reads `render.yaml`.

**Option B — manual Web Service**:
- Repo: the code repo, branch `main`
- Runtime: Node
- Build command:
  ```
  corepack enable && pnpm install --frozen-lockfile && pnpm --filter @uptime/shared build && pnpm --filter @uptime/gsheets build && pnpm --filter @uptime/backend build
  ```
- Start command: `node backend/dist/server.js`
- Health check path: `/healthz`
- Plan: Free

Environment variables (Render dashboard → Environment):

| Key | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `ADMIN_EMAIL` | your login email |
| `ADMIN_PASSWORD_HASH` | `node -e "console.log(require('bcryptjs').hashSync('yourpassword', 10))"` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_EXPIRES_IN` | `24h` |
| `FRONTEND_ORIGIN` | your Vercel URL, e.g. `https://uptime.vercel.app` |
| `SHEET_ID` / `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | same as Actions secrets |
| `GITHUB_TOKEN` | fine-grained PAT (code repo Actions RW + storage Contents RW) |
| `GITHUB_OWNER` / `CODE_REPO` / `STORAGE_REPO` | e.g. `you` / `uptime-platform` / `uptime-storage` |
| `PAGES_BASE_URL` | `https://you.github.io/uptime-storage` |
| `CACHE_TTL_SECONDS` | `300` |

### Free-tier behavior

- Spins down after 15 min idle; cold start ≈ 50 s. The dashboard tolerates this (Pages cache fallback + wake-up banner).
- Optional keep-alive: create a free [cron-job.org](https://cron-job.org) job hitting `https://<service>.onrender.com/healthz` every 5 minutes. One always-on service ≈ 744 h/month, inside the 750 free instance-hours. Do **not** use a GitHub Actions cron for this (minimum practical interval and queue delays make it ineffective).

## Frontend → Vercel (free)

Repo root contains `vercel.json` (monorepo build config).

1. Vercel → Add New Project → import the code repo.
2. Root directory: repository root (vercel.json handles the rest). Framework preset: Next.js.
3. Environment variables:

| Key | Value |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `https://<service>.onrender.com` |
| `NEXT_PUBLIC_PAGES_BASE_URL` | `https://you.github.io/uptime-storage` |
| `NEXT_PUBLIC_APP_NAME` | `Uptime Platform` |

4. Deploy. Then set the resulting URL as `FRONTEND_ORIGIN` on Render (CORS) and redeploy the backend.

`vercel.json`'s `ignoreCommand` skips builds when neither `frontend/` nor `packages/shared/` changed.

## GitHub Actions scheduler

Already active once the code repo is pushed and secrets are set (see [setup.md](setup.md)). Schedules:
- `monitor.yml`: 03:30 & 15:30 UTC (= 09:00 & 21:00 IST) + manual dispatch with `limit`/`domains`/`skip_screenshots` inputs.
- `reports.yml`: 16:07 UTC daily (+ weekly/monthly/quarterly on their boundary days).
- `maintenance.yml`: Sunday 20:04 UTC — prune + history squash.

Note: GitHub cron can drift 3–15 min under load; the schedule is "at least twice daily", not to-the-second.

## CI/CD

- `ci.yml` runs lint/typecheck/tests/builds on every push and PR.
- Vercel and Render both auto-deploy `main` on push via their Git integrations — no deploy step exists in Actions, so a broken CI run never blocks monitoring.

## Post-deploy checklist

1. `GET https://<render>/healthz` → `{"status":"ok",...}`
2. Log into the dashboard → Domains grid shows sheet data.
3. Jobs page → Run check (limit 10) → run appears, completes, grid refreshes.
4. Suspend the Render service temporarily → dashboard shows the amber cached-data banner and still renders (read-only) from Pages.
5. Sheet thumbnails render; storage repo size sane; maintenance workflow green on Sunday.
