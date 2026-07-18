/**
 * Aggregate step.
 *
 * Runs on the single `aggregate` job after all `check` shards complete. Reads
 * every shard artifact, detects incidents against prior state, writes the merged
 * results to the sheet, updates the per-domain state, and emits the cache bundle
 * (domains/summary/incidents/state/history) plus copied screenshots into the
 * storage directory that the workflow then commits to the storage repo.
 */
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { DomainRecord, Incident } from '@uptime/shared';
import type { MonitorConfig } from './config.js';
import type { Logger } from './logging.js';
import { errMessage } from './logging.js';
import { readAllShardArtifacts, readState } from './shards.js';
import { nextState } from './pipeline/pool.js';
import { detectIncidents } from './output/incidents.js';
import { writeToSheet } from './output/sheetWriter.js';
import { buildSummary, writeCache } from './output/cacheWriter.js';

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

/** Aggregate results and publish to sheet + storage. */
export async function runAggregate(
  opts: AggregateOptions,
  config: MonitorConfig,
  logger: Logger,
): Promise<void> {
  const cacheDir = path.join(opts.storageDir, 'cache');
  const priorState = await readState(path.join(cacheDir, 'state.json'));

  const { results, anyAborted } = await readAllShardArtifacts(opts.inputDir);
  logger.info('Loaded shard results', { count: results.length, anyAborted });

  if (results.length === 0) {
    logger.warn('No results to aggregate — skipping writes');
    return;
  }

  // Detect incidents and compute the next state per domain.
  const allIncidents: Incident[] = [];
  const nextDomains: Record<string, ReturnType<typeof nextState>> = {};
  for (const result of results) {
    const prior = priorState.domains[result.domain];
    for (const inc of detectIncidents(result, prior)) allIncidents.push(inc);
    nextDomains[result.domain] = nextState(result, prior);
  }
  // Preserve state for domains not checked this run (e.g. sharded-out subsets).
  for (const [domain, state] of Object.entries(priorState.domains)) {
    if (!(domain in nextDomains)) nextDomains[domain] = state;
  }
  const newState = { updatedAt: new Date().toISOString(), domains: nextDomains };

  const summary = buildSummary(results, opts.runId, opts.startedAt, allIncidents);

  // Write to the sheet (unless dry-run).
  let records: DomainRecord[];
  if (opts.dryRun) {
    logger.warn('Dry run — not writing to sheet');
    records = [];
  } else {
    const sheetResult = await writeToSheet(results, allIncidents, config, logger);
    records = sheetResult.records;
  }

  // Copy shard screenshots into the storage repo (stable paths).
  await copyScreenshots(opts.inputDir, opts.storageDir, logger);

  // Write the cache bundle.
  const written = await writeCache({
    cacheDir,
    records,
    summary,
    incidents: allIncidents,
    state: newState,
  });
  logger.info('Wrote cache files', { files: written.length });

  // Persist logs into the storage repo.
  await writeRunLog(opts.storageDir, logger);

  logger.info('Aggregate complete', {
    domains: results.length,
    incidents: allIncidents.length,
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
