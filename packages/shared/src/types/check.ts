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
}

/** cache/state.json shape. */
export interface StateFile {
  updatedAt: string;
  domains: Record<string, DomainState>;
}
