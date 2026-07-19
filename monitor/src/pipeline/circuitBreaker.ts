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

/** HTTP/DNS error substrings that indicate the runner itself can't reach the
 * network (egress blocked / no route / DNS temp failure), as opposed to a
 * single site being down. Used by {@link isInfraFailure}. */
const NETWORK_UNREACHABLE_CODES = ['enetunreach', 'enetdown', 'ehostunreach', 'eai_again', 'timeout'];

/**
 * Classify whether a check result reflects a *runner-side infrastructure*
 * failure (the environment can't reach the internet) versus a specific domain
 * being genuinely dead. Only the former should trip the global breaker.
 *
 * Infra failure iff:
 *   - DNS failed with a resolver/network error (not a clean NXDOMAIN), OR
 *   - DNS resolved to an address but the HTTP layer never got any response and
 *     failed with a network-unreachable-class error.
 *
 * A clean NXDOMAIN, a connection refused by a resolved host, or any HTTP status
 * (including 5xx) is a real observation of a dead/broken *site*, not infra.
 */
export function isInfraFailure(result: {
  dns: { ok: boolean; resolverError?: boolean };
  http: { status: number; error?: string };
}): boolean {
  if (result.dns.resolverError) return true;

  // DNS resolved but HTTP produced no status and a network-class error.
  if (result.dns.ok && result.http.status === 0 && result.http.error) {
    const msg = result.http.error.toLowerCase();
    // econnrefused against a single resolved host is a real "site down", so
    // only the strictly-network-unreachable codes count here.
    return NETWORK_UNREACHABLE_CODES.some((h) => msg.includes(h));
  }
  return false;
}

/**
 * Tracks the rate of *infrastructure* failures across a shard to detect a
 * broken runner environment (no network, DNS resolver down, egress blocked).
 *
 * Crucially this is NOT the same as the domain-failure rate: a dataset full of
 * dead/parked domains (clean NXDOMAIN, connection refused by a real server)
 * produces many DOWN/DNS_FAILURE results while the runner's network is
 * perfectly healthy. Only failures that indicate the *runner itself* can't
 * reach the internet — DNS resolver timeouts/SERVFAIL, or HTTP connection
 * errors that never got a response — count toward tripping the breaker.
 */
export class GlobalBreaker {
  private checked = 0;
  private infraFailed = 0;

  constructor(
    /** Number of leading domains to sample. */
    private readonly sampleSize = 25,
    /** Infrastructure-failure fraction that trips the breaker. */
    private readonly threshold = 0.8,
  ) {}

  /**
   * Record one domain's outcome.
   *
   * @param infraFailure True when this result reflects a runner-side network
   *   failure (resolver error / connection error), NOT a domain that is simply
   *   dead (NXDOMAIN, refused, HTTP 5xx).
   */
  record(infraFailure: boolean): void {
    this.checked++;
    if (infraFailure) this.infraFailed++;
  }

  /**
   * Whether the shard should abort: only evaluated once the sample is complete,
   * so a handful of unreachable domains early on doesn't trip it.
   */
  shouldAbort(): boolean {
    if (this.checked < this.sampleSize) return false;
    return this.infraFailed / this.checked >= this.threshold;
  }

  /** Current infrastructure-failure ratio (for logging). */
  ratio(): number {
    return this.checked === 0 ? 0 : this.infraFailed / this.checked;
  }
}
