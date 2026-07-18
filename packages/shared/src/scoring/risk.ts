/**
 * Risk score computation — 0 (no risk) to 100 (severe risk).
 *
 * Unlike health (a snapshot of current state), risk is forward-looking:
 * it weighs expiring certificates/registrations, instability, and missing
 * defensive controls. Documented in docs/scoring.md.
 */
import type { CheckResult, DomainState } from '../types/check.js';
import { daysUntil } from './health.js';

/** Individual contribution to the risk score. */
export interface RiskFactor {
  reason: string;
  points: number;
}

/** Breakdown returned alongside the score. */
export interface RiskScoreResult {
  score: number;
  factors: RiskFactor[];
}

/**
 * Compute the risk score for a completed check.
 *
 * @param result Current check result.
 * @param state Prior state (recent statuses) for flap detection; optional.
 */
export function computeRiskScore(result: CheckResult, state?: DomainState): RiskScoreResult {
  const factors: RiskFactor[] = [];
  const add = (reason: string, points: number): void => {
    factors.push({ reason, points });
  };

  // SSL expiry buckets
  if (result.ssl.ok) {
    if (result.ssl.daysRemaining < 0) add('SSL expired', 30);
    else if (result.ssl.daysRemaining < 7) add('SSL expires < 7 days', 25);
    else if (result.ssl.daysRemaining < 30) add('SSL expires < 30 days', 15);
  }

  // Domain registration expiry buckets (×0.8 weight of SSL)
  const domDays = daysUntil(result.rdap.expiryDate);
  if (domDays !== null) {
    if (domDays < 0) add('Domain registration expired', 24);
    else if (domDays < 7) add('Domain expires < 7 days', 20);
    else if (domDays < 30) add('Domain expires < 30 days', 12);
  }

  // Currently down
  if (result.status === 'DOWN' || result.status === 'TIMEOUT' || result.status === 'DNS_FAILURE') {
    add('Currently unavailable', 25);
  }

  // Flapping: 2+ failures in the trailing window
  if (state) {
    const failures = state.recentStatuses.filter((s) =>
      ['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'ERROR', 'SSL_ERROR'].includes(s),
    ).length;
    if (failures >= 2) add(`${failures} failures in recent runs`, 10);
  }

  // No HTTPS
  if (result.http.ok && !result.http.https) add('No HTTPS', 10);

  // Missing key defensive headers
  if (result.http.ok && !result.securityHeaders.hsts && !result.securityHeaders.csp) {
    add('Missing both HSTS and CSP', 5);
  }

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  return { score: Math.max(0, Math.min(100, Math.round(total))), factors };
}
