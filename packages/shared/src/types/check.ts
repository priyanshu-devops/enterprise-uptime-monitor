import type { DomainStatus } from './domain.js';

/** Result of the DNS check stage. */
export interface DnsResult {
  ok: boolean;
  a: string[];
  aaaa: string[];
  mx: string[];
  txt: string[];
  caa: string[];
  nameservers: string[];
  /** Records present, e.g. "A,AAAA,MX,TXT". */
  summary: string;
  /** True when resolution failed due to resolver/network error (not NXDOMAIN). */
  resolverError?: boolean;
  error?: string;
}

/** One hop in a redirect chain. */
export interface RedirectHop {
  url: string;
  status: number;
}

/** Result of the HTTP/HTTPS check stage. */
export interface HttpResult {
  ok: boolean;
  /** Final HTTP status code. */
  status: number;
  /** True when the site was reachable over https://. */
  https: boolean;
  finalUrl: string;
  redirectChain: RedirectHop[];
  redirectCount: number;
  /** Time to first byte, ms. */
  ttfbMs: number;
  /** Total request time, ms. */
  totalMs: number;
  /** Body download time, ms. */
  downloadMs: number;
  /** Raw content length in bytes (capped read). */
  contentSizeBytes: number;
  /** content-encoding header (gzip/br/...). */
  compression: string;
  /** cache-control / age / etag summary. */
  cacheHeaders: string;
  /** Number of Set-Cookie headers on final response. */
  cookieCount: number;
  /** Response headers of the final hop (lowercased keys). */
  headers: Record<string, string>;
  /** First 2MB of the body (HTML), used by content/tech stages. */
  body: string;
  /** server header. */
  server: string;
  /** x-powered-by header. */
  poweredBy: string;
  error?: string;
}

/** Result of the SSL/TLS check stage. */
export interface SslResult {
  ok: boolean;
  /** Expiry date ISO string. */
  validTo: string;
  validFrom: string;
  daysRemaining: number;
  issuer: string;
  /** Negotiated protocol, e.g. TLSv1.3. */
  tlsVersion: string;
  /** Whether the cert is currently valid (dates + chain trust). */
  valid: boolean;
  subjectAltNames: string;
  error?: string;
}

/** Result of the RDAP domain-registration lookup. */
export interface RdapResult {
  ok: boolean;
  /** Registration expiry ISO date, if published. */
  expiryDate: string;
  registrar: string;
  error?: string;
}

/** Result of the hosting/ASN/geo lookup. */
export interface HostingResult {
  ok: boolean;
  isp: string;
  org: string;
  asn: string;
  country: string;
  error?: string;
}

/** Result of parsing page content for SEO fields. */
export interface ContentResult {
  metaTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  faviconUrl: string;
  faviconPresent: boolean;
}

/** robots.txt / sitemap.xml presence. */
export interface CrawlFilesResult {
  robotsTxt: boolean;
  sitemapXml: boolean;
}

/** Security header audit. */
export interface SecurityHeadersResult {
  csp: boolean;
  hsts: boolean;
  xFrameOptions: boolean;
  xContentTypeOptions: boolean;
  referrerPolicy: boolean;
  permissionsPolicy: boolean;
  /** e.g. "4/6 (missing: CSP, HSTS)". */
  grade: string;
  presentCount: number;
}

/** Technology detection result. */
export interface TechResult {
  wordpress: boolean;
  cms: string;
  framework: string;
  cdn: string;
  cloudflare: boolean;
  /** All detected technologies, deduped. */
  stack: string[];
}

/** Screenshot capture result. */
export interface ScreenshotResult {
  ok: boolean;
  desktopPath: string;
  mobilePath: string;
  thumbPath: string;
  error?: string;
}

/**
 * Complete result of one monitoring cycle for one domain.
 * Serialized into shard artifacts and merged by the aggregate step.
 */
export interface CheckResult {
  domain: string;
  website: string;
  checkedAt: string;
  status: DomainStatus;
  dns: DnsResult;
  http: HttpResult;
  ssl: SslResult;
  rdap: RdapResult;
  hosting: HostingResult;
  content: ContentResult;
  crawlFiles: CrawlFilesResult;
  securityHeaders: SecurityHeadersResult;
  tech: TechResult;
  screenshot: ScreenshotResult;
  healthScore: number;
  riskScore: number;
  errorMessage: string;
  /** Duration of the whole pipeline for this domain, ms. */
  durationMs: number;
  /** True when the per-domain circuit breaker short-circuited deep checks. */
  circuitOpen: boolean;
}

