/**
 * Core domain record — one row in the `Domains` sheet tab.
 *
 * Field order here is documentation only; the authoritative column order
 * (field ↔ sheet column A..AT) lives in `sheets/columns.ts`.
 */

/** Overall availability status of a monitored domain. */
export type DomainStatus =
  | 'UP'
  | 'DOWN'
  | 'DEGRADED'
  | 'REDIRECT'
  | 'SSL_ERROR'
  | 'DNS_FAILURE'
  | 'TIMEOUT'
  | 'PAUSED'
  | 'PENDING'
  | 'ERROR';

/** Monitoring lifecycle state, controlled from the dashboard. */
export type MonitoringState = 'active' | 'paused' | 'archived';

/** Environment classification for grouping. */
export type Environment = 'production' | 'staging' | 'development';

/** Priority classification for grouping/sorting. */
export type Priority = 'critical' | 'high' | 'medium' | 'low';

/**
 * One monitored domain — mirrors the 46 columns of the `Domains` sheet tab.
 * All values are stored as strings in the sheet; this is the typed view.
 */
export interface DomainRecord {
  /** A — Company that owns the site. */
  company: string;
  /** B — Project the site belongs to. */
  project: string;
  /** C — Owner (person/team responsible). */
  owner: string;
  /** D — Department. */
  department: string;
  /** E — Full website URL as entered (https://example.com/path). */
  website: string;
  /** F — Normalized domain (primary key: lowercase, no scheme, no path). */
  domain: string;
  /** G — Availability status (UP/DOWN/...). */
  status: DomainStatus | string;
  /** H — Last HTTP status code observed (e.g. "200"). */
  httpStatus: string;
  /** I — Whether HTTPS is served ("Yes"/"No"). */
  https: string;
  /** J — Final URL after redirects, if any. */
  redirectUrl: string;
  /** K — Total response time in ms. */
  responseTime: string;
  /** L — Time to first byte in ms. */
  ttfb: string;
  /** M — SSL certificate expiry date (YYYY-MM-DD). */
  sslExpiry: string;
  /** N — Days until SSL expiry (negative = expired). */
  sslDaysRemaining: string;
  /** O — Certificate issuer organisation. */
  sslIssuer: string;
  /** P — Negotiated TLS version (e.g. "TLSv1.3"). */
  tlsVersion: string;
  /** Q — Domain registration expiry date (YYYY-MM-DD). */
  domainExpiry: string;
  /** R — Resolved server IPv4/IPv6. */
  serverIp: string;
  /** S — DNS summary (record presence, e.g. "A,AAAA,MX,TXT"). */
  dns: string;
  /** T — Nameservers (comma-separated). */
  nameservers: string;
  /** U — Hosting provider / ISP from ASN lookup. */
  hostingProvider: string;
  /** V — Detected CDN (Cloudflare/Fastly/CloudFront/Akamai/...). */
  cdn: string;
  /** W — Behind Cloudflare ("Yes"/"No"). */
  cloudflare: string;
  /** X — WordPress detected ("Yes"/"No"). */
  wordpress: string;
  /** Y — Detected CMS name. */
  cms: string;
  /** Z — Detected technology stack (comma-separated). */
  technologyStack: string;
  /** AA — Detected frontend framework. */
  framework: string;
  /** AB — Page <title>. */
  metaTitle: string;
  /** AC — Meta description. */
  metaDescription: string;
  /** AD — robots.txt present ("Yes"/"No"). */
  robotsTxt: string;
  /** AE — sitemap.xml present ("Yes"/"No"). */
  sitemapXml: string;
  /** AF — Security headers grade (e.g. "4/6 (missing: CSP, HSTS)"). */
  securityHeaders: string;
  /** AG — Page size in KB. */
  pageSize: string;
  /** AH — Favicon present ("Yes"/"No"). */
  favicon: string;
  /** AI — Full-size screenshot URL (GitHub Pages). */
  screenshotUrl: string;
  /** AJ — Thumbnail URL (GitHub Pages). */
  thumbnailUrl: string;
  /** AK — =IMAGE(...) formula rendering the thumbnail in the sheet. */
  imageFormula: string;
  /** AL — Last checked date (YYYY-MM-DD, IST). */
  lastCheckedDate: string;
  /** AM — Last checked time (HH:mm:ss, IST). */
  lastCheckedTime: string;
  /** AN — Health score 0-100 (higher = healthier). */
  healthScore: string;
  /** AO — Risk score 0-100 (higher = riskier). */
  riskScore: string;
  /** AP — Last error message, if any. */
  errorMessage: string;
  /** AQ — Machine-readable monitoring result summary. */
  monitoringResult: string;
  /** AR — Free-form notes (user-managed, never overwritten by monitor). */
  notes: string;
  /** AS — Tags (comma-separated, user-managed). */
  tags: string;
  /** AT — Category (user-managed). */
  category: string;
}

/** Fields the monitoring engine owns (overwritten every cycle). */
export const MONITOR_OWNED_FIELDS = [
  'status',
  'httpStatus',
  'https',
  'redirectUrl',
  'responseTime',
  'ttfb',
  'sslExpiry',
  'sslDaysRemaining',
  'sslIssuer',
  'tlsVersion',
  'domainExpiry',
  'serverIp',
  'dns',
  'nameservers',
  'hostingProvider',
  'cdn',
  'cloudflare',
  'wordpress',
  'cms',
  'technologyStack',
  'framework',
  'metaTitle',
  'metaDescription',
  'robotsTxt',
  'sitemapXml',
  'securityHeaders',
  'pageSize',
  'favicon',
  'screenshotUrl',
  'thumbnailUrl',
  'imageFormula',
  'lastCheckedDate',
  'lastCheckedTime',
  'healthScore',
  'riskScore',
  'errorMessage',
  'monitoringResult',
] as const satisfies readonly (keyof DomainRecord)[];

/** Fields users may edit from the dashboard (never touched by the monitor). */
export const USER_OWNED_FIELDS = [
  'company',
  'project',
  'owner',
  'department',
  'website',
  'notes',
  'tags',
  'category',
] as const satisfies readonly (keyof DomainRecord)[];
