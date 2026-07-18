# Google Sheet Schema

The spreadsheet is the platform's database. Five tabs. All values are strings.
The authoritative field↔column mapping lives in `packages/shared/src/sheets/columns.ts` —
never hardcode column letters elsewhere.

## `Domains` tab — one row per monitored domain

| Col | Header | Owner | Notes |
| --- | --- | --- | --- |
| A | Company | user | |
| B | Project | user | |
| C | Owner | user | person/team |
| D | Department | user | |
| E | Website | user | full URL as entered |
| F | Domain | key | normalized hostname — **primary key** |
| G | Status | monitor | UP / DOWN / DEGRADED / REDIRECT / SSL_ERROR / DNS_FAILURE / TIMEOUT / PAUSED / PENDING / ERROR |
| H | HTTP Status | monitor | final status code |
| I | HTTPS | monitor | Yes/No |
| J | Redirect URL | monitor | final URL when redirected |
| K | Response Time | monitor | ms |
| L | TTFB | monitor | ms |
| M | SSL Expiry | monitor | YYYY-MM-DD |
| N | SSL Days Remaining | monitor | negative = expired |
| O | SSL Issuer | monitor | |
| P | TLS Version | monitor | e.g. TLSv1.3 |
| Q | Domain Expiry | monitor | via RDAP |
| R | Server IP | monitor | first A record |
| S | DNS | monitor | record types present |
| T | Nameservers | monitor | comma-separated |
| U | Hosting Provider | monitor | ISP/org via ASN |
| V | CDN | monitor | Cloudflare/Fastly/CloudFront/Akamai/... |
| W | Cloudflare | monitor | Yes/No |
| X | WordPress | monitor | Yes/No |
| Y | CMS | monitor | |
| Z | Technology Stack | monitor | comma-separated |
| AA | Framework | monitor | |
| AB | Meta Title | monitor | truncated 200 |
| AC | Meta Description | monitor | truncated 300 |
| AD | Robots.txt | monitor | Yes/No |
| AE | Sitemap.xml | monitor | Yes/No |
| AF | Security Headers | monitor | e.g. `4/6 (missing: CSP, HSTS)` |
| AG | Page Size | monitor | KB |
| AH | Favicon | monitor | Yes/No |
| AI | Screenshot URL | monitor | Pages URL, stable path |
| AJ | Thumbnail URL | monitor | Pages URL, stable path |
| AK | IMAGE() Formula | monitor | `=IMAGE("...thumb.jpg")` — renders in-cell |
| AL | Last Checked Date | monitor | YYYY-MM-DD (IST) |
| AM | Last Checked Time | monitor | HH:mm:ss (IST) |
| AN | Health Score | monitor | 0–100 |
| AO | Risk Score | monitor | 0–100 |
| AP | Error Message | monitor | truncated 300 |
| AQ | Monitoring Result | monitor | compact JSON summary |
| AR | Notes | user | never overwritten |
| AS | Tags | user | comma-separated |
| AT | Category | user | |

**Write discipline**: the monitor merges its 37 columns into the existing row and
never touches user-owned columns (A–E, AR–AT). Users/dashboard never edit
monitor-owned columns. Rows with Status `PAUSED` are skipped by the engine.

## `AuditLog` tab

Timestamp, Actor, Action, Target, IP, User Agent, Status, Before, After, Reason.
Appended (buffered) by the backend for every mutating API call.

## `IncidentLog` tab

ID, Domain, Type, Status, Opened At, Resolved At, From Status, To Status, Message.
Appended by the aggregate step on status transitions
(DOWN, DNS_FAILURE, SSL_EXPIRING, SSL_EXPIRED, DEGRADED, RECOVERED).

## `ImportHistory` tab

Import ID, Imported At, Actor, Source, Total, Accepted, Duplicates, Invalid, Corrected, Skipped.

## `Settings` tab

Key/value pairs: `sslWarnDays` (default 30), `responseTimeWarnMs` (default 3000),
`savedFilters` (JSON array of saved dashboard filter presets).

## Quota strategy

- Full read = **one** `values.batchGet` per consumer per cycle (plus a 5-min cache on the backend).
- Writes are chunked `values.batchUpdate` calls of 200 rows with `USER_ENTERED`
  (required for `IMAGE()` to evaluate), retried with exponential backoff + jitter on 429/500/503.
- Appends use `values.append`; deletes use `deleteDimension` in bottom-up contiguous blocks.
