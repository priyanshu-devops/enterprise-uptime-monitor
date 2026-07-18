/**
 * Runtime configuration for the monitor engine, sourced from environment
 * variables (populated by GitHub Actions secrets/vars or a local .env).
 *
 * Only `SHEET_ID` and `GOOGLE_SERVICE_ACCOUNT_JSON_B64` are strictly required
 * for a live run; everything else has a sensible default so `--plan`,
 * `--dry-run`, and local experimentation work without full secrets.
 */

/** Parsed, validated engine configuration. */
export interface MonitorConfig {
  /** Google Spreadsheet ID (the "database"). */
  sheetId: string;
  /** Base64 service-account JSON key for Sheets auth. */
  serviceAccountJsonB64: string;
  /** GitHub Pages base URL where the storage repo is published. */
  pagesBaseUrl: string;
  /** Domains per shard when computing the plan matrix. */
  shardSize: number;
  /** Max shards (GitHub matrix cap). */
  maxShards: number;
  /** Concurrent HTTP checks within a shard. */
  httpPool: number;
  /** Concurrent RDAP lookups. */
  rdapPool: number;
  /** Concurrent screenshot captures. */
  screenshotPool: number;
  /** Per-network-operation timeout, ms. */
  opTimeoutMs: number;
  /** Whole-pipeline budget per domain, ms. */
  domainBudgetMs: number;
}

/** Read an integer env var with a default and lower bound. */
function intEnv(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.floor(n));
}

/**
 * Load configuration from the environment.
 *
 * @param requireSecrets When true, throws if Sheets credentials are absent
 *   (used by live run/aggregate; `--plan --dry-run` pass false).
 */
export function loadConfig(requireSecrets = true): MonitorConfig {
  const sheetId = process.env.SHEET_ID ?? '';
  const serviceAccountJsonB64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_B64 ?? '';

  if (requireSecrets) {
    const missing: string[] = [];
    if (!sheetId) missing.push('SHEET_ID');
    if (!serviceAccountJsonB64) missing.push('GOOGLE_SERVICE_ACCOUNT_JSON_B64');
    if (missing.length > 0) {
      throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
    }
  }

  return {
    sheetId,
    serviceAccountJsonB64,
    pagesBaseUrl: (process.env.PAGES_BASE_URL ?? '').replace(/\/+$/, ''),
    shardSize: intEnv('SHARD_SIZE', 250),
    maxShards: intEnv('MAX_SHARDS', 8),
    httpPool: intEnv('HTTP_POOL', 20),
    rdapPool: intEnv('RDAP_POOL', 5),
    screenshotPool: intEnv('SCREENSHOT_POOL', 4),
    opTimeoutMs: intEnv('OP_TIMEOUT_MS', 10_000, 1000),
    domainBudgetMs: intEnv('DOMAIN_BUDGET_MS', 45_000, 5000),
  };
}
