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

/** Node dns error codes that mean "the resolver answered: no such record". */
const DEFINITIVE_ABSENCE = new Set(['ENOTFOUND', 'ENODATA']);

/**
 * Resolve A/AAAA and classify any failure. A definitive absence (NXDOMAIN /
 * NODATA) means the resolver is working and the domain simply has no address;
 * any other code (timeout, SERVFAIL, connection refused) points at a broken
 * resolver/network — which the global breaker treats very differently.
 */
async function resolveAddresses(
  fn: () => Promise<string[]>,
): Promise<{ records: string[]; resolverError: boolean }> {
  try {
    return { records: await fn(), resolverError: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    return { records: [], resolverError: !DEFINITIVE_ABSENCE.has(code) };
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
    resolveAddresses(() => resolver.resolve4(hostname)),
    resolveAddresses(() => resolver.resolve6(hostname)),
    tryResolve(() => resolver.resolveMx(hostname)),
    tryResolve(() => resolver.resolveTxt(hostname)),
    tryResolve<{ critical: number; issue?: string; iodef?: string }>(() =>
      resolver.resolveCaa(hostname),
    ),
    tryResolve(() => resolver.resolveNs(hostname)),
  ]);

  const aRecords = a.records;
  const aaaaRecords = aaaa.records;
  const resolverError = a.resolverError || aaaa.resolverError;

  const mx = mxRecords
    .sort((x, y) => x.priority - y.priority)
    .map((r) => r.exchange)
    .filter(Boolean);
  const txt = txtRecords.map((chunks) => chunks.join('')).filter(Boolean);
  const caa = caaRecords.map((r) => r.issue ?? r.iodef ?? '').filter(Boolean);

  const present: string[] = [];
  if (aRecords.length) present.push('A');
  if (aaaaRecords.length) present.push('AAAA');
  if (mx.length) present.push('MX');
  if (txt.length) present.push('TXT');
  if (caa.length) present.push('CAA');
  if (ns.length) present.push('NS');

  const ok = aRecords.length > 0 || aaaaRecords.length > 0;
  return {
    ok,
    a: aRecords,
    aaaa: aaaaRecords,
    mx,
    txt,
    caa,
    nameservers: ns,
    summary: present.join(','),
    resolverError,
    ...(ok
      ? {}
      : { error: resolverError ? 'DNS resolver error (network/timeout)' : 'No A/AAAA records' }),
  };
}
