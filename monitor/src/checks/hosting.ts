/**
 * Hosting / ASN / geo lookup.
 *
 * Resolves the server IP to an ISP/organisation/ASN using ip-api.com's free
 * endpoint (45 req/min unauthenticated). Results are cached 7 days in per-domain
 * state by the caller. The batch helper lets the aggregate/runner amortize the
 * rate limit across many domains (100 IPs per request).
 */
import { request } from 'undici';
import pino from 'pino';
import type { HostingResult } from '@uptime/shared';
import { opSignal } from './signal.js';

const logger = pino({ name: 'hosting' });

/** Fields we request from ip-api (numeric bitmask keeps the response small). */
const FIELDS = 'status,message,isp,org,as,country,query';

/** ip-api single/batch response entry. */
interface IpApiEntry {
  status?: string;
  message?: string;
  isp?: string;
  org?: string;
  as?: string;
  country?: string;
  query?: string;
}

/** Parse an ip-api entry into a HostingResult. */
function toResult(entry: IpApiEntry): HostingResult {
  if (entry.status !== 'success') {
    return {
      ok: false,
      isp: '',
      org: '',
      asn: '',
      country: '',
      error: entry.message ?? 'lookup failed',
    };
  }
  return {
    ok: true,
    isp: entry.isp ?? '',
    org: entry.org ?? '',
    asn: entry.as ?? '',
    country: entry.country ?? '',
  };
}

/**
 * Look up hosting details for a single IP address.
 *
 * @param ip IPv4/IPv6 address (from the DNS stage).
 * @param timeoutMs Request timeout.
 */
export async function checkHosting(
  ip: string,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<HostingResult> {
  if (!ip) return { ok: false, isp: '', org: '', asn: '', country: '', error: 'No IP' };
  try {
    const key = process.env.IP_API_KEY;
    const baseUrl = key ? 'https://pro.ip-api.com' : 'http://ip-api.com';
    const auth = key ? `&key=${key}` : '';
    if (!key) logger.warn('Using unencrypted ip-api.com fallback because IP_API_KEY is not set');
    
    const res = await request(`${baseUrl}/json/${encodeURIComponent(ip)}?fields=${FIELDS}${auth}`, {
      method: 'GET',
      headers: { 'user-agent': 'UptimeMonitor/1.0' },
      signal: opSignal(timeoutMs, signal),
    });
    if (res.statusCode >= 400) {
      await res.body.dump().catch(() => undefined);
      return { ok: false, isp: '', org: '', asn: '', country: '', error: `HTTP ${res.statusCode}` };
    }
    const data = (await res.body.json()) as IpApiEntry;
    return toResult(data);
  } catch (err) {
    return {
      ok: false,
      isp: '',
      org: '',
      asn: '',
      country: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Batch hosting lookup for many IPs in one request (max 100 per ip-api rules).
 * Returns a map keyed by the input IP. Falls back to an empty map on failure.
 */
export async function checkHostingBatch(
  ips: string[],
  timeoutMs = 15_000,
): Promise<Map<string, HostingResult>> {
  const out = new Map<string, HostingResult>();
  const unique = [...new Set(ips.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    try {
      const key = process.env.IP_API_KEY;
      const baseUrl = key ? 'https://pro.ip-api.com' : 'http://ip-api.com';
      const auth = key ? `&key=${key}` : '';

      const res = await request(`${baseUrl}/batch?fields=${FIELDS}${auth}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'UptimeMonitor/1.0' },
        body: JSON.stringify(batch.map((q) => ({ query: q }))),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.statusCode >= 400) {
        await res.body.dump().catch(() => undefined);
        continue;
      }
      const data = (await res.body.json()) as IpApiEntry[];
      for (const entry of data) {
        if (entry.query) out.set(entry.query, toResult(entry));
      }
    } catch {
      // Leave this batch unresolved; caller treats missing as unknown.
    }
  }
  return out;
}
