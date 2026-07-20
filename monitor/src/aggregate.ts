/**
 * Aggregate step.
 *
 * Runs on the single `aggregate` job after all `check` shards complete. Reads
 * every shard artifact, runs the incident lifecycle against the persistent
 * ledger (open/resolve with durations), updates per-domain state + rolling SLA
 * samples, writes the merged results to the sheet, sends alert notifications,
 * and emits the cache bundle (domains/summary/incidents/state/sla/history)
 * plus copied screenshots into the storage directory that the workflow then
 * commits to the storage repo.
 */
import { cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { DomainRecord, Incident, SlaSample } from '@uptime/shared';
import type { MonitorConfig } from './config.js';
import type { Logger } from './logging.js';
import { errMessage } from './logging.js';
import { readAllShardArtifacts, readState } from './shards.js';
import { nextState } from './pipeline/pool.js';
import { detectIncidents } from './output/incidents.js';
import { writeToSheet } from './output/sheetWriter.js';
import { buildSummary, writeCache } from './output/cacheWriter.js';
import { buildSlaReport } from './output/sla.js';
import { sendAlerts } from './output/alerts.js';

/** Max incidents retained in the cache ledger (newest first). */
const LEDGER_CAP = 500;

/** Options for the aggregate step. */
export interface AggregateOptions {
  /** Directory holding downloaded shard-* artifacts. */
  inputDir: string;
  /** Storage repo checkout dir (where cache/ + screenshots/ + logs/ live). */
  storageDir: string;
  /** GitHub Actions run id. */
  runId: string;
  /** ISO time the run started. */
  startedAt: string;
  /** Dry run: compute everything but don't write to the sheet. */
  dryRun?: boolean;
}

/** Read the persistent incident ledger from the storage checkout. */
async function readLedger(cacheDir: string): Promise<Incident[]> {
  try {
    const raw = await readFile(path.join(cacheDir, 'incidents.json'), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Backfill fields added after older runs wrote the file.
    return (parsed as Partial<Incident>[]).map((i) => ({
      durationSeconds: null,
      ackedAt: null,
      ackedBy: '',
      ...i,
    })) as Incident[];
  } catch {
    return [];
  }
}

/** Aggregate results and publish to sheet + storage. */
export async function runAggregate(
  opts: AggregateOptions,
  config: MonitorConfig,
  logger: Logger,
): Promise<void> {
  const cacheDir = path.join(opts.storageDir, 'cache');
  const priorState = await readState(path.join(cacheDir, 'state.json'));
  const ledger = await readLedger(cacheDir);

  const { results, anyAborted } = await readAllShardArtifacts(opts.inputDir);
  logger.info('Loaded shard results', { count: results.length, anyAborted });

  if (results.length === 0) {
    logger.warn('No results to aggregate — skipping writes');
    return;
  }

  // Open ledger incidents grouped by domain, for dedupe + resolution.
  const openByDomain = new Map<string, Incident[]>();
  for (const inc of ledger) {
    if (inc.status !== 'open') continue;
    const list = openByDomain.get(inc.domain) ?? [];
    list.push(inc);
    openByDomain.set(inc.domain, list);
  }

  // Incident lifecycle + next state per domain.
  const opened: Incident[] = [];
  const resolved: Incident[] = [];
  const nextDomains: Record<string, ReturnType<typeof nextState>> = {};
  for (const result of results) {
    const prior = priorState.domains[result.domain];
    const delta = detectIncidents(result, prior, openByDomain.get(result.domain) ?? []);
    opened.push(...delta.opened);
    resolved.push(...delta.resolved);
    nextDomains[result.domain] = nextState(result, prior);
  }
  // Preserve state for domains not checked this run (e.g. sharded-out subsets).
  for (const [domain, state] of Object.entries(priorState.domains)) {
    if (!(domain in nextDomains)) nextDomains[domain] = state;
  }
  const newState = { updatedAt: new Date().toISOString(), domains: nextDomains };

  // Merge lifecycle changes into the ledger: replace resolved by id, prepend opened.
  const resolvedById = new Map(resolved.map((i) => [i.id, i]));
  const mergedLedger = [
    ...opened,
    ...ledger.map((i) => resolvedById.get(i.id) ?? i),
  ]
    .sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))
    .slice(0, LEDGER_CAP);

  logger.info('Incident lifecycle', {
    opened: opened.length,
    resolved: resolved.length,
    ledger: mergedLedger.length,
  });

  const summary = buildSummary(results, opts.runId, opts.startedAt, [...opened, ...resolved]);

  // SLA report from the rolling samples in the new state.
  const samplesByDomain: Record<string, SlaSample[]> = {};
  for (const [domain, state] of Object.entries(nextDomains)) {
    if (state.samples && state.samples.length > 0) samplesByDomain[domain] = state.samples;
  }
  const sla = buildSlaReport(samplesByDomain, mergedLedger, opts.runId);

  // Write to the sheet (unless dry-run).
  let records: DomainRecord[];
  if (opts.dryRun) {
    logger.warn('Dry run — not writing to sheet');
    records = [];
  } else {
    const sheetResult = await writeToSheet(results, opened, resolved, config, logger);
    records = sheetResult.records;
  }

  // Copy shard screenshots into the storage repo (stable paths).
  await copyScreenshots(opts.inputDir, opts.storageDir, logger);

  // Write the cache bundle.
  const written = await writeCache({
    cacheDir,
    records,
    summary,
    incidents: mergedLedger,
    state: newState,
    sla,
  });
  logger.info('Wrote cache files', { files: written.length });

  // Alert notifications (fail-soft; skipped in dry-run).
  if (!opts.dryRun) {
    await sendAlerts(
      { opened, resolved, summary, dashboardUrl: process.env.DASHBOARD_URL ?? '' },
      logger,
    );
  }

  // Persist logs into the storage repo.
  await writeRunLog(opts.storageDir, logger);

  logger.info('Aggregate complete', {
    domains: results.length,
    opened: opened.length,
    resolved: resolved.length,
    up: summary.up,
    down: summary.down,
    screenshots: summary.screenshotsCaptured,
  });
}

/** Copy every shard's screenshots/ tree into <storage>/screenshots. */
async function copyScreenshots(
  inputDir: string,
  storageDir: string,
  logger: Logger,
): Promise<void> {
  const { readdir } = await import('node:fs/promises');
  const dest = path.join(storageDir, 'screenshots');
  await mkdir(dest, { recursive: true });
  let shardDirs: string[] = [];
  try {
    const entries = await readdir(inputDir, { withFileTypes: true });
    shardDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(inputDir, e.name));
  } catch {
    return;
  }
  for (const shardDir of shardDirs) {
    const src = path.join(shardDir, 'screenshots');
    if (!existsSync(src)) continue;
    try {
      await cp(src, dest, { recursive: true, force: true });
    } catch (err) {
      logger.warn('Failed to copy screenshots', { shardDir, error: errMessage(err) });
    }
  }
}

/** Append this run's JSONL log to <storage>/logs/monitor/<date>.jsonl. */
async function writeRunLog(storageDir: string, logger: Logger): Promise<void> {
  const { appendFile } = await import('node:fs/promises');
  const date = new Date().toISOString().slice(0, 10);
  const logDir = path.join(storageDir, 'logs', 'monitor');
  await mkdir(logDir, { recursive: true });
  const jsonl = logger.toJsonl();
  if (jsonl) {
    await appendFile(path.join(logDir, `${date}.jsonl`), jsonl, 'utf8').catch(() => undefined);
  }
}
