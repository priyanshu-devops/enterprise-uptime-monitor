/**
 * Map a CheckResult (monitor output) onto the monitor-owned fields of a
 * DomainRecord. User-owned fields (company, notes, tags, ...) are never touched
 * here — the caller merges these updates into the existing sheet row.
 */
import {
  bytesToKb,
  istDate,
  istTime,
  toDateOnly,
  type CheckResult,
  type DomainRecord,
} from '@uptime/shared';

/** Yes/No helper. */
function yn(b: boolean): string {
  return b ? 'Yes' : 'No';
}

/** Build the =IMAGE() formula for the sheet thumbnail cell. */
function imageFormula(thumbnailUrl: string): string {
  if (!thumbnailUrl) return '';
  return `=IMAGE("${thumbnailUrl}", 4, 60, 100)`;
}

/**
 * Produce the monitor-owned field updates for a domain from its check result.
 *
 * @param result The completed check.
 * @param pagesBaseUrl Base URL of the storage repo's GitHub Pages (for image URLs).
 */
export function resultToRecordUpdate(
  result: CheckResult,
  pagesBaseUrl: string,
): Partial<DomainRecord> {
  const base = pagesBaseUrl.replace(/\/+$/, '');
  const shotBase = base ? `${base}/screenshots/${result.domain}` : '';
  const screenshotUrl = result.screenshot.ok && shotBase ? `${shotBase}/desktop.jpg` : '';
  const thumbnailUrl = result.screenshot.ok && shotBase ? `${shotBase}/thumb.jpg` : '';

  const sslDays = result.ssl.ok ? String(result.ssl.daysRemaining) : '';

  const monitoringResult = JSON.stringify({
    status: result.status,
    http: result.http.status,
    health: result.healthScore,
    risk: result.riskScore,
    responseMs: result.http.totalMs,
    checkedAt: result.checkedAt,
    circuitOpen: result.circuitOpen,
  });

  return {
    status: result.status,
    httpStatus: result.http.status ? String(result.http.status) : '',
    https: yn(result.http.https),
    redirectUrl: result.http.redirectCount > 0 ? result.http.finalUrl : '',
    responseTime: result.http.totalMs ? String(result.http.totalMs) : '',
    ttfb: result.http.ttfbMs ? String(result.http.ttfbMs) : '',
    sslExpiry: result.ssl.ok ? toDateOnly(result.ssl.validTo) : '',
    sslDaysRemaining: sslDays,
    sslIssuer: result.ssl.issuer,
    tlsVersion: result.ssl.tlsVersion,
    domainExpiry: result.rdap.ok ? toDateOnly(result.rdap.expiryDate) : '',
    serverIp: result.dns.a[0] ?? result.dns.aaaa[0] ?? '',
    dns: result.dns.summary,
    nameservers: result.dns.nameservers.join(', '),
    hostingProvider: result.hosting.isp || result.hosting.org,
    cdn: result.tech.cdn,
    cloudflare: yn(result.tech.cloudflare),
    wordpress: yn(result.tech.wordpress),
    cms: result.tech.cms,
    technologyStack: result.tech.stack.join(', '),
    framework: result.tech.framework,
    metaTitle: result.content.metaTitle,
    metaDescription: result.content.metaDescription,
    robotsTxt: yn(result.crawlFiles.robotsTxt),
    sitemapXml: yn(result.crawlFiles.sitemapXml),
    securityHeaders: result.securityHeaders.grade,
    pageSize: bytesToKb(result.http.contentSizeBytes),
    favicon: yn(result.content.faviconPresent),
    screenshotUrl,
    thumbnailUrl,
    imageFormula: imageFormula(thumbnailUrl),
    lastCheckedDate: istDate(new Date(result.checkedAt)),
    lastCheckedTime: istTime(new Date(result.checkedAt)),
    healthScore: String(result.healthScore),
    riskScore: String(result.riskScore),
    errorMessage: result.errorMessage,
    monitoringResult,
  };
}
