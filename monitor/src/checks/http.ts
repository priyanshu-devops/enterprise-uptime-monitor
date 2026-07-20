/**
 * HTTP/HTTPS check stage.
 *
 * Uses undici for precise control over redirects and timing. Follows redirects
 * manually (capped) so the full chain is recorded, measures TTFB and total
 * time, captures response headers and the first 2 MB of the body (for the
 * content/tech/security stages), and falls back from https:// to http:// when
 * the secure request fails outright.
 */
import { request } from 'undici';
import type { HttpResult, RedirectHop } from '@uptime/shared';
import { opSignal } from './signal.js';

/** Max redirect hops to follow before giving up. */
const MAX_REDIRECTS = 10;
/** Body read cap — 2 MB is plenty for meta tags and tech fingerprints. */
const BODY_CAP_BYTES = 2 * 1024 * 1024;
/** Browser-like UA so sites don't serve bot-blocked variants. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; UptimeMonitor/1.0; +https://github.com/uptime-monitor) Chrome/120 Safari/537.36';

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

/** Build the standard request headers. */
function defaultHeaders(): Record<string, string> {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
  };
}

/** Empty/default result used before a successful hop is recorded. */
function baseResult(): HttpResult {
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

/** Resolve a possibly-relative Location header against the current URL. */
function resolveLocation(location: string, base: string): string {
  try {
    return new URL(location, base).toString();
  } catch {
    return location;
  }
}

/** Summarize caching-related headers into one compact string. */
function summarizeCache(headers: Record<string, string>): string {
  const parts: string[] = [];
  if (headers['cache-control']) parts.push(`cache-control: ${headers['cache-control']}`);
  if (headers['age']) parts.push(`age: ${headers['age']}`);
  if (headers['etag']) parts.push('etag');
  if (headers['expires']) parts.push(`expires: ${headers['expires']}`);
  return parts.join('; ');
}

/** Count Set-Cookie headers regardless of array/string shape. */
function countCookies(raw: string | string[] | undefined): number {
  if (!raw) return 0;
  return Array.isArray(raw) ? raw.length : 1;
}

/** Flatten undici header values (string | string[] | undefined) to strings. */
function flattenHeaders(h: Record<string, string | string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
}

/**
 * Perform an HTTP check for a website, following redirects manually.
 *
 * @param startUrl Fully-qualified URL to begin from (https://... preferred).
 * @param timeoutMs Per-request timeout.
 */
export async function checkHttp(
  startUrl: string,
  timeoutMs = 10_000,
  signal?: AbortSignal,
): Promise<HttpResult> {
  const result = await attempt(startUrl, timeoutMs, signal);
  // Fall back to http:// only when https failed to connect at all — and the
  // caller's budget still has room.
  if (!result.ok && startUrl.startsWith('https://') && result.status === 0 && !signal?.aborted) {
    const httpUrl = 'http://' + startUrl.slice('https://'.length);
    const fallback = await attempt(httpUrl, timeoutMs, signal);
    if (fallback.ok || fallback.status > 0) return fallback;
  }
  return result;
}

/** Single attempt (one scheme), following its redirect chain. */
async function attempt(
  startUrl: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HttpResult> {
  const result = baseResult();
  const chain: RedirectHop[] = [];
  let currentUrl = startUrl;
  const startedAt = performance.now();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let response;
    try {
      response = await request(currentUrl, {
        method: 'GET',
        headers: defaultHeaders(),
        // undici does not follow redirects by default; we follow manually.
        signal: opSignal(timeoutMs, signal),
        bodyTimeout: timeoutMs,
        headersTimeout: timeoutMs,
      });
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.redirectChain = chain;
      result.redirectCount = chain.length;
      result.finalUrl = currentUrl;
      return result;
    }

    const ttfb = performance.now() - startedAt;
    const status = response.statusCode;
    const headers = flattenHeaders(response.headers);

    // Redirect: record the hop and continue.
    if (REDIRECT_CODES.has(status) && headers['location']) {
      chain.push({ url: currentUrl, status });
      response.body.dump().catch(() => undefined); // discard body
      const next = resolveLocation(headers['location'], currentUrl);
      if (chain.some((h) => h.url === next)) {
        // Redirect loop — stop here.
        result.error = 'Redirect loop detected';
        break;
      }
      currentUrl = next;
      continue;
    }

    // Terminal response: read the (capped) body.
    const { body, sizeBytes } = await readCappedBody(response.body);
    const downloadMs = performance.now() - startedAt - ttfb;

    result.ok = status > 0 && status < 400;
    result.status = status;
    result.https = currentUrl.startsWith('https://');
    result.finalUrl = currentUrl;
    result.redirectChain = chain;
    result.redirectCount = chain.length;
    result.ttfbMs = Math.round(ttfb);
    result.totalMs = Math.round(performance.now() - startedAt);
    result.downloadMs = Math.round(Math.max(0, downloadMs));
    result.contentSizeBytes = sizeBytes;
    result.compression = headers['content-encoding'] ?? '';
    result.cacheHeaders = summarizeCache(headers);
    result.cookieCount = countCookies(response.headers['set-cookie']);
    result.headers = headers;
    result.body = body;
    result.server = headers['server'] ?? '';
    result.poweredBy = headers['x-powered-by'] ?? '';
    return result;
  }

  // Exhausted redirects.
  result.error = result.error ?? 'Too many redirects';
  result.finalUrl = currentUrl;
  result.redirectChain = chain;
  result.redirectCount = chain.length;
  return result;
}

/** Read a response body up to the cap, decoding as UTF-8. */
async function readCappedBody(
  body: import('undici').Dispatcher.ResponseData['body'],
): Promise<{ body: string; sizeBytes: number }> {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buf.length;
      if (total <= BODY_CAP_BYTES) {
        chunks.push(buf);
      } else {
        // Keep only up to the cap, then stop reading.
        const remaining = BODY_CAP_BYTES - (total - buf.length);
        if (remaining > 0) chunks.push(buf.subarray(0, remaining));
        body.destroy();
        break;
      }
    }
  } catch {
    // Partial body is still useful for fingerprinting.
  }
  return { body: Buffer.concat(chunks).toString('utf8'), sizeBytes: total };
}
