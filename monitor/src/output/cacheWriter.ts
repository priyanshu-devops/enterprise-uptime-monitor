/**
 * Cache writer.
 *
 * Serializes the aggregated run into the static JSON files the dashboard reads
 * from GitHub Pages during backend cold-starts, exactly matching the shapes the
 * frontend client and backend fallback expect:
 *
 *   cache/domains.json            DomainRecord[]
 *   cache/summary.json            RunSummary
 *   cache/incidents.json          Incident[]
 *   cache/state.json              StateFile
 *   cache/history/YYYY-MM/DD.json HistoryPoint
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  istDate,
  type CheckResult,
  type DomainRecord,
  type HistoryPoint,
  type Incident,
  type RunSummary,
  type SlaReport,
  type StateFile,
} from '@uptime/shared';

/** Write a JSON file, creating parent directories. */
async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/** Average of a numeric array, rounded; 0 for empty. */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Build the run summary from all results.
 *
 * @param results All check results in the run.
 * @param runId The GitHub Actions run id (or a local id).
 * @param startedAt ISO start time.
 * @param incidents Incidents detected this run.
 */
export function buildSummary(
  results: CheckResult[],
  runId: string,
  startedAt: string,
  incidents: Incident[],
): RunSummary {
  const up = results.filter((r) => r.status === 'UP' || r.status === 'REDIRECT').length;
  const down = results.filter((r) => r.status === 'DOWN' || r.status === 'TIMEOUT').length;
  const degraded = results.filter((r) => r.status === 'DEGRADED').length;
  const errors = results.filter((r) => r.status === 'ERROR' || r.status === 'SSL_ERROR').length;
  const dnsIssues = results.filter((r) => r.status === 'DNS_FAILURE').length;
  const redirectIssues = results.filter((r) => r.http.redirectCount > 3).length;

  const sslResults = results.filter((r) => r.ssl.ok);
  const sslExpired = sslResults.filter((r) => r.ssl.daysRemaining < 0).length;
  const sslExpiringSoon = sslResults.filter(
    (r) => r.ssl.daysRemaining >= 0 && r.ssl.daysRemaining < 30,
  ).length;

  const responseTimes = results.filter((r) => r.http.ok).map((r) => r.http.totalMs);
  const ttfbs = results.filter((r) => r.http.ok).map((r) => r.http.ttfbMs);

  const screenshotsCaptured = results.filter((r) => r.screenshot.ok).length;
  const screenshotsFailed = results.filter(
    (r) => !r.screenshot.ok && r.screenshot.error !== undefined,
  ).length;

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    totalDomains: results.length,
    up,
    down,
    degraded,
    errors,
    sslExpiringSoon,
    sslExpired,
    dnsIssues,
    redirectIssues,
    avgResponseTimeMs: avg(responseTimes),
    avgTtfbMs: avg(ttfbs),
    avgHealthScore: avg(results.map((r) => r.healthScore)),
    cloudflareCount: results.filter((r) => r.tech.cloudflare).length,
    wordpressCount: results.filter((r) => r.tech.wordpress).length,
    screenshotsCaptured,
    screenshotsFailed,
    incidentsOpened: incidents.filter((i) => i.status === 'open').length,
    incidentsResolved: incidents.filter((i) => i.status === 'resolved').length,
  };
}

/** Build a single history point (one per day) from the summary. */
export function buildHistoryPoint(summary: RunSummary): HistoryPoint {
  const total = summary.totalDomains;
  const availabilityPct =
    total === 0 ? 0 : Math.round(((summary.up + summary.degraded) / total) * 1000) / 10;
  return {
    date: istDate(new Date(summary.finishedAt)),
    up: summary.up,
    down: summary.down,
    degraded: summary.degraded,
    total,
    avgResponseTimeMs: summary.avgResponseTimeMs,
    avgTtfbMs: summary.avgTtfbMs,
    avgHealthScore: summary.avgHealthScore,
    availabilityPct,
  };
}

/** Options for writing the cache bundle. */
export interface CacheWriteOptions {
  cacheDir: string;
  records: DomainRecord[];
  summary: RunSummary;
  incidents: Incident[];
  state: StateFile;
  sla: SlaReport;
}

/**
 * Write all cache files for a completed run.
 *
 * @returns The path list written (for logging).
 */
export async function writeCache(opts: CacheWriteOptions): Promise<string[]> {
  const { cacheDir, records, summary, incidents, state, sla } = opts;
  const written: string[] = [];

  const domainsFile = path.join(cacheDir, 'domains.json');
  const summaryFile = path.join(cacheDir, 'summary.json');
  const incidentsFile = path.join(cacheDir, 'incidents.json');
  const stateFile = path.join(cacheDir, 'state.json');
  const slaFile = path.join(cacheDir, 'sla.json');

  await writeJson(domainsFile, records);
  await writeJson(summaryFile, summary);
  await writeJson(incidentsFile, incidents);
  await writeJson(stateFile, state);
  await writeJson(slaFile, sla);
  written.push(domainsFile, summaryFile, incidentsFile, stateFile, slaFile);

  // Daily history point: cache/history/YYYY-MM/DD.json
  const point = buildHistoryPoint(summary);
  const [year, month, day] = point.date.split('-');
  const historyFile = path.join(cacheDir, 'history', `${year}-${month}`, `${day}.json`);
  await writeJson(historyFile, point);
  written.push(historyFile);

  return written;
}