/** Incident lifecycle status. */
export type IncidentStatus = 'open' | 'resolved';

/** A status-transition incident (UP -> DOWN etc.). */
export interface Incident {
  id: string;
  domain: string;
  type: 'DOWN' | 'SSL_EXPIRING' | 'SSL_EXPIRED' | 'DNS_FAILURE' | 'DEGRADED' | 'RECOVERED';
  status: IncidentStatus;
  openedAt: string;
  resolvedAt: string | null;
  fromStatus: string;
  toStatus: string;
  message: string;
  /** Seconds from openedAt to resolvedAt; null while open. */
  durationSeconds: number | null;
  /** When an operator acknowledged the incident (dashboard); null if never. */
  ackedAt: string | null;
  /** Who acknowledged (operator email). */
  ackedBy: string;
}

/** Per-run summary written to cache/summary.json. */
export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  totalDomains: number;
  up: number;
  down: number;
  degraded: number;
  errors: number;
  sslExpiringSoon: number;
  sslExpired: number;
  dnsIssues: number;
  redirectIssues: number;
  avgResponseTimeMs: number;
  avgTtfbMs: number;
  avgHealthScore: number;
  cloudflareCount: number;
  wordpressCount: number;
  screenshotsCaptured: number;
  screenshotsFailed: number;
  incidentsOpened: number;
  incidentsResolved: number;
}

/** One point in the availability/performance history series. */
export interface HistoryPoint {
  date: string;
  up: number;
  down: number;
  degraded: number;
  total: number;
  avgResponseTimeMs: number;
  avgTtfbMs: number;
  avgHealthScore: number;
  availabilityPct: number;
}

/** One compact per-run sample kept in DomainState for SLA math: [ISO time, status, responseMs]. */
export type SlaSample = [string, string, number];

/** Per-domain circuit-breaker + lookup-cache state persisted between runs. */
export interface DomainState {
  consecutiveFailures: number;
  lastStatus: string;
  /** RDAP expiry cache. */
  rdapExpiry?: string;
  rdapRegistrar?: string;
  rdapFetchedAt?: string;
  /** Hosting/ASN cache. */
  hosting?: HostingResult;
  hostingFetchedAt?: string;
  /** Recent statuses, newest first, max 14 entries (for flap/risk detection). */
  recentStatuses: string[];
  /** Rolling check samples, newest first, capped (~90 days at 2 runs/day). */
  samples?: SlaSample[];
}

/** cache/state.json shape. */
export interface StateFile {
  updatedAt: string;
  domains: Record<string, DomainState>;
}

// ---------------------------------------------------------------------------
// SLA / uptime windows (cache/sla.json)
// ---------------------------------------------------------------------------

/** Uptime percentages over standard windows; null when no samples in window. */
export interface SlaWindows {
  '24h': number | null;
  '7d': number | null;
  '30d': number | null;
  '90d': number | null;
}

/** Per-domain SLA entry. */
export interface DomainSla {
  domain: string;
  uptime: SlaWindows;
  /** Response-time percentiles over the 30d window (successful checks), ms. */
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  /** Samples counted in the 30d window. */
  sampleCount30d: number;
  /** Current status from the latest run. */
  status: string;
}

/** cache/sla.json shape — fleet rollup + per-domain entries. */
export interface SlaReport {
  generatedAt: string;
  runId: string;
  /** Fleet-wide uptime (mean of per-domain window uptimes). */
  fleet: SlaWindows;
  /** Fleet response percentiles over 30d (all successful samples pooled). */
  fleetP50Ms: number | null;
  fleetP95Ms: number | null;
  fleetP99Ms: number | null;
  /** Mean time to recovery over resolved incidents in the last 30d, seconds. */
  mttrSeconds30d: number | null;
  /** Resolved incidents counted in the MTTR window. */
  incidentsResolved30d: number;
  domains: DomainSla[];
}
