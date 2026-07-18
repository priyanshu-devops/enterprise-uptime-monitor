/**
 * Domain/URL normalization — the primary-key discipline for the whole platform.
 *
 * The normalized domain (lowercase hostname, no scheme/path/port, punycode
 * preserved as-is) is the row key in the Domains sheet.
 */

/** Result of normalizing one user-supplied website string. */
export interface NormalizedDomain {
  /** Normalized hostname, e.g. "www.example.com" -> "example.com" is NOT applied; subdomains kept. */
  domain: string;
  /** Canonical website URL (https://<domain>) unless an explicit path was meaningful. */
  website: string;
  /** True when the input required correction (scheme added, spaces stripped...). */
  corrected: boolean;
  /** True when the input could not be parsed into a valid domain. */
  invalid: boolean;
  reason: string;
}

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalize a raw website/domain input.
 *
 * Handles: surrounding whitespace, missing scheme, http->https upgrade,
 * trailing slashes/paths, ports, credentials, mixed case, stray commas.
 */
export function normalizeDomain(input: string): NormalizedDomain {
  const raw = input ?? '';
  let s = raw.trim();
  let corrected = false;

  if (!s) return { domain: '', website: '', corrected: false, invalid: true, reason: 'Empty input' };

  // Strip stray characters commonly present in pasted lists
  const cleaned = s.replace(/[\s,;"']+/g, '');
  if (cleaned !== s) {
    s = cleaned;
    corrected = true;
  }

  // Ensure a scheme so URL() can parse; upgrade http to https
  if (/^http:\/\//i.test(s)) {
    s = s.replace(/^http:\/\//i, 'https://');
    corrected = true;
  } else if (!/^https:\/\//i.test(s)) {
    if (/^[a-z]+:\/\//i.test(s)) {
      return { domain: '', website: '', corrected, invalid: true, reason: 'Unsupported scheme' };
    }
    s = `https://${s}`;
    corrected = true;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return { domain: '', website: '', corrected, invalid: true, reason: 'Unparseable URL' };
  }

  let host = url.hostname.toLowerCase();
  if (host.startsWith('www.') && host.split('.').length > 2) {
    // keep www variant available via website; the domain key drops www
    host = host.slice(4);
    corrected = true;
  }
  if (host !== url.hostname) corrected = true;

  // Validate the hostname shape (allow punycode xn--)
  if (!DOMAIN_RE.test(host)) {
    return { domain: '', website: '', corrected, invalid: true, reason: `Invalid domain: ${host}` };
  }

  // Reject obvious non-domains
  if (host.endsWith('.local') || host.endsWith('.localhost') || host === 'localhost') {
    return { domain: '', website: '', corrected, invalid: true, reason: 'Local hostname' };
  }

  const website = `https://${host}`;
  return { domain: host, website, corrected, invalid: false, reason: '' };
}

/**
 * Deduplicate a list of normalized domains, preserving first occurrence order.
 */
export function dedupeDomains<T extends { domain: string }>(rows: T[]): { unique: T[]; duplicates: T[] } {
  const seen = new Set<string>();
  const unique: T[] = [];
  const duplicates: T[] = [];
  for (const row of rows) {
    if (!row.domain) {
      unique.push(row);
      continue;
    }
    if (seen.has(row.domain)) duplicates.push(row);
    else {
      seen.add(row.domain);
      unique.push(row);
    }
  }
  return { unique, duplicates };
}
