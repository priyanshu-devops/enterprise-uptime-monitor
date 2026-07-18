# Security

## Authentication & authorization

- **Single-admin JWT auth**: credentials are `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (bcrypt, cost 10) in Render env vars — no credential storage in the sheet or repo. Login issues an HS256 JWT (`JWT_SECRET`, 24 h expiry). Every `/api/v1` route except `POST /auth/login` and `GET /healthz` requires `Authorization: Bearer`.
- **RBAC middleware** (`requireRole('admin')`) wraps mutating routes; the model currently has one admin role, but the middleware layer means adding `editor`/`viewer` later is a token-claim change, not a rewrite.
- Frontend stores the token in localStorage via a Zustand persist store; 401 responses trigger logout + redirect.

## API hardening

- **helmet** default headers (CSP-safe for a JSON API, X-Content-Type-Options, frameguard, HSTS behind HTTPS).
- **CORS** allowlist from `FRONTEND_ORIGIN` (comma-separated exact origins) — no wildcard.
- **Rate limiting**: global 300 req/15 min/IP; `POST /auth/login` 10 req/15 min/IP (brute-force protection).
- **Input validation**: every body/query/param validated with shared Zod schemas before reaching services; unknown fields stripped; 400 responses list field errors.
- **Error handling**: problem+json envelope; stack traces never leave the server in production; all errors logged structurally (pino).
- JSON body limit 2 MB; `trust proxy` set for Render so rate-limit/audit IPs are the real client.

## Secrets management

| Secret | Lives in | Never in |
| --- | --- | --- |
| Service-account key (b64) | Actions secrets, Render env | git, frontend |
| `STORAGE_REPO_PAT` / `GITHUB_TOKEN` | Actions secrets / Render env | git, frontend, logs |
| `JWT_SECRET`, `ADMIN_PASSWORD_HASH` | Render env | git, frontend |

- Both repos are public: `.gitignore` blocks `.env*` and `service-account*.json`; CI never echoes secrets; the monitor logs redact env.
- The fine-grained PAT is scoped to exactly two repos and two permissions (storage Contents RW; code Actions RW). Rotation steps in the [runbook](runbook.md).

## Monitoring engine safety

- Outbound-only: the engine makes GET/HEAD requests and never executes remote content; HTML is parsed, not rendered (screenshots run in Playwright's sandboxed Chromium).
- Per-request 10 s timeouts, 2 MB body cap, redirect cap (10), per-domain circuit breaker — a hostile/slow target cannot stall or balloon a run.
- The global circuit breaker (≥80% of first 25 failing → abort, exit 2, no writes) prevents a runner-side network fault from mass-writing false DOWN statuses.
- ip-api.com receives only public server IPs; RDAP receives only registrable domain names. No user data leaves the platform.

## Audit trail

Every mutating API call appends to the `AuditLog` tab: timestamp, actor, action, target, IP, user agent, success/failure, before/after snapshots (truncated), reason. Exportable from the dashboard; mirrored monthly to the storage repo by maintenance.

## Data exposure model (accepted trade-offs)

- The **storage repo and Pages site are public by design**: screenshots, domain lists, statuses, and reports are visible to anyone with the URL. Do not monitor internal/secret hostnames with this platform; that is the price of free Pages hosting.
- The Google Sheet itself is private (service-account + explicitly shared users only).
- If the domain list must be private: make the code repo private (accepting the 2,000-min Actions cap ≈ 100–150 domains/day cadence), move storage to private + drop Pages, and serve images through the backend instead.

## Dependency hygiene

- Pinned major versions, `pnpm-lock.yaml` committed, `pnpm audit` runs locally; CI builds from the frozen lockfile.
- No native-addon auth/crypto deps (bcryptjs is pure JS) — no supply-chain build scripts on Windows dev machines.
