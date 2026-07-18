/**
 * Health score computation — 0 (critical) to 100 (perfect).
 *
 * Deterministic, documented in docs/scoring.md. Start at 100 and subtract
 * penalties; clamp to [0, 100].
 */
import type { CheckResult } from '../types/check.js';

/** Individual penalty applied to the health score. */
export interface HealthPenalty {
  reason: string;
  points: number;
}

/** Breakdown returned alongside the score for explainability. */
export interface HealthScoreResult {
  score: number;
  penalties: HealthPenalty[];
}

const SLOW_MS = 3000;
const WARN_MS = 1500;

/**
 * Compute the health score for a completed check.
 */
export function computeHealthScore(result: CheckResult): HealthScoreResult {
  const penalties: HealthPenalty[] = [];
  const add = (reason: string, points: number): void => {
    penalties.push({ reason, points });
  };

  // Availability
  if (result.status === 'DNS_FAILURE') {
    add('DNS resolution failed', 60);
  } else if (result.status === 'DOWN' || result.status === 'TIMEOUT') {
    add('Site is down', 60);
  } else {
    const code = result.http.status;
    if (code >= 500) add(`HTTP ${code} server error`, 40);
    else if (code >= 400) add(`HTTP ${code} client error`, 25);
  }

  // SSL
  if (result.ssl.ok) {
    if (result.ssl.daysRemaining < 0) add('SSL certificate expired', 30);
    else if (result.ssl.daysRemaining < 7) add('SSL expires within 7 days', 20);
    else if (result.ssl.daysRemaining < 30) add('SSL expires within 30 days', 10);
  } else if (result.http.ok && !result.http.https) {
    // no ssl result because site is http-only
  }
  if (result.http.ok && !result.http.https) add('No HTTPS', 15);

  // Performance
  if (result.http.ok) {
    if (result.http.totalMs > SLOW_MS) add(`Response time > ${SLOW_MS}ms`, 10);
    else if (result.http.totalMs > WARN_MS) add(`Response time > ${WARN_MS}ms`, 5);
  }

  // Security headers: −2 per missing, capped at −12
  const missing = 6 - result.securityHeaders.presentCount;
  if (missing > 0 && result.http.ok) {
    add(`${missing} security header(s) missing`, Math.min(missing * 2, 12));
  }

  // Redirect hygiene
  if (result.http.redirectCount > 3) add('Redirect chain longer than 3', 5);

  // Domain registration
  const domainExpiryDays = daysUntil(result.rdap.expiryDate);
  if (domainExpiryDays !== null && domainExpiryDays < 30) {
    add('Domain registration expires within 30 days', 10);
  }

  // Hygiene: favicon / robots / sitemap
  if (result.http.ok) {
    if (!result.content.faviconPresent) add('Favicon missing', 1);
    if (!result.crawlFiles.robotsTxt) add('robots.txt missing', 1);
    if (!result.crawlFiles.sitemapXml) add('sitemap.xml missing', 1);
  }

  const total = penalties.reduce((sum, p) => sum + p.points, 0);
  return { score: clamp(100 - total), penalties };
}

/** Days from now until an ISO date; null when the date is absent/invalid. */
export function daysUntil(isoDate: string): number | null {
  if (!isoDate) return null;
  const target = Date.parse(isoDate);
  if (Number.isNaN(target)) return null;
  return Math.floor((target - Date.now()) / 86_400_000);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
