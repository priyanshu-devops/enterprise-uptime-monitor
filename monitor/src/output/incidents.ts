/**
 * Incident detection & lifecycle.
 *
 * Compares each domain's new status against its prior status (from state) to
 * open incidents (DOWN, DNS_FAILURE, DEGRADED, SSL_EXPIRING/EXPIRED) and to
 * resolve them on recovery — stamping durationSeconds so MTTR can be computed.
 *
 * The IncidentLog sheet is the canonical ledger: the aggregate step passes in
 * the currently-open incidents so we never open a duplicate for a condition
 * that is already tracked (e.g. SSL_EXPIRING re-detected on every run).
 */
import type { CheckResult, DomainState, Incident } from '@uptime/shared';

/** Statuses that represent an outage/problem. */
const PROBLEM_STATUSES = new Set(['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'SSL_ERROR', 'DEGRADED']);

/** Availability incident types (as opposed to SSL expiry ones). */
const AVAILABILITY_TYPES = new Set(['DOWN', 'DNS_FAILURE', 'DEGRADED']);

/** Deterministic-ish incident id from domain + timestamp + type. */
function incidentId(domain: string, type: string, at: string): string {
  return `${domain}:${type}:${at}`.replace(/[^A-Za-z0-9:.-]/g, '_');
}

/** Seconds between two ISO timestamps (>= 0; 0 when unparsable). */
function secondsBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 1000));
}

/** Result of the lifecycle pass for one domain. */
export interface IncidentDelta {
  /** Newly opened incidents (append to the ledger). */
  opened: Incident[];
  /** Previously-open incidents now resolved (update in the ledger). */
  resolved: Incident[];
}

/**
 * Detect incident transitions for one domain.
 *
 * @param result The completed check.
 * @param prior Prior state (last status + recent window), if any.
 * @param openForDomain Currently-open ledger incidents for this domain.
 * @param sslWarnDays Threshold below which an SSL_EXPIRING incident opens.
 */
export function detectIncidents(
  result: CheckResult,
  prior: DomainState | undefined,
  openForDomain: Incident[] = [],
  sslWarnDays = 30,
): IncidentDelta {
  const opened: Incident[] = [];
  const resolved: Incident[] = [];
  const now = result.checkedAt;
  const prevStatus = prior?.lastStatus ?? '';
  const curStatus = result.status;

  const isProblem = PROBLEM_STATUSES.has(curStatus);
  const openAvailability = openForDomain.filter((i) => AVAILABILITY_TYPES.has(i.type));

  // Availability: open on transition into a problem — unless one is already open.
  if (isProblem && openAvailability.length === 0 && !PROBLEM_STATUSES.has(prevStatus)) {
    opened.push(
      newIncident(result.domain, incidentType(curStatus), now, prevStatus || 'UNKNOWN', curStatus, buildMessage(result)),
    );
  }

  // Recovery: resolve every open availability incident, stamping its duration.
  if (!isProblem) {
    for (const inc of openAvailability) {
      resolved.push({
        ...inc,
        status: 'resolved',
        resolvedAt: now,
        toStatus: curStatus,
        durationSeconds: secondsBetween(inc.openedAt, now),
        message: `${inc.message} — recovered (now ${curStatus})`,
      });
    }
  }

  // SSL expiry (independent of availability). One open incident per condition.
  const openSslExpiring = openForDomain.filter((i) => i.type === 'SSL_EXPIRING');
  const openSslExpired = openForDomain.filter((i) => i.type === 'SSL_EXPIRED');
  if (result.ssl.ok) {
    if (result.ssl.daysRemaining < 0) {
      // Expired: escalate — resolve any EXPIRING, open EXPIRED once.
      for (const inc of openSslExpiring) {
        resolved.push({
          ...inc,
          status: 'resolved',
          resolvedAt: now,
          durationSeconds: secondsBetween(inc.openedAt, now),
          message: `${inc.message} — escalated to expired`,
        });
      }
      if (openSslExpired.length === 0) {
        opened.push(
          newIncident(
            result.domain, 'SSL_EXPIRED', now, prevStatus, curStatus,
            `SSL certificate expired ${Math.abs(result.ssl.daysRemaining)} day(s) ago`,
          ),
        );
      }
    } else if (result.ssl.daysRemaining < sslWarnDays) {
      if (openSslExpiring.length === 0 && openSslExpired.length === 0) {
        opened.push(
          newIncident(
            result.domain, 'SSL_EXPIRING', now, prevStatus, curStatus,
            `SSL certificate expires in ${result.ssl.daysRemaining} day(s)`,
          ),
        );
      }
    } else {
      // Cert renewed: resolve any open SSL incidents.
      for (const inc of [...openSslExpiring, ...openSslExpired]) {
        resolved.push({
          ...inc,
          status: 'resolved',
          resolvedAt: now,
          durationSeconds: secondsBetween(inc.openedAt, now),
          message: `${inc.message} — certificate renewed (${result.ssl.daysRemaining}d remaining)`,
        });
      }
    }
  }

  return { opened, resolved };
}

/** Construct a fresh open incident. */
function newIncident(
  domain: string,
  type: Incident['type'],
  at: string,
  fromStatus: string,
  toStatus: string,
  message: string,
): Incident {
  return {
    id: incidentId(domain, type, at),
    domain,
    type,
    status: 'open',
    openedAt: at,
    resolvedAt: null,
    fromStatus,
    toStatus,
    message,
    durationSeconds: null,
    ackedAt: null,
    ackedBy: '',
  };
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
