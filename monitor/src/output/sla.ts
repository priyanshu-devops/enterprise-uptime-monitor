/**
 * SLA computation.
 *
 * From the rolling per-domain samples kept in DomainState (`[ts, status, ms]`,
 * newest first), computes uptime percentages over standard windows
 * (24h/7d/30d/90d), response-time percentiles over 30d, fleet rollups, and
 * MTTR over resolved incidents — written to cache/sla.json for the dashboard
 * and the public status page.
 */
import type {
  CheckResult,
  DomainSla,
  Incident,
  SlaReport,
  SlaSample,
  SlaWindows,
} from '@uptime/shared';

/** Statuses counted as "up" for SLA purposes (REDIRECT serves traffic). */
const UP_STATUSES = new Set(['UP', 'REDIRECT', 'DEGRADED']);

/** Max samples retained per domain (~90 days at 2 runs/day, with slack). */
export const MAX_SAMPLES = 200;

const WINDOW_MS: Record<keyof SlaWindows, number> = {
  '24h': 24 * 3600_000,
  '7d': 7 * 86400_000,
  '30d': 30 * 86400_000,
  '90d': 90 * 86400_000,
};

/** Append this run's sample to a domain's rolling window (newest first). */
export function appendSample(prior: SlaSample[] | undefined, result: CheckResult): SlaSample[] {
  const ms = result.http.ok ? result.http.totalMs : 0;
  return [[result.checkedAt, result.status, ms] as SlaSample, ...(prior ?? [])].slice(
    0,
    MAX_SAMPLES,
  );
}

/** Percentile (nearest-rank) of a sorted-ascending numeric array. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)]!;
}

/** Uptime % of samples within a window; null when the window has no samples. */
function windowUptime(samples: SlaSample[], nowMs: number, windowMs: number): number | null {
  let up = 0;
  let total = 0;
  for (const [ts, status] of samples) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t) || nowMs - t > windowMs) continue;
    total++;
    if (UP_STATUSES.has(status)) up++;
  }
  if (total === 0) return null;
  return Math.round((up / total) * 10000) / 100;
}

/** Compute one domain's SLA entry from its samples. */
export function computeDomainSla(
  domain: string,
  samples: SlaSample[],
  nowMs: number,
): DomainSla {
  const uptime: SlaWindows = {
    '24h': windowUptime(samples, nowMs, WINDOW_MS['24h']),
    '7d': windowUptime(samples, nowMs, WINDOW_MS['7d']),
    '30d': windowUptime(samples, nowMs, WINDOW_MS['30d']),
    '90d': windowUptime(samples, nowMs, WINDOW_MS['90d']),
  };

  const in30d = samples.filter(([ts]) => {
    const t = new Date(ts).getTime();
    return !Number.isNaN(t) && nowMs - t <= WINDOW_MS['30d'];
  });
  const times = in30d
    .filter(([, status, ms]) => UP_STATUSES.has(status) && ms > 0)
    .map(([, , ms]) => ms)
    .sort((a, b) => a - b);

  return {
    domain,
    uptime,
    p50Ms: percentile(times, 50),
    p95Ms: percentile(times, 95),
    p99Ms: percentile(times, 99),
    sampleCount30d: in30d.length,
    status: samples[0]?.[1] ?? 'UNKNOWN',
  };
}

/** Mean of the non-null values; null when all are null. */
function meanPct(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100;
}

/**
 * Build the full SLA report.
 *
 * @param samplesByDomain Rolling samples per domain (from the NEW state).
 * @param allIncidents Full incident ledger (for MTTR over resolved ones).
 * @param runId This run's id.
 */
export function buildSlaReport(
  samplesByDomain: Record<string, SlaSample[]>,
  allIncidents: Incident[],
  runId: string,
): SlaReport {
  const nowMs = Date.now();
  const domains = Object.entries(samplesByDomain)
    .map(([domain, samples]) => computeDomainSla(domain, samples, nowMs))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  const fleet: SlaWindows = {
    '24h': meanPct(domains.map((d) => d.uptime['24h'])),
    '7d': meanPct(domains.map((d) => d.uptime['7d'])),
    '30d': meanPct(domains.map((d) => d.uptime['30d'])),
    '90d': meanPct(domains.map((d) => d.uptime['90d'])),
  };

  // Fleet percentiles: pool every successful 30d sample across domains.
  const pooled: number[] = [];
  for (const samples of Object.values(samplesByDomain)) {
    for (const [ts, status, ms] of samples) {
      const t = new Date(ts).getTime();
      if (Number.isNaN(t) || nowMs - t > WINDOW_MS['30d']) continue;
      if (UP_STATUSES.has(status) && ms > 0) pooled.push(ms);
    }
  }
  pooled.sort((a, b) => a - b);

  // MTTR: mean durationSeconds of availability incidents resolved in the last 30d.
  const resolved = allIncidents.filter(
    (i) =>
      i.status === 'resolved' &&
      i.durationSeconds !== null &&
      i.resolvedAt !== null &&
      nowMs - new Date(i.resolvedAt).getTime() <= WINDOW_MS['30d'] &&
      (i.type === 'DOWN' || i.type === 'DNS_FAILURE' || i.type === 'DEGRADED'),
  );
  const mttr =
    resolved.length === 0
      ? null
      : Math.round(resolved.reduce((a, i) => a + (i.durationSeconds ?? 0), 0) / resolved.length);

  return {
    generatedAt: new Date().toISOString(),
    runId,
    fleet,
    fleetP50Ms: percentile(pooled, 50),
    fleetP95Ms: percentile(pooled, 95),
    fleetP99Ms: percentile(pooled, 99),
    mttrSeconds30d: mttr,
    incidentsResolved30d: resolved.length,
    domains,
  };
}
