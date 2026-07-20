/**
 * Shard executor.
 *
 * Runs a shard's domains through the pipeline with bounded concurrency
 * (p-limit), threads per-domain state, tracks the global circuit breaker, and
 * manages the shared screenshot engine's lifecycle.
 */
import pLimit from 'p-limit';
import type { CheckResult, DomainState, StateFile } from '@uptime/shared';
import type { MonitorConfig } from '../config.js';
import type { Logger } from '../logging.js';
import { runDomain, type CheckInput } from './runner.js';
import { GlobalBreaker, isInfraFailure } from './circuitBreaker.js';
import { ScreenshotEngine } from '../screenshot/engine.js';
import { appendSample } from '../output/sla.js';
import { registerCleanup } from '../lifecycle.js';

/** Outcome of running one shard. */
export interface ShardRunResult {
  results: CheckResult[];
  aborted: boolean;
}

/**
 * Execute all domains in a shard.
 *
 * @param inputs Domains assigned to this shard.
 * @param config Engine config.
 * @param priorState Persisted state file (per-domain breaker + lookup cache).
 * @param outputDir Directory for screenshot output.
 * @param skipScreenshots When true, no browser is launched.
 * @param logger Shard logger.
 */
export async function runShard(
  inputs: CheckInput[],
  config: MonitorConfig,
  priorState: StateFile,
  outputDir: string,
  skipScreenshots: boolean,
  logger: Logger,
): Promise<ShardRunResult> {
  const limit = pLimit(config.httpPool);
  const screenshotLimit = pLimit(config.screenshotPool);
  const breaker = new GlobalBreaker();
  const results: CheckResult[] = [];
  let aborted = false;

  const screenshotEngine = skipScreenshots ? undefined : new ScreenshotEngine(outputDir, logger);
  // Ensure Chromium dies on SIGTERM/SIGINT (workflow cancellation) too — the
  // finally below only covers normal completion. (audit C-7)
  const unregisterCleanup = screenshotEngine
    ? registerCleanup(() => screenshotEngine.close())
    : undefined;

  // A wrapper that serializes screenshot capture through its own smaller pool,
  // so the browser isn't hammered by httpPool-many concurrent contexts.
  const engineProxy = screenshotEngine
    ? {
        capture: (domain: string, url: string, signal?: AbortSignal) =>
          screenshotLimit(() => screenshotEngine.capture(domain, url, signal)),
        close: () => screenshotEngine.close(),
      }
    : undefined;

  try {
    const tasks = inputs.map((input) =>
      limit(async () => {
        if (aborted) return;
        const state = priorState.domains[input.domain];
        const result = await runDomain(
          input,
          config,
          state,
          logger.child({ domain: input.domain }),
          engineProxy as ScreenshotEngine | undefined,
        );
        results.push(result);
        breaker.record(isInfraFailure(result));
        if (breaker.shouldAbort() && !aborted) {
          aborted = true;
          logger.error('Global circuit breaker tripped — aborting shard', {
            infraFailureRatio: Number(breaker.ratio().toFixed(2)),
            checked: results.length,
          });
        }
      }),
    );
    await Promise.all(tasks);
  } finally {
    unregisterCleanup?.();
    if (screenshotEngine) await screenshotEngine.close();
  }

  logger.info('Shard complete', {
    domains: inputs.length,
    checked: results.length,
    aborted,
  });

  return { results, aborted };
}

/** Build a fresh, empty state file. */
export function emptyState(): StateFile {
  return { updatedAt: new Date().toISOString(), domains: {} };
}

/**
 * Compute the next per-domain state from a check result and the prior state.
 * Advances the consecutive-failure counter, retains the trailing status window,
 * and refreshes lookup caches when a live lookup succeeded.
 */
export function nextState(result: CheckResult, prior: DomainState | undefined): DomainState {
  const failureStatuses = ['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'ERROR', 'SSL_ERROR'];
  const failed = failureStatuses.includes(result.status);
  const recent = [result.status, ...(prior?.recentStatuses ?? [])].slice(0, 14);

  const state: DomainState = {
    consecutiveFailures: failed ? (prior?.consecutiveFailures ?? 0) + 1 : 0,
    lastStatus: result.status,
    recentStatuses: recent,
    samples: appendSample(prior?.samples, result),
  };

  // Refresh RDAP cache when the live lookup succeeded; else retain prior.
  if (result.rdap.ok && result.rdap.error === undefined) {
    state.rdapExpiry = result.rdap.expiryDate;
    state.rdapRegistrar = result.rdap.registrar;
    state.rdapFetchedAt = new Date().toISOString();
  } else if (prior?.rdapFetchedAt) {
    state.rdapExpiry = prior.rdapExpiry;
    state.rdapRegistrar = prior.rdapRegistrar;
    state.rdapFetchedAt = prior.rdapFetchedAt;
  }

  // Refresh hosting cache similarly.
  if (result.hosting.ok && result.hosting.error === undefined) {
    state.hosting = result.hosting;
    state.hostingFetchedAt = new Date().toISOString();
  } else if (prior?.hosting && prior.hostingFetchedAt) {
    state.hosting = prior.hosting;
    state.hostingFetchedAt = prior.hostingFetchedAt;
  }

  return state;
}
