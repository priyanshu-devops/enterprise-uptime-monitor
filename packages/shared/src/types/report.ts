/**
 * Report and analytics shared types.
 */

/** Supported export formats for reports. */
export type ExportFormat = 'xlsx' | 'csv' | 'json' | 'pdf' | 'md' | 'html';

/** Report period granularity. */
export type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';

/** KPI snapshot shown on the dashboard and embedded in reports. */
export interface KpiSnapshot {
  totalDomains: number;
  healthy: number;
  down: number;
  degraded: number;
  paused: number;
  sslExpiringSoon: number;
  sslExpired: number;
  redirectIssues: number;
  dnsIssues: number;
  avgResponseTimeMs: number;
  avgTtfbMs: number;
  avgHealthScore: number;
  avgRiskScore: number;
  cloudflareCount: number;
  wordpressCount: number;
  httpsCount: number;
  generatedAt: string;
}

/** Name/value pair for distribution charts (hosting, CMS, CDN, status). */
export interface DistributionEntry {
  name: string;
  value: number;
}

/** Full distributions payload for analytics. */
export interface Distributions {
  status: DistributionEntry[];
  hosting: DistributionEntry[];
  cdn: DistributionEntry[];
  cms: DistributionEntry[];
  framework: DistributionEntry[];
  sslExpiryBuckets: DistributionEntry[];
  healthBuckets: DistributionEntry[];
  category: DistributionEntry[];
}

/** A generated report document. */
export interface Report {
  id: string;
  period: ReportPeriod;
  rangeStart: string;
  rangeEnd: string;
  generatedAt: string;
  kpis: KpiSnapshot;
  distributions: Distributions;
  incidents: ReportIncidentRow[];
  worstPerformers: ReportDomainRow[];
  sslExpiring: ReportDomainRow[];
  recommendations: string[];
}

/** Compact incident row inside a report. */
export interface ReportIncidentRow {
  domain: string;
  type: string;
  openedAt: string;
  resolvedAt: string | null;
  message: string;
}

/** Compact domain row inside a report. */
export interface ReportDomainRow {
  domain: string;
  status: string;
  responseTimeMs: number;
  healthScore: number;
  riskScore: number;
  sslDaysRemaining: number | null;
  note: string;
}
