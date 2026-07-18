# Health & Risk Scoring

Both scores are computed in `packages/shared/src/scoring/` and unit-tested with
golden cases. They are deterministic functions of a single check result (plus
recent-run state for risk), so a score can always be explained.

## Health Score — "how is this site doing right now?"

Start at **100**, subtract penalties, clamp to [0, 100].

| Condition | Penalty |
| --- | --- |
| Site down / timeout / DNS failure | −60 |
| HTTP 5xx | −40 |
| HTTP 4xx | −25 |
| SSL expired | −30 |
| SSL expires < 7 days | −20 |
| SSL expires < 30 days | −10 |
| No HTTPS | −15 |
| Response time > 3 s | −10 |
| Response time > 1.5 s | −5 |
| Missing security headers | −2 each, capped at −12 |
| Redirect chain > 3 hops | −5 |
| Domain registration expires < 30 days | −10 |
| Favicon / robots.txt / sitemap.xml missing | −1 each |

Interpretation bands used in the UI: **90–100** healthy (emerald), **70–89**
attention (amber), **40–69** degraded (orange), **< 40** critical (red).

## Risk Score — "how likely is this to bite us soon?"

Start at **0**, add weighted factors, clamp to [0, 100]. Higher = riskier.

| Factor | Points |
| --- | --- |
| SSL expired | +30 |
| SSL expires < 7 days | +25 |
| SSL expires < 30 days | +15 |
| Domain registration expired | +24 |
| Domain expires < 7 days | +20 |
| Domain expires < 30 days | +12 |
| Currently unavailable | +25 |
| ≥ 2 failures in recent runs (flapping) | +10 |
| No HTTPS | +10 |
| Missing both HSTS and CSP | +5 |

Domain-expiry weights are 0.8× the SSL weights: an expired domain is
catastrophic but rarer and usually caught by registrar mail; an expired cert
breaks every visitor immediately.

## Security-header grade (column AF)

Six headers audited on the final response: `Content-Security-Policy`,
`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`. Stored as `N/6` with the missing list,
e.g. `4/6 (missing: CSP, HSTS)`.

## Changing the formulas

Edit `packages/shared/src/scoring/health.ts` / `risk.ts`, update the golden
tests in `packages/shared/src/__tests__/scoring.test.ts`, and update this file.
All three consumers (engine, API, dashboard) pick the change up from
`@uptime/shared` — there is exactly one implementation.
