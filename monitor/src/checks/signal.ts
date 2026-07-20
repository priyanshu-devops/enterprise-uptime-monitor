/**
 * Signal composition for check stages (audit C-5).
 *
 * Every network stage bounds itself with a per-operation timeout, but the
 * pipeline also imposes a per-domain time budget. `opSignal` combines both so
 * an in-flight socket is torn down the moment either limit is hit, instead of
 * the stage silently running out its full per-op timeout after the domain
 * budget is already blown.
 */

/**
 * Build the effective signal for one network operation.
 *
 * @param timeoutMs Per-operation timeout.
 * @param external Optional caller-owned signal (e.g. the domain budget).
 */
export function opSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}
