/**
 * Per-domain pipeline runner.
 *
 * Orchestrates all check stages for one domain within a time budget, derives
 * the overall availability status, applies the per-domain circuit breaker
 * (reusing cached RDAP/hosting from state), and computes health + risk scores.
 *
 * Network stages run against a 10s per-op timeout; the whole domain is bounded
 * by the configured budget via an outer AbortSignal check between stages.
 */
import {
  computeHealthScore,
  computeRiskScore,
  type CheckResult,
  type DomainStatus,
  type DomainState,
  type HostingResult,
  type RdapResult,
} from '@uptime/shared';
import type { MonitorConfig } from '../config.js';
import type { Logger } from '../logging.js';
import { errMessage } from '../logging.js';
import { checkDns } from '../checks/dns.js';
import { checkHttp } from '../checks/http.js';
import { checkSsl } from '../checks/ssl.js';
import { checkRdap } from '../checks/rdap.js';
import { checkHosting } from '../checks/hosting.js';
import { checkContent } from '../checks/content.js';
import { checkCrawlFiles } from '../checks/crawlFiles.js';
import { checkSecurityHeaders } from '../checks/security.js';
import { checkTech } from '../checks/tech.js';
import { isCircuitOpen } from './circuitBreaker.js';
import type { ScreenshotEngine } from '../screenshot/engine.js';

/** Cache validity for RDAP/hosting lookups: 7 days. */
const LOOKUP_TTL_MS = 7 * 86_400_000;

/** Input describing one domain to check. */
export interface CheckInput {
  domain: string;
  website: string;
}

/** Empty stage results used when a stage is skipped. */
const EMPTY_RDAP: RdapResult = { ok: false, expiryDate: '', registrar: '', error: 'skipped' };
const EMPTY_HOSTING: HostingResult = {
  ok: false,
  isp: '',
  org: '',
  asn: '',
  country: '',
  error: 'skipped',
};

/**
 * Run the full check pipeline for one domain.
 *
 * @param input Domain + website.
 * @param config Engine config (timeouts, pools).
 * @param state Prior persisted state for this domain (breaker + lookup cache).
 * @param logger Scoped logger.
 * @param screenshotEngine Optional; when omitted screenshots are skipped.
 */
export async function runDomain(
  input: CheckInput,
  config: MonitorConfig,
  state: DomainState | undefined,
  logger: Logger,
  screenshotEngine?: ScreenshotEngine,
): Promise<CheckResult> {
  const startedAt = performance.now();
  const deadline = startedAt + config.domainBudgetMs;
  const timeout = config.opTimeoutMs;
  const overBudget = (): boolean => performance.now() > deadline;

  const circuitOpen = isCircuitOpen(state?.consecutiveFailures ?? 0);

  // --- DNS -----------------------------------------------------------------
  const dns = await checkDns(input.domain, timeout);
  const serverIp = dns.a[0] ?? dns.aaaa[0] ?? '';

  // Short-circuit: no DNS => nothing else is reachable.
  if (!dns.ok) {
    return finalize(input, 'DNS_FAILURE', startedAt, circuitOpen, state, logger, {
      dns,
      http: emptyHttp(),
      ssl: emptySsl(),
      rdap: EMPTY_RDAP,
      hosting: EMPTY_HOSTING,
      content: emptyContent(),
      crawlFiles: { robotsTxt: false, sitemapXml: false },
      securityHeaders: emptySecurity(),
      tech: emptyTech(),
      screenshot: emptyShot(),
      errorMessage: dns.error ?? 'DNS resolution failed',
    });
  }

  // --- HTTP ----------------------------------------------------------------
  const http = await checkHttp(input.website, timeout);

  // --- SSL (only meaningful when https was reachable) ----------------------
  const ssl =
    http.https || input.website.startsWith('https://')
      ? await checkSsl(input.domain, timeout)
      : emptySsl();

  // --- Content / tech / security from the already-fetched body -------------
  const cookiesJoined = ''; // Set-Cookie names are not retained in body; header-based rules still apply.
  const content = http.ok ? checkContent(http.body, http.finalUrl || input.website) : emptyContent();
  const securityHeaders = checkSecurityHeaders(http.headers);
  const tech = checkTech(http, cookiesJoined);

  // --- Expensive stages: skipped when circuit is open or over budget -------
  let rdap: RdapResult = EMPTY_RDAP;
  let hosting: HostingResult = EMPTY_HOSTING;
  let crawlFiles = { robotsTxt: false, sitemapXml: false };

  const skipDeep = circuitOpen || overBudget();

  if (!skipDeep) {
    // RDAP with 7-day cache from state.
    rdap = cachedRdap(state) ?? (await safeRdap(input.domain, timeout, logger));
    // Hosting with 7-day cache from state.
    hosting =
      cachedHosting(state) ?? (serverIp ? await checkHosting(serverIp, timeout) : EMPTY_HOSTING);
    if (http.ok && !overBudget()) {
      crawlFiles = await checkCrawlFiles(http.finalUrl || input.website, timeout);
    }
  } else {
    // Still reuse cached lookups even when the breaker is open — they're free.
    rdap = cachedRdap(state) ?? EMPTY_RDAP;
    hosting = cachedHosting(state) ?? EMPTY_HOSTING;
    logger.debug('Circuit open — skipping deep checks', {
      domain: input.domain,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
    });
  }

  // --- Determine status ----------------------------------------------------
  const status = deriveStatus(http, ssl, dns);

  // --- Screenshot (only for reachable sites, not over budget, engine present)
  let screenshot = emptyShot();
  if (screenshotEngine && http.ok && !skipDeep && !overBudget()) {
    screenshot = await screenshotEngine.capture(input.domain, http.finalUrl || input.website);
  }

  return finalize(input, status, startedAt, circuitOpen, state, logger, {
    dns,
    http,
    ssl,
    rdap,
    hosting,
    content,
    crawlFiles,
    securityHeaders,
    tech,
    screenshot,
    errorMessage: http.error ?? ssl.error ?? '',
  });
}

