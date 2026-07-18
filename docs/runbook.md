# Operations Runbook

## Routine operations

| Task | How |
| --- | --- |
| On-demand full run | Actions → Monitor → Run workflow |
| Check a few domains now | Dashboard → Jobs → domains list + Run, or dispatch with `domains` input |
| Fast run without screenshots | dispatch with `skip_screenshots: true` |
| Add domains | Dashboard → Import (CSV/XLSX/paste) or Domains → Add |
| Pause noisy domains | Domains grid → select → Bulk pause (engine skips PAUSED rows) |
| Regenerate reports | Actions → Reports → Run workflow (choose period) |
| Force cache refresh | Dashboard → Settings → Resync, or `POST /api/v1/sheets/resync` |

## Monitoring the monitor

- **Actions tab** is the source of truth for run health; each run writes a step summary table (totals, incidents, screenshot failures).
- `cache/summary.json` in the storage repo = last successful run.
- Dashboard → Jobs shows the same via the API.
- A shard exiting with code 2 means the **global circuit breaker** tripped: ≥80% of the first 25 domains failed → runner-side network fault suspected → the shard aborts *without* writing results, so a bad runner never mass-marks sites DOWN.

## Common failures

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Run red at `prepare` | Sheets auth (secret rotated? sheet unshared?) | Verify `GOOGLE_SERVICE_ACCOUNT_JSON_B64`, sharing |
| One shard red, others green | Transient runner issue | Re-run failed jobs; aggregate runs with surviving shards |
| Aggregate push fails ×3 | Storage repo diverged (manual push?) | Re-run aggregate; avoid manual pushes to storage `main` |
| Sheet rows stale but run green | Quota backoff exhausted | Check aggregate logs for 429s; runs self-heal next cycle |
| All sites suddenly DOWN | Should be prevented by the global breaker | If it happens, check runner egress; re-run |
| Screenshots failing broadly | Chromium install step failed | Check the `Install Playwright chromium` step |
| Dashboard stuck on cached banner | Render down or asleep beyond cold start | Check Render logs/events; `/healthz` directly |
| 401s in dashboard | JWT expired (24 h) | Re-login |

## Storage repo hygiene

- `maintenance.yml` (Sun 20:04 UTC) prunes monitor logs > 30 d, daily reports > 90 d, history JSON > 400 d, then **squashes git history** to a single commit and force-pushes.
- Never point anything at a storage-repo commit SHA — history is disposable by design; only `main` HEAD paths are stable.
- If the repo bloats mid-week (e.g. after adding hundreds of domains), dispatch maintenance manually.
- Rehearsal note: the squash script (`scripts/squash-history.sh`) can be tested against a clone — it only rewrites the local branch; the workflow does the force push.

## Secret rotation

| Secret | Where | Steps |
| --- | --- | --- |
| Service-account key | Actions secrets + Render | Create new key in GCP → update both → delete old key |
| `STORAGE_REPO_PAT` / `GITHUB_TOKEN` | Actions secrets / Render | Regenerate fine-grained PAT → update |
| `JWT_SECRET` | Render | Rotate → all sessions invalidate (users re-login) |
| Admin password | Render | New bcrypt hash → update `ADMIN_PASSWORD_HASH` |

## Scaling beyond 1000 domains

- Shard count auto-scales (`ceil(rows/250)`, cap 8). Raise the cap in `monitor.yml`/plan logic if needed — public-repo concurrency allows 20 jobs.
- Sheets writes scale linearly: 2000 rows = 10 batch calls, still trivial.
- Storage: ~270 KB/domain of images. At ~3000+ domains consider a second storage repo or reduced screenshot cadence (e.g. screenshots only on the morning run).
- Consider splitting into two sheets/workflows past ~5000 rows (Sheets cell limits and read latency).
