/**
 * DNS check stage.
 *
 * Resolves A/AAAA/MX/TXT/CAA/NS records using public resolvers (Cloudflare +
 * Google) via node:dns. A domain with no A/AAAA records is treated as a DNS
 * failure by the pipeline.
 */
import { Resolver } from 'node:dns/promises';
import type { DnsResult } from '@uptime/shared';

/** Public resolvers, tried in order. */
const RESOLVER_IPS = ['1.1.1.1', '8.8.8.8'];

/** Run a resolver method, returning [] on any error (record simply absent). */
async function tryResolve<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

/**
 * Perform the DNS check for a hostname.
 *
 * @param hostname Bare hostname (no scheme).
 * @param timeoutMs Per-query timeout.
 */
export async function checkDns(hostname: string, timeoutMs = 10_000): Promise<DnsResult> {
  const resolver = new Resolver({ timeout: timeoutMs, tries: 2 });
  resolver.setServers(RESOLVER_IPS);

  const [a, aaaa, mxRecords, txtRecords, caaRecords, ns] = await Promise.all([
    tryResolve(() => resolver.resolve4(hostname)),
    tryResolve(() => resolver.resolve6(hostname)),
    tryResolve(() => resolver.resolveMx(hostname)),
    tryResolve(() => resolver.resolveTxt(hostname)),
    tryResolve<{ critical: number; issue?: string; iodef?: string }>(() =>
      resolver.resolveCaa(hostname),
    ),
    tryResolve(() => resolver.resolveNs(hostname)),
  ]);

  const mx = mxRecords
    .sort((x, y) => x.priority - y.priority)
    .map((r) => r.exchange)
    .filter(Boolean);
  const txt = txtRecords.map((chunks) => chunks.join('')).filter(Boolean);
  const caa = caaRecords.map((r) => r.issue ?? r.iodef ?? '').filter(Boolean);

  const present: string[] = [];
  if (a.length) present.push('A');
  if (aaaa.length) present.push('AAAA');
  if (mx.length) present.push('MX');
  if (txt.length) present.push('TXT');
  if (caa.length) present.push('CAA');
  if (ns.length) present.push('NS');

  const ok = a.length > 0 || aaaa.length > 0;
  return {
    ok,
    a,
    aaaa,
    mx,
    txt,
    caa,
    nameservers: ns,
    summary: present.join(','),
    ...(ok ? {} : { error: 'No A/AAAA records' }),
  };
}
