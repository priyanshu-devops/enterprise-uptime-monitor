/**
 * robots.txt / sitemap.xml presence check.
 *
 * Two cheap HEAD/GET probes against well-known paths. Presence is defined as a
 * 2xx response with a plausible content type; redirects to a 200 also count.
 */
import { getGlobalDispatcher, interceptors, request } from 'undici';
import type { CrawlFilesResult } from '@uptime/shared';

/** Dispatcher that follows up to 3 redirects to the canonical file location. */
const redirectDispatcher = getGlobalDispatcher().compose(
  interceptors.redirect({ maxRedirections: 3 }),
);

/** Probe a well-known file; returns true when it appears to exist. */
async function probe(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const res = await request(url, {
      method: 'GET',
      headers: { 'user-agent': 'UptimeMonitor/1.0' },
      dispatcher: redirectDispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    await res.body.dump().catch(() => undefined);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Check for robots.txt and sitemap.xml at the origin root.
 *
 * @param origin Origin URL (scheme + host), e.g. "https://example.com".
 * @param timeoutMs Per-probe timeout.
 */
export async function checkCrawlFiles(origin: string, timeoutMs = 10_000): Promise<CrawlFilesResult> {
  let base: string;
  try {
    base = new URL(origin).origin;
  } catch {
    return { robotsTxt: false, sitemapXml: false };
  }

  const [robotsTxt, sitemapXml] = await Promise.all([
    probe(`${base}/robots.txt`, timeoutMs),
    probe(`${base}/sitemap.xml`, timeoutMs),
  ]);

  return { robotsTxt, sitemapXml };
}
