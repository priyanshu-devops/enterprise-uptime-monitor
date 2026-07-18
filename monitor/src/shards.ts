/**
 * Shard artifact I/O and domain-source reading.
 *
 * Each `check` job writes its results to `<output>/results.json` and its
 * screenshots under `<output>/screenshots/{domain}/`. The `aggregate` job reads
 * every shard's `results.json` back and merges them.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DOMAINS_DATA_RANGE,
  rowToRecord,
  type CheckResult,
  type StateFile,
} from '@uptime/shared';
import { SheetsClient } from '@uptime/gsheets';
import type { MonitorConfig } from './config.js';
import type { CheckInput } from './pipeline/runner.js';

/** Shape of one shard's results artifact. */
export interface ShardArtifact {
  shard: number;
  shardCount: number;
  results: CheckResult[];
  aborted: boolean;
}

/** Read all domains from the sheet as check inputs. */
export async function readDomainsFromSheet(config: MonitorConfig): Promise<CheckInput[]> {
  const client = new SheetsClient({
    spreadsheetId: config.sheetId,
    serviceAccountJsonB64: config.serviceAccountJsonB64,
  });
  const [rows] = await client.batchGet([DOMAINS_DATA_RANGE]);
  const inputs: CheckInput[] = [];
  for (const row of rows ?? []) {
    const record = rowToRecord(row);
    if (!record.domain) continue;
    // Paused domains are skipped by the engine.
    if (record.status === 'PAUSED') continue;
    inputs.push({ domain: record.domain, website: record.website || `https://${record.domain}` });
  }
  return inputs;
}

/**
 * Deterministically assign a domain list to shards by contiguous slicing.
 * Shard k gets inputs [k*size, (k+1)*size).
 */
export function selectShard(
  inputs: CheckInput[],
  shard: number,
  shardCount: number,
): CheckInput[] {
  if (shardCount <= 1) return inputs;
  const size = Math.ceil(inputs.length / shardCount);
  const start = shard * size;
  return inputs.slice(start, start + size);
}

/** Write a shard's results artifact to <output>/results.json. */
export async function writeShardArtifact(
  outputDir: string,
  artifact: ShardArtifact,
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, 'results.json'),
    JSON.stringify(artifact, null, 2),
    'utf8',
  );
}

/**
 * Read every shard artifact under `inputDir` (the aggregate step downloads all
 * `shard-*` artifacts into subdirectories). Deduplicates by domain, keeping the
 * most recent check.
 */
export async function readAllShardArtifacts(inputDir: string): Promise<{
  results: CheckResult[];
  anyAborted: boolean;
}> {
  const files = await findResultFiles(inputDir);
  const byDomain = new Map<string, CheckResult>();
  let anyAborted = false;

  for (const file of files) {
    try {
      const artifact = JSON.parse(await readFile(file, 'utf8')) as ShardArtifact;
      if (artifact.aborted) anyAborted = true;
      for (const result of artifact.results ?? []) {
        const prev = byDomain.get(result.domain);
        if (!prev || Date.parse(result.checkedAt) >= Date.parse(prev.checkedAt)) {
          byDomain.set(result.domain, result);
        }
      }
    } catch {
      // Skip unreadable/partial artifacts.
    }
  }

  return { results: [...byDomain.values()], anyAborted };
}

/** Recursively find all results.json files beneath a directory. */
async function findResultFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await findResultFiles(full)));
    } else if (entry.name === 'results.json') {
      out.push(full);
    }
  }
  return out;
}

/** Load the prior state file, or an empty one when absent/unreadable. */
export async function readState(stateFile: string): Promise<StateFile> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as StateFile;
    if (parsed && typeof parsed === 'object' && parsed.domains) return parsed;
  } catch {
    // fall through
  }
  return { updatedAt: new Date().toISOString(), domains: {} };
}
