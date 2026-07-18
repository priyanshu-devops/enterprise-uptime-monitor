# Developer Guide

## Prerequisites

- Node.js ≥ 20.9 (22 LTS recommended), `corepack enable` (provides pnpm)
- Windows, macOS, or Linux — everything is pure-JS or ships prebuilt binaries (sharp, Playwright)

## Workspace layout & build graph

```
@uptime/shared  ←  @uptime/gsheets  ←  @uptime/monitor
       ↑                  ↑                @uptime/backend
       └──────────────────┴───────────────  frontend (types only)
```

Build order matters: `shared` → `gsheets` → everything else. Root scripts handle it:

```bash
pnpm install
pnpm build            # everything, correct order
pnpm typecheck        # all packages
pnpm test             # all vitest suites
```

## Day-to-day loops

**Monitoring engine** (no credentials needed):
```bash
pnpm --filter @uptime/monitor build
pnpm local-run                                  # 10 fixture domains, no screenshots
pnpm local-run -- --screenshots                 # with Playwright (install chromium once:
                                                #  pnpm --filter @uptime/monitor exec playwright install chromium)
pnpm local-run -- --domains example.com
node monitor/dist/index.js --dry-run --domains example.com   # direct CLI
```

**Backend**:
```bash
MOCK_DATA=1 ADMIN_EMAIL=admin@example.com JWT_SECRET=dev pnpm dev:backend   # no sheet needed
# or with a real test sheet: cp .env.example .env, fill it, pnpm dev:backend
```

**Frontend**:
```bash
pnpm dev:frontend        # http://localhost:3000 (set frontend/.env.local API base)
```

**Real-sheet scripts**:
```bash
pnpm setup:sheet         # create tabs + headers (idempotent)
pnpm seed:demo           # load fixtures/domains-10.csv
```

## Conventions

- **ESM everywhere**: `"type": "module"`, TS `NodeNext` — relative imports need `.js` extensions; type-only imports use `import type` (verbatimModuleSyntax).
- **Strict TS**: `noUncheckedIndexedAccess` is on — index access returns `T | undefined`; handle it.
- **The sheet schema is code**: any column change happens in `packages/shared/src/sheets/columns.ts` only, plus `docs/sheets-schema.md`. Never hardcode ranges/letters.
- **Ownership discipline**: monitor-owned vs user-owned fields (`MONITOR_OWNED_FIELDS` / `USER_OWNED_FIELDS`) — the engine and the API must never write across that boundary.
- **Scoring changes**: formula + golden tests + `docs/scoring.md`, all in one PR.
- **Errors**: services throw typed errors; controllers translate to problem+json; the engine isolates failures per domain/stage — one bad site never fails a run.
- JSDoc on exported symbols; async/await only; no `any` without a comment justifying it.

## Testing

| Layer | Tool | Where |
| --- | --- | --- |
| Shared logic (scoring, serialize, normalize) | vitest golden tests | `packages/shared/src/__tests__` |
| Engine checks | vitest + undici MockAgent + fixture HTML | `monitor` |
| API | vitest + supertest + in-memory fakes | `backend` |
| E2E dashboard | Playwright | `frontend/e2e` |

Run one package: `pnpm --filter @uptime/backend test`. CI (`ci.yml`) runs the full matrix on every PR.

## Adding a new check to the engine

1. Add a result type to `packages/shared/src/types/check.ts` (+ field on `CheckResult`).
2. Implement `monitor/src/checks/<name>.ts` with the standard shape (10 s cap, `ok/error` fields, injectable transport for tests).
3. Wire it into the pipeline runner and record mapping (choose/create its sheet column via `columns.ts` if it needs one).
4. Consider scoring impact; add tests; update docs.

## Contribution flow

Branch → PR → CI green (typecheck, tests, builds) → review → squash-merge to `main`.
`main` auto-deploys: Vercel (frontend paths), Render (backend paths); workflows are live immediately.
