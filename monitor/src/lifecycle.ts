/**
 * Process lifecycle for the monitor CLI (audit C-7).
 *
 * A cancelled GitHub Actions run sends SIGTERM (then SIGKILL after a grace
 * period). Without handlers, Node dies mid-run leaving Chromium child
 * processes and half-written artifacts behind. This module keeps a registry of
 * cleanup callbacks (e.g. "close the browser") and installs handlers for
 * SIGTERM/SIGINT plus last-resort unhandledRejection/uncaughtException.
 */
import type { Logger } from './logging.js';
import { errMessage } from './logging.js';

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

/** How long cleanup may take before we exit anyway. */
const CLEANUP_TIMEOUT_MS = 5_000;

/**
 * Register a cleanup callback to run on fatal signal/error.
 * Returns an unregister function — call it once the resource is closed
 * normally so cleanup doesn't double-close.
 */
export function registerCleanup(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

/** Run all registered cleanups, bounded by CLEANUP_TIMEOUT_MS. */
async function runCleanups(logger: Logger): Promise<void> {
  if (cleanups.size === 0) return;
  const pending = [...cleanups].map(async (fn) => {
    try {
      await fn();
    } catch (err) {
      logger.warn('Cleanup callback failed', { error: errMessage(err) });
    }
  });
  cleanups.clear();
  const cap = new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS).unref());
  await Promise.race([Promise.allSettled(pending), cap]);
}

let installed = false;

/**
 * Install signal + fatal-error handlers. Idempotent.
 *
 * SIGTERM/SIGINT: run cleanups, exit with the conventional 128+signum code so
 * the workflow reports "cancelled" rather than "failed".
 * uncaughtException / unhandledRejection: log, clean up, exit 1 — a batch
 * check run must never continue with undefined state.
 */
export function installSignalHandlers(logger: Logger): void {
  if (installed) return;
  installed = true;

  const onSignal = (signal: 'SIGTERM' | 'SIGINT', code: number): void => {
    logger.warn('Received signal — shutting down', { signal });
    void runCleanups(logger).finally(() => process.exit(code));
  };
  process.once('SIGTERM', () => onSignal('SIGTERM', 143));
  process.once('SIGINT', () => onSignal('SIGINT', 130));

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { error: errMessage(err) });
    void runCleanups(logger).finally(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection — shutting down', { error: errMessage(reason) });
    void runCleanups(logger).finally(() => process.exit(1));
  });
}
