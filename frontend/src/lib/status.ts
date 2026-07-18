import type { DomainStatus } from '@uptime/shared';

/** Visual treatment for a domain status pill. */
export interface StatusVisual {
  label: string;
  /** Tailwind classes for background/text/border of the badge. */
  className: string;
  /** Semantic bucket used for dot colors and grouping. */
  tone: 'up' | 'down' | 'warn' | 'muted';
}

const STATUS_MAP: Record<string, StatusVisual> = {
  UP: { label: 'Up', tone: 'up', className: 'bg-success/15 text-success border-success/30' },
  DOWN: { label: 'Down', tone: 'down', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  DEGRADED: { label: 'Degraded', tone: 'warn', className: 'bg-warning/15 text-warning border-warning/30' },
  REDIRECT: { label: 'Redirect', tone: 'warn', className: 'bg-warning/15 text-warning border-warning/30' },
  SSL_ERROR: { label: 'SSL Error', tone: 'down', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  DNS_FAILURE: { label: 'DNS Fail', tone: 'down', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  TIMEOUT: { label: 'Timeout', tone: 'down', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  ERROR: { label: 'Error', tone: 'down', className: 'bg-destructive/15 text-destructive border-destructive/30' },
  PAUSED: { label: 'Paused', tone: 'muted', className: 'bg-muted text-muted-foreground border-border' },
  PENDING: { label: 'Pending', tone: 'muted', className: 'bg-muted text-muted-foreground border-border' },
};

const FALLBACK: StatusVisual = {
  label: 'Unknown',
  tone: 'muted',
  className: 'bg-muted text-muted-foreground border-border',
};

/** Resolve the visual treatment for any status string. */
export function statusVisual(status: DomainStatus | string): StatusVisual {
  return STATUS_MAP[status] ?? FALLBACK;
}

/** Dot color class for a semantic tone. */
export function toneDot(tone: StatusVisual['tone']): string {
  switch (tone) {
    case 'up':
      return 'bg-success';
    case 'down':
      return 'bg-destructive';
    case 'warn':
      return 'bg-warning';
    default:
      return 'bg-muted-foreground';
  }
}

/** Color class for a health score 0-100 (higher is better). */
export function healthColor(score: number): string {
  if (score >= 76) return 'text-success';
  if (score >= 51) return 'text-warning';
  if (score >= 1) return 'text-destructive';
  return 'text-muted-foreground';
}

/** Color class for a risk score 0-100 (higher is worse). */
export function riskColor(score: number): string {
  if (score >= 60) return 'text-destructive';
  if (score >= 30) return 'text-warning';
  return 'text-success';
}

/** Color for SSL days remaining. */
export function sslColor(days: number | null): string {
  if (days === null || Number.isNaN(days)) return 'text-muted-foreground';
  if (days < 0) return 'text-destructive';
  if (days <= 7) return 'text-destructive';
  if (days <= 30) return 'text-warning';
  return 'text-foreground';
}
