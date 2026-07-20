#!/usr/bin/env node
/**
 * Monitor engine CLI.
 *
 * Modes (mirrors .github/workflows/monitor.yml):
 *   --plan                        Print {matrix, shardCount} JSON to stdout.
 *   --shard N --shard-count M     Run one shard; write artifact to --output.
 *   --aggregate                   Merge shard artifacts, write sheet + storage.
 *
 * Flags:
 *   --limit N                     Cap total domains (testing).
 *   --batch-start N               1-based start index into the sheet (batch runs).
 *   --batch-end N                 1-based inclusive end index (batch runs).
 *   --domains a.com,b.com         Only these domains.
 *   --output DIR                  Shard output dir (default monitor/output).
 *   --input DIR                   Aggregate input dir (downloaded artifacts).
 *   --storage-dir DIR             Storage repo checkout (aggregate).
 *   --run-id ID                   Run identifier stamped into summary.
 *   --skip-screenshots            Don't launch the browser.
 *   --dry-run                     Compute but don't write to the sheet.
 */
import { loadConfig } from './config.js';
import { Logger, errMessage } from './logging.js';
import { installSignalHandlers } from './lifecycle.js';
import {
  readDomainsFromSheet,
  selectShard,
  writeShardArtifact,
  readState,
} from './shards.js';
import { runShard } from './pipeline/pool.js';
import { runAggregate } from './aggregate.js';
import type { CheckInput } from './pipeline/runner.js';
import path from 'node:path';

/** Parsed CLI arguments. */
interface Args {
  plan: boolean;
  aggregate: boolean;
  shard: number | null;
  shardCount: number;
  limit: number | null;
  batchStart: number | null;
  batchEnd: number | null;
  domains: string[] | null;
  output: string;
  input: string;
  storageDir: string;
  runId: string;
  skipScreenshots: boolean;
  dryRun: boolean;
}

/** Minimal, dependency-free flag parser. */
function parseArgs(argv: string[]): Args {
  const args: Args = {
    plan: false,
    aggregate: false,
    shard: null,
    shardCount: 1,
    limit: null,
    batchStart: null,
    batchEnd: null,
    domains: null,
    output: 'monitor/output',
    input: 'shards',
    storageDir: 'storage',
    runId: `local-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    skipScreenshots: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? '';
    switch (a) {
      case '--plan':
        args.plan = true;
        break;
      case '--aggregate':
        args.aggregate = true;
        break;
      case '--shard':
        args.shard = Number(next());
        break;
      case '--shard-count':
        args.shardCount = Math.max(1, Number(next()));
        break;
      case '--limit':
        args.limit = Math.max(1, Number(next()));
        break;
      case '--batch-start':
        args.batchStart = Math.max(1, Number(next()));
        break;
      case '--batch-end':
        args.batchEnd = Math.max(1, Number(next()));
        break;
      case '--domains':
        args.domains = next()
          .split(',')
          .map((d) => d.trim())
          .filter(Boolean);
        break;
      case '--output':
        args.output = next();
        break;
      case '--input':
        args.input = next();
        break;
      case '--storage-dir':
        args.storageDir = next();
        break;
      case '--run-id':
        args.runId = next();
        break;
      case '--skip-screenshots':
        args.skipScreenshots = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        if (a && a.startsWith('--')) {
          process.stderr.write(`Unknown flag: ${a}\n`);
        }
    }
  }
  return args;
}

/** Apply --limit / --batch-start/end / --domains narrowing to a full input list. */
function narrow(inputs: CheckInput[], args: Args): CheckInput[] {
  let out = inputs;
  if (args.domains && args.domains.length > 0) {
    const set = new Set(args.domains.map((d) => d.toLowerCase()));
    out = out.filter((i) => set.has(i.domain.toLowerCase()));
    // Include requested domains not present in the sheet.
    for (const d of args.domains) {
      if (!out.some((i) => i.domain.toLowerCase() === d.toLowerCase())) {
        out.push({ domain: d.toLowerCase(), website: `https://${d.toLowerCase()}` });
      }
    }
  }

  // Batch range takes precedence over limit
  if (args.batchStart !== null && args.batchEnd !== null) {
    const start = args.batchStart - 1; // Convert 1-based to 0-based
    const end = args.batchEnd;
    out = out.slice(start, end);
  } else if (args.batchStart !== null) {
    // Only start specified - from start to end
    const start = args.batchStart - 1;
    out = out.slice(start);
  } else if (args.limit !== null) {
    out = out.slice(0, args.limit);
  }

  return out;
}

/** Compute the shard matrix for the `prepare` job and print it to stdout. */
async function doPlan(args: Args): Promise<void> {
  const config = loadConfig(true);
  const logger = new Logger({ mode: 'plan' });
  const all = await readDomainsFromSheet(config);
  const narrowed = narrow(all, args);
  const shardCount = Math.max(
    1,
    Math.min(config.maxShards, Math.ceil(narrowed.length / config.shardSize)),
  );
  const matrix = Array.from({ length: shardCount }, (_, i) => i);
  logger.info('Computed plan', { total: narrowed.length, shardCount });
  // stdout is reserved for machine-readable JSON.
  process.stdout.write(JSON.stringify({ total: narrowed.length, shardCount, matrix }) + '\n');
}

/** Run a single shard and write its artifact. */
async function doShard(args: Args): Promise<void> {
  if (args.shard === null || Number.isNaN(args.shard)) {
    throw new Error('--shard N is required');
  }
  const config = loadConfig(true);
  const logger = new Logger({ mode: 'shard', shard: args.shard, shardCount: args.shardCount });

  const all = await readDomainsFromSheet(config);
  const narrowed = narrow(all, args);
  const mine = selectShard(narrowed, args.shard, args.shardCount);
  logger.info('Shard assigned domains', { count: mine.length });

  const priorState = await readState(path.join('monitor', 'state', 'state.json'));

  const { results, aborted } = await runShard(
    mine,
    config,
    priorState,
    args.output,
    args.skipScreenshots,
    logger,
  );

  await writeShardArtifact(args.output, {
    shard: args.shard,
    shardCount: args.shardCount,
    results,
    aborted,
  });
  logger.info('Wrote shard artifact', { output: args.output, results: results.length });

  if (aborted) {
    process.exitCode = 2; // signal a broken environment to the workflow
  }
}

/** Aggregate all shard artifacts and publish. */
async function doAggregate(args: Args): Promise<void> {
  const config = loadConfig(!args.dryRun);
  const logger = new Logger({ mode: 'aggregate', runId: args.runId });
  await runAggregate(
    {
      inputDir: args.input,
      storageDir: args.storageDir,
      runId: args.runId,
      startedAt: new Date().toISOString(),
      dryRun: args.dryRun,
    },
    config,
    logger,
  );
}

/** Entry point. */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  installSignalHandlers(new Logger({ mode: 'lifecycle' }));
  if (args.plan) return doPlan(args);
  if (args.aggregate) return doAggregate(args);
  return doShard(args);
}

main().catch((err) => {
  process.stderr.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Fatal error',
      error: errMessage(err),
    }) + '\n',
  );
  process.exit(1);
});
