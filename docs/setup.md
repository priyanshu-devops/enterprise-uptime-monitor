# Setup Guide

End-to-end setup from nothing to a running platform. Time: ~45 minutes.

## 1. Google Sheet + service account

1. Create a Google Cloud project → enable the **Google Sheets API**.
2. Create a **service account** (IAM & Admin → Service Accounts). No roles needed.
3. Create a **JSON key** for it and download it.
4. Base64-encode the key file:
   - Linux/macOS: `base64 -w0 service-account.json`
   - Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))`
   This value is `GOOGLE_SERVICE_ACCOUNT_JSON_B64`.
5. Create a blank Google Sheet. Copy the spreadsheet ID from its URL — this is `SHEET_ID`.
6. **Share the sheet with the service account email** (`...@...iam.gserviceaccount.com`) as **Editor**.
7. Initialize tabs and headers:
   ```bash
   SHEET_ID=... GOOGLE_SERVICE_ACCOUNT_JSON_B64=... pnpm setup:sheet
   ```
   This creates `Domains` (46 headers, A–AT), `AuditLog`, `IncidentLog`, `ImportHistory`, `Settings`.
8. Optional demo data: `pnpm seed:demo` (10 sample domains including negative-test hosts).

## 2. GitHub repositories

You need **two public repos**:

1. **Code repo** (e.g. `uptime-platform`) — this monorepo. Public so GitHub Actions minutes are unlimited (1000 domains twice daily ≈ 9,600 min/month; private repos only get 2,000). Secrets live in Actions secrets, never in git.
2. **Storage repo** (e.g. `uptime-storage`) — create empty with a README, then enable **Pages**: Settings → Pages → Deploy from branch → `main` → `/ (root)`. Its Pages URL (`https://<user>.github.io/uptime-storage`) is `PAGES_BASE_URL`.

### Fine-grained PAT

Create a fine-grained personal access token (Settings → Developer settings):
- Repository access: the **storage repo** with **Contents: Read and write** — this is `STORAGE_REPO_PAT` (Actions secret).
- For the backend's `GITHUB_TOKEN`: same, plus the **code repo** with **Actions: Read and write** (to dispatch and list workflow runs).

### Code repo — Actions secrets and variables

Settings → Secrets and variables → Actions:

| Secret | Value |
| --- | --- |
| `SHEET_ID` | spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON_B64` | base64 key |
| `STORAGE_REPO_PAT` | fine-grained PAT (storage contents RW) |
| `PAGES_BASE_URL` | `https://<user>.github.io/<storage-repo>` |

| Variable | Value |
| --- | --- |
| `STORAGE_REPO` | storage repo name, e.g. `uptime-storage` |

## 3. First monitoring run

Actions tab → **Monitor** → Run workflow → set `limit` = `10` → Run.

Verify:
- The run completes; the step summary shows the counts table.
- The `Domains` tab is fully populated (status, SSL, DNS, tech, scores, timestamps).
- The storage repo received `screenshots/`, `cache/domains.json`, `cache/summary.json`.
- Thumbnails render in the sheet's `IMAGE() Formula` column (Pages can take a minute to deploy on first push).

Then run again without `limit` for the full list. The two daily cron runs (09:00 / 21:00 IST) need no further action.

## 4. Backend on Render — see [deployment.md](deployment.md)

## 5. Frontend on Vercel — see [deployment.md](deployment.md)

## 6. Local development

```bash
corepack enable && pnpm install
pnpm --filter @uptime/shared build && pnpm --filter @uptime/gsheets build

# Engine without any credentials:
pnpm --filter @uptime/monitor build && pnpm local-run

# API with in-memory demo data (no sheet):
MOCK_DATA=1 ADMIN_EMAIL=admin@example.com JWT_SECRET=dev pnpm dev:backend
# Default mock login: admin@example.com / admin12345 (see backend README output)

# Dashboard against the local API:
# frontend/.env.local → NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
pnpm dev:frontend
```

Copy `.env.example` to `.env` for real-sheet local work.

## Troubleshooting first-run issues

| Symptom | Fix |
| --- | --- |
| `403 The caller does not have permission` | Sheet not shared with the service-account email as Editor |
| `404` on sheet | Wrong `SHEET_ID` |
| Actions: `Resource not accessible by PAT` | PAT missing storage-repo Contents RW |
| Thumbnails blank in sheet | Pages not enabled on storage repo, or first deploy still building |
| Playwright install fails locally on Windows | `pnpm --filter @uptime/monitor exec playwright install chromium` |
