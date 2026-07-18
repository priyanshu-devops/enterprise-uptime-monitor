# Architecture

## Goals and constraints

- Monitor **350–1000+ domains** with full checks twice daily plus on-demand runs.
- **Zero paid infrastructure**: Vercel free (frontend), Render free (API), GitHub Actions on a public repo (unlimited minutes), Google Sheets (database), GitHub Pages on a public storage repo (images/JSON/report hosting), free lookup APIs (RDAP, ip-api.com).
- No SQL/NoSQL database anywhere.

## Components

| Component | Runs on | Role |
| --- | --- | --- |
| Monitor engine | GitHub Actions (public code repo) | All checks + screenshots; writes Sheet + storage repo |
| Google Sheet | Google | Database: `Domains` (46 cols), `AuditLog`, `IncidentLog`, `ImportHistory`, `Settings` |
| Storage repo | GitHub (public) + Pages | `screenshots/`, `cache/*.json`, `reports/`, `logs/` |
| Backend API | Render free | Auth, cached Sheet CRUD, imports, exports, job triggers, audit |
| Dashboard | Vercel free | SaaS UI; falls back to Pages JSON when the API is cold |

## Monitoring data flow

1. **prepare** — reads the Sheet row count, emits a shard matrix: `ceil(rows / 250)` shards, capped at 8.
2. **check ×N** (parallel matrix jobs, `fail-fast: false`, 45-min timeout) — each shard:
   - DNS (A/AAAA/MX/TXT/CAA/NS via 1.1.1.1 + 8.8.8.8)
   - HTTP/HTTPS with manual redirect following (max 10 hops), TTFB/total/download timing, body capture (2 MB cap), compression/cache/cookie headers
   - SSL via raw TLS socket (expiry, issuer, TLS version, trust)
   - Domain expiry via RDAP (rdap.org, 7-day cache)
   - Hosting/ASN/geo via ip-api.com batch endpoint (100 IPs/call, throttled, 7-day cache)
   - Content/SEO parsing, robots.txt + sitemap.xml, security-header grading
   - Technology detection (rules.json: WordPress, CMSes, frameworks, CDNs)
   - Playwright screenshots: desktop 1366×768 + mobile 390×844 → JPEG + 320 px thumbnail
   - Health/risk scoring, per-domain circuit breaker
   - Results + images uploaded as a shard artifact
3. **aggregate** — merges artifacts; writes the Sheet in chunked `values.batchUpdate` calls (200 rows/call, `USER_ENTERED` so `IMAGE()` formulas render); detects incident transitions; commits screenshots/cache/reports/logs to the storage repo in a single push (rebase-retry ×3).

### Free-tier math (1000 domains)

- **Actions**: ~4 shards × ~18 min + aggregate ≈ 160 runner-min/run, ~9,600/month — free on a public repo.
- **Sheets quota**: 1 `batchGet` read per run; 5 `batchUpdate` writes of 200 rows — far below 60 writes/min. Exponential backoff (0.5 s → 32 s + jitter) on 429/500/503.
- **Storage repo**: ~270 MB working tree (3 JPEGs/domain, overwritten in place). History squashed weekly (orphan-branch force push) so `.git` never grows unbounded; comfortably inside GitHub soft limits and the Pages 1 GB cap.
- **Render**: 24/7 uptime ≈ 744 h < 750 free instance-hours. Cold starts (~50 s) are non-fatal because the dashboard falls back to the Pages cache.

## Dashboard data flow

- Primary: `fetch` to the Render API (4 s timeout), JWT auth, 5-min server-side Sheet cache.
- Fallback: on timeout/5xx, GETs from read-only endpoints are served from `PAGES_BASE_URL/cache/*.json` with an amber "cached data" banner; a background ping wakes Render and swaps back to live.
- Mutations (CRUD, imports, triggers) always go through the API — the UI shows a wake-up state instead.
- "Run check now" → backend → GitHub `workflow_dispatch` API → `monitor.yml`.

## Row identity and write discipline

- Primary key: normalized `domain` (column F) — lowercase hostname, no scheme/path, `www.` stripped.
- The engine owns 37 columns (status → monitoringResult) and never touches the 8 user-owned columns (company, project, owner, department, website, notes, tags, category) — merges happen field-wise at aggregate time.
- Screenshot paths are stable (`screenshots/{domain}/thumb.jpg`), so the sheet's `=IMAGE(...)` formulas never need rewriting; the frontend cache-busts with `?v=`.

## Workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| `monitor.yml` | cron 03:30/15:30 UTC + dispatch | The monitoring cycle (prepare → check ×N → aggregate) |
| `reports.yml` | cron 16:07 UTC + dispatch | Daily/weekly/monthly/quarterly report generation |
| `maintenance.yml` | cron Sun 20:04 UTC + dispatch | Prune old logs/reports, squash storage history |
| `ci.yml` | push/PR | Lint, typecheck, tests, builds |

All monitoring-adjacent workflows share the `monitor` concurrency group so runs never overlap.
