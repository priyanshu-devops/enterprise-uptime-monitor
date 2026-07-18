# API Reference — `/api/v1`

Base URL: `https://<render-service>.onrender.com`. All endpoints return JSON.
Auth: `Authorization: Bearer <jwt>` on everything except `POST /auth/login` and `GET /healthz`.
Errors use a problem+json envelope: `{ status, title, detail, errors? }`.

## Auth

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| POST | `/api/v1/auth/login` | `{email, password}` | `{token, expiresIn, user:{email, role}}` |
| GET | `/api/v1/auth/me` | — | `{email, role}` |

Login is rate-limited to 10 attempts / 15 min / IP.

## Domains

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/domains` | Query: `q, status, category, tag, company, project, owner, sortBy, sortDir, page, pageSize` → `Paginated<DomainRecord>` |
| GET | `/api/v1/domains/:domain` | One record by normalized domain |
| POST | `/api/v1/domains` | `{website, company?, project?, owner?, department?, notes?, tags?, category?}` — normalizes, rejects duplicates, appends with status `PENDING` |
| PATCH | `/api/v1/domains/:domain` | Same fields, all optional — **user-owned columns only** |
| DELETE | `/api/v1/domains/:domain` | Removes the sheet row |
| POST | `/api/v1/domains/bulk` | `{action: delete\|tag\|untag\|categorize\|pause\|resume, domains: string[], value?}` |

## Import

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/import/preview` | `{source, rows:[{website,...}]}` → `ImportRowPreview[]` (validity/duplicate/corrected per row) |
| POST | `/api/v1/import/commit` | Same body → `ImportReport` (totals + rejected rows); appends accepted rows and an `ImportHistory` entry |
| POST | `/api/v1/import/parse-xlsx` | `{filename, dataB64}` → parsed rows (exceljs, header auto-mapping) |
| GET | `/api/v1/import/history` | Past imports |

## Monitoring & jobs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/monitoring/status` | `{lastRun: RunSummary\|null, dataSource, cacheGeneratedAt}` |
| GET | `/api/v1/monitoring/incidents` | `{incidents: Incident[]}` |
| GET | `/api/v1/monitoring/history/:domain` | Trend series (global history) |
| POST | `/api/v1/jobs/trigger` | `{domains?, limit?, skipScreenshots?}` → dispatches `monitor.yml` |
| GET | `/api/v1/jobs` | Recent workflow runs → `JobRun[]` |
| GET | `/api/v1/jobs/:id` | One run |

## Analytics & reports

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/analytics/kpis` | `KpiSnapshot` |
| GET | `/api/v1/analytics/trends?days=30` | `{points: HistoryPoint[]}` |
| GET | `/api/v1/analytics/distributions` | status/hosting/CDN/CMS/framework/SSL/health buckets |
| GET | `/api/v1/reports` | List generated reports |
| POST | `/api/v1/reports/generate` | `{period}` → `Report` |
| GET | `/api/v1/reports/export?format=xlsx\|csv\|json\|pdf\|md\|html&period=…` | File download (content-disposition) |

## Platform

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/screenshots/:domain` | `{desktopUrl, mobileUrl, thumbUrl, capturedAt}` (Pages URLs) |
| GET | `/api/v1/logs?category=monitor\|audit&date=YYYY-MM-DD` | Monitor: storage-repo JSONL; audit: sheet tab |
| GET | `/api/v1/audit` | `Paginated<AuditEntry>`, newest first |
| GET | `/api/v1/sheets/meta` | Row count, cache age, last sync |
| POST | `/api/v1/sheets/resync` | Invalidate the server-side cache |
| GET | `/api/v1/github/storage/status` | Pages reachability + last run info |
| GET | `/healthz` | Public: `{status, uptimeSeconds, version, sheets:{reachable, cacheAgeSeconds}, timestamp}` |
| GET | `/api/v1/settings` / PUT | `{sslWarnDays, responseTimeWarnMs, savedFilters}` |

## Caching & fallback semantics

- The backend caches full-sheet reads for `CACHE_TTL_SECONDS` (default 300); any write invalidates.
- Clients should treat the GitHub Pages JSON cache (`{PAGES_BASE_URL}/cache/*.json`) as the read-only fallback when the API is cold; the shipped frontend does this automatically and labels the data source.

## Types

All request/response shapes are exported from `@uptime/shared` (`types/api.ts`,
`types/report.ts`, `types/check.ts`) and validated server-side with the Zod
schemas in `schemas/index.ts` — the frontend and backend share one contract.
