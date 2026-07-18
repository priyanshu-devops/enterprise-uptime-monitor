/**
 * Circuit breaker for the monitoring pipeline.
 *
 * Two layers:
 *  - Per-domain: a domain with >= FAILURE_THRESHOLD consecutive failures (from
 *    persisted state) is "open" — the runner does a cheap availability probe
 *    only and skips expensive deep checks (RDAP, hosting, screenshots) until it
 *    recovers, saving budget on chronically-dead domains.
 *  - Global (per shard): if a large fraction of the first N domains fail, the
 *    shard is likely running in a broken network environment; the runner aborts
 *    rather than writing garbage over good data.
 */

/** Consecutive failures before a domain's breaker opens. */
export const FAILURE_THRESHOLD = 3;

/** Whether a domain's circuit is open given its consecutive failure count. */
export function isCircuitOpen(consecutiveFailures: number): boolean {
  return consecutiveFailures >= FAILURE_THRESHOLD;
}

/** Statuses considered "failures" for breaker/flap accounting. */
const FAILURE_STATUSES = new Set(['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'ERROR', 'SSL_ERROR']);

/** Whether a status counts as a failure. */
export function isFailureStatus(status: string): boolean {
  return FAILURE_STATUSES.has(status);
}

/**
 * Tracks the global failure rate across a shard to detect a broken environment.
 */
export class GlobalBreaker {
  private checked = 0;
  private failed = 0;

  constructor(
    /** Number of leading domains to sample. */
    private readonly sampleSize = 25,
    /** Failure fraction that trips the breaker. */
    private readonly threshold = 0.8,
  ) {}

  /** Record one domain's outcome. */
  record(status: string): void {
    this.checked++;
    if (isFailureStatus(status)) this.failed++;
  }

  /**
   * Whether the shard should abort: only evaluated once the sample is complete,
   * so a handful of genuinely-down domains early on doesn't trip it.
   */
  shouldAbort(): boolean {
    if (this.checked < this.sampleSize) return false;
    return this.failed / this.checked >= this.threshold;
  }

  /** Current failure ratio (for logging). */
  ratio(): number {
    return this.checked === 0 ? 0 : this.failed / this.checked;
  }
}
