/**
 * Incident detection.
 *
 * Compares each domain's new status against its prior status (from state) to
 * open/resolve incidents: DOWN, DNS_FAILURE, DEGRADED, SSL_EXPIRING/EXPIRED,
 * and RECOVERED. Incidents are appended to the IncidentLog tab and written to
 * cache/incidents.json for the dashboard's fallback path.
 */
import type { CheckResult, DomainState, Incident } from '@uptime/shared';

/** Statuses that represent an outage/problem. */
const PROBLEM_STATUSES = new Set(['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'SSL_ERROR', 'DEGRADED']);

/** Deterministic-ish incident id from domain + timestamp + type. */
function incidentId(domain: string, type: string, at: string): string {
  return `${domain}:${type}:${at}`.replace(/[^A-Za-z0-9:.-]/g, '_');
}

/**
 * Detect incidents for one domain from its result and prior state.
 *
 * @param result The completed check.
 * @param prior Prior state (last status + recent window), if any.
 * @param sslWarnDays Threshold below which an SSL_EXPIRING incident opens.
 * @returns Zero or more incidents (open or resolved).
 */
export function detectIncidents(
  result: CheckResult,
  prior: DomainState | undefined,
  sslWarnDays = 30,
): Incident[] {
  const incidents: Incident[] = [];
  const now = result.checkedAt;
  const prevStatus = prior?.lastStatus ?? '';
  const curStatus = result.status;

  const wasProblem = PROBLEM_STATUSES.has(prevStatus);
  const isProblem = PROBLEM_STATUSES.has(curStatus);

  // Availability transition: healthy/unknown -> problem opens an incident.
  if (isProblem && !wasProblem) {
    incidents.push({
      id: incidentId(result.domain, curStatus, now),
      domain: result.domain,
      type: incidentType(curStatus),
      status: 'open',
      openedAt: now,
      resolvedAt: null,
      fromStatus: prevStatus || 'UNKNOWN',
      toStatus: curStatus,
      message: buildMessage(result),
    });
  }

  // Recovery: problem -> healthy resolves.
  if (!isProblem && wasProblem) {
    incidents.push({
      id: incidentId(result.domain, 'RECOVERED', now),
      domain: result.domain,
      type: 'RECOVERED',
      status: 'resolved',
      openedAt: now,
      resolvedAt: now,
      fromStatus: prevStatus,
      toStatus: curStatus,
      message: `${result.domain} recovered (now ${curStatus})`,
    });
  }

  // SSL expiry incidents (independent of availability).
  if (result.ssl.ok) {
    if (result.ssl.daysRemaining < 0) {
      incidents.push({
        id: incidentId(result.domain, 'SSL_EXPIRED', now),
        domain: result.domain,
        type: 'SSL_EXPIRED',
        status: 'open',
        openedAt: now,
        resolvedAt: null,
        fromStatus: prevStatus,
        toStatus: curStatus,
        message: `SSL certificate expired ${Math.abs(result.ssl.daysRemaining)} day(s) ago`,
      });
    } else if (result.ssl.daysRemaining < sslWarnDays) {
      incidents.push({
        id: incidentId(result.domain, 'SSL_EXPIRING', now),
        domain: result.domain,
        type: 'SSL_EXPIRING',
        status: 'open',
        openedAt: now,
        resolvedAt: null,
        fromStatus: prevStatus,
        toStatus: curStatus,
        message: `SSL certificate expires in ${result.ssl.daysRemaining} day(s)`,
      });
    }
  }

  return incidents;
}

/** Map an availability status to an incident type. */
function incidentType(status: string): Incident['type'] {
  switch (status) {
    case 'DNS_FAILURE':
      return 'DNS_FAILURE';
    case 'DEGRADED':
      return 'DEGRADED';
    default:
      return 'DOWN';
  }
}

/** Human-readable incident message from a result. */
function buildMessage(result: CheckResult): string {
  if (result.status === 'DNS_FAILURE') return `DNS resolution failed for ${result.domain}`;
  if (result.errorMessage) return `${result.status}: ${result.errorMessage}`;
  if (result.http.status >= 400) return `HTTP ${result.http.status} on ${result.domain}`;
  return `${result.domain} is ${result.status}`;
}