/** Assemble the CheckResult, compute scores, and log a one-line summary. */
function finalize(
  input: CheckInput,
  status: DomainStatus,
  startedAt: number,
  circuitOpen: boolean,
  state: DomainState | undefined,
  logger: Logger,
  parts: Omit<
    CheckResult,
    | 'domain'
    | 'website'
    | 'checkedAt'
    | 'status'
    | 'healthScore'
    | 'riskScore'
    | 'durationMs'
    | 'circuitOpen'
  >,
): CheckResult {
  const partial: CheckResult = {
    domain: input.domain,
    website: input.website,
    checkedAt: new Date().toISOString(),
    status,
    ...parts,
    healthScore: 0,
    riskScore: 0,
    durationMs: 0,
    circuitOpen,
  };

  partial.healthScore = computeHealthScore(partial).score;
  partial.riskScore = computeRiskScore(partial, state).score;
  partial.durationMs = Math.round(performance.now() - startedAt);

  logger.info('Checked domain', {
    domain: input.domain,
    status,
    httpStatus: partial.http.status,
    responseMs: partial.http.totalMs,
    health: partial.healthScore,
    risk: partial.riskScore,
    durationMs: partial.durationMs,
  });

  return partial;
}

/**
 * Derive the overall availability status from stage results.
 * Priority order matters: DNS < connection < SSL < HTTP-code < redirect.
 */
function deriveStatus(
  http: import('@uptime/shared').HttpResult,
  ssl: import('@uptime/shared').SslResult,
  dns: import('@uptime/shared').DnsResult,
): DomainStatus {
  if (!dns.ok) return 'DNS_FAILURE';

  // No HTTP response at all.
  if (http.status === 0) {
    if (http.error && /timeout|timed out/i.test(http.error)) return 'TIMEOUT';
    return 'DOWN';
  }

  // TLS present but invalid (expired/untrusted) on an https site.
  if (http.https && ssl.ok && !ssl.valid) return 'SSL_ERROR';

  const code = http.status;
  if (code >= 500) return 'DOWN';
  if (code >= 400) return 'DEGRADED';
  if (code >= 300) return 'REDIRECT';

  // 2xx — healthy, but flag slowness as degraded via score, not status.
  return 'UP';
}

// --- state-cache helpers ---------------------------------------------------

/** Return cached RDAP result if fresh, else undefined. */
function cachedRdap(state: DomainState | undefined): RdapResult | undefined {
  if (!state?.rdapExpiry && !state?.rdapFetchedAt) return undefined;
  if (!state.rdapFetchedAt) return undefined;
  if (Date.now() - Date.parse(state.rdapFetchedAt) > LOOKUP_TTL_MS) return undefined;
  return {
    ok: true,
    expiryDate: state.rdapExpiry ?? '',
    registrar: state.rdapRegistrar ?? '',
  };
}

/** Return cached hosting result if fresh, else undefined. */
function cachedHosting(state: DomainState | undefined): HostingResult | undefined {
  if (!state?.hosting || !state.hostingFetchedAt) return undefined;
  if (Date.now() - Date.parse(state.hostingFetchedAt) > LOOKUP_TTL_MS) return undefined;
  return state.hosting;
}

/** RDAP that never throws. */
async function safeRdap(domain: string, timeout: number, logger: Logger): Promise<RdapResult> {
  try {
    return await checkRdap(domain, timeout);
  } catch (err) {
    logger.debug('RDAP lookup failed', { domain, error: errMessage(err) });
    return EMPTY_RDAP;
  }
}

// --- empty stage results ---------------------------------------------------

function emptyHttp(): import('@uptime/shared').HttpResult {
  return {
    ok: false,
    status: 0,
    https: false,
    finalUrl: '',
    redirectChain: [],
    redirectCount: 0,
    ttfbMs: 0,
    totalMs: 0,
    downloadMs: 0,
    contentSizeBytes: 0,
    compression: '',
    cacheHeaders: '',
    cookieCount: 0,
    headers: {},
    body: '',
    server: '',
    poweredBy: '',
  };
}

function emptySsl(): import('@uptime/shared').SslResult {
  return {
    ok: false,
    validTo: '',
    validFrom: '',
    daysRemaining: 0,
    issuer: '',
    tlsVersion: '',
    valid: false,
    subjectAltNames: '',
  };
}

function emptyContent(): import('@uptime/shared').ContentResult {
  return { metaTitle: '', metaDescription: '', canonicalUrl: '', faviconUrl: '', faviconPresent: false };
}

function emptySecurity(): import('@uptime/shared').SecurityHeadersResult {
  return {
    csp: false,
    hsts: false,
    xFrameOptions: false,
    xContentTypeOptions: false,
    referrerPolicy: false,
    permissionsPolicy: false,
    grade: '0/6 (missing: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)',
    presentCount: 0,
  };
}

function emptyTech(): import('@uptime/shared').TechResult {
  return { wordpress: false, cms: '', framework: '', cdn: '', cloudflare: false, stack: [] };
}

function emptyShot(): import('@uptime/shared').ScreenshotResult {
  return { ok: false, desktopPath: '', mobilePath: '', thumbPath: '' };
}
