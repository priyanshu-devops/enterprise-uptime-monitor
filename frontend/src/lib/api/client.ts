'use client';

/**
 * API client: typed fetch wrapper over the backend REST API with a read-only
 * GitHub Pages fallback for GET endpoints while the backend is cold-starting.
 */
import type {
  DomainRecord,
  HistoryPoint,
  Incident,
  MonitoringStatus,
  Paginated,
  RunSummary,
} from '@uptime/shared';
import { useAuthStore } from '@/lib/stores/auth';
import { useConnectionStore } from '@/lib/stores/connection';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';
const PAGES_BASE = process.env.NEXT_PUBLIC_PAGES_BASE_URL ?? '';
const TIMEOUT_MS = 4000;

/** Error thrown for non-2xx responses and network failures. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiResult<T> {
  data: T;
  /** 'live' when served by the backend, 'cache' when served from Pages. */
  source: 'live' | 'cache';
}

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function handleUnauthorized() {
  useAuthStore.getState().logout();
  if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login';
  }
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseError(res: Response): Promise<ApiClientError> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { detail?: string; title?: string; message?: string };
    detail = body.detail ?? body.title ?? body.message ?? detail;
  } catch {
    /* non-JSON error body */
  }
  return new ApiClientError(detail || `Request failed (${res.status})`, res.status, detail);
}

/**
 * Core request against the live backend. Throws ApiClientError on non-2xx,
 * handles 401 by logging out, and returns parsed JSON.
 */
async function liveRequest<T>(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<T> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/v1${path}`,
    {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
    },
    timeoutMs,
  );
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiClientError('Session expired', 401);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// GitHub Pages fallback mapping
// ---------------------------------------------------------------------------

async function pagesJson<T>(path: string): Promise<T> {
  if (!PAGES_BASE) throw new ApiClientError('No fallback source configured', 0);
  const res = await fetchWithTimeout(`${PAGES_BASE}${path}`, { cache: 'no-store' }, 8000);
  if (!res.ok) throw new ApiClientError(`Cache fetch failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

async function pagesDomains(): Promise<DomainRecord[]> {
  return pagesJson<DomainRecord[]>('/cache/domains.json');
}

/**
 * Maps a subset of GET endpoints onto the static Pages cache so the app stays
 * readable during backend cold starts. Returns undefined when no mapping
 * exists for the path.
 */
async function pagesFallback(path: string): Promise<unknown | undefined> {
  const [pathname, search] = path.split('?');
  const params = new URLSearchParams(search ?? '');

  if (pathname === '/domains') {
    const items = await pagesDomains();
    // Serve everything; the domains page does client-side filtering anyway.
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length || Number(params.get('pageSize') ?? 1000),
    } satisfies Paginated<DomainRecord>;
  }

  const domainMatch = pathname?.match(/^\/domains\/([^/]+)$/);
  if (domainMatch?.[1]) {
    const domain = decodeURIComponent(domainMatch[1]);
    const items = await pagesDomains();
    const found = items.find((d) => d.domain === domain);
    if (!found) throw new ApiClientError('Domain not found in cache', 404);
    return found;
  }

  if (pathname === '/monitoring/status') {
    const summary = await pagesJson<RunSummary>('/cache/summary.json');
    return {
      lastRun: summary,
      dataSource: 'cache',
      cacheGeneratedAt: summary.finishedAt ?? null,
    } satisfies MonitoringStatus;
  }

  if (pathname === '/monitoring/incidents') {
    const incidents = await pagesJson<Incident[] | { incidents: Incident[] }>(
      '/cache/incidents.json',
    );
    return Array.isArray(incidents) ? { incidents } : incidents;
  }

  if (pathname === '/analytics/kpis') {
    const [items, summary] = await Promise.all([
      pagesDomains(),
      pagesJson<RunSummary>('/cache/summary.json').catch(() => null),
    ]);
    return kpisFromDomains(items, summary);
  }

  if (pathname === '/analytics/trends') {
    const days = Number(params.get('days') ?? 30);
    return { points: await pagesHistory(days) };
  }

  if (pathname === '/analytics/distributions') {
    return distributionsFromDomains(await pagesDomains());
  }

  if (pathname === '/analytics/sla') {
    return pagesJson('/cache/sla.json').catch(() => null);
  }

  return undefined;
}

/** Fetch up to `days` daily history points from cache/history/YYYY-MM/DD.json. */
async function pagesHistory(days: number): Promise<HistoryPoint[]> {
  const dates: { key: string; path: string }[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const day = pad(d.getDate());
    dates.push({ key: `${ym}-${day}`, path: `/cache/history/${ym}/${day}.json` });
  }
  const results = await Promise.all(
    dates.map(async ({ path }) => {
      try {
        return await pagesJson<HistoryPoint>(path);
      } catch {
        return null;
      }
    }),
  );
  return results.filter((p): p is HistoryPoint => p !== null);
}

/** Derive a KPI snapshot from raw domain rows (fallback-mode analytics). */
function kpisFromDomains(items: DomainRecord[], summary: RunSummary | null) {
  const num = (s: string) => {
    const n = Number(s);
    return Number.isNaN(n) ? 0 : n;
  };
  const active = items.filter((d) => d.status !== 'PAUSED');
  const avg = (vals: number[]) =>
    vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const responseTimes = active.map((d) => num(d.responseTime)).filter((n) => n > 0);
  const ttfbs = active.map((d) => num(d.ttfb)).filter((n) => n > 0);
  const healths = active.map((d) => num(d.healthScore)).filter((n) => n > 0);
  const risks = active.map((d) => num(d.riskScore)).filter((n) => n > 0);
  return {
    totalDomains: items.length,
    healthy: items.filter((d) => d.status === 'UP').length,
    down: items.filter((d) => ['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'ERROR', 'SSL_ERROR'].includes(d.status))
      .length,
    degraded: items.filter((d) => d.status === 'DEGRADED').length,
    paused: items.filter((d) => d.status === 'PAUSED').length,
    sslExpiringSoon: items.filter((d) => {
      const n = Number(d.sslDaysRemaining);
      return !Number.isNaN(n) && n >= 0 && n <= 30;
    }).length,
    sslExpired: items.filter((d) => Number(d.sslDaysRemaining) < 0).length,
    redirectIssues: summary?.redirectIssues ?? 0,
    dnsIssues: items.filter((d) => d.status === 'DNS_FAILURE').length,
    avgResponseTimeMs: avg(responseTimes),
    avgTtfbMs: avg(ttfbs),
    avgHealthScore: avg(healths),
    avgRiskScore: avg(risks),
    cloudflareCount: items.filter((d) => d.cloudflare === 'Yes').length,
    wordpressCount: items.filter((d) => d.wordpress === 'Yes').length,
    httpsCount: items.filter((d) => d.https === 'Yes').length,
    generatedAt: summary?.finishedAt ?? new Date().toISOString(),
  };
}

/** Derive distribution buckets from raw domain rows (fallback-mode analytics). */
function distributionsFromDomains(items: DomainRecord[]) {
  const tally = (get: (d: DomainRecord) => string) => {
    const map = new Map<string, number>();
    for (const d of items) {
      const key = get(d).trim() || 'Unknown';
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  };
  const sslBuckets = [
    { name: 'Expired', value: 0 },
    { name: '<7 days', value: 0 },
    { name: '<30 days', value: 0 },
    { name: '<90 days', value: 0 },
    { name: 'OK', value: 0 },
  ];
  const healthBuckets = [
    { name: '0-25', value: 0 },
    { name: '26-50', value: 0 },
    { name: '51-75', value: 0 },
    { name: '76-100', value: 0 },
  ];
  for (const d of items) {
    const ssl = Number(d.sslDaysRemaining);
    if (!Number.isNaN(ssl) && d.sslDaysRemaining !== '') {
      if (ssl < 0) sslBuckets[0]!.value++;
      else if (ssl < 7) sslBuckets[1]!.value++;
      else if (ssl < 30) sslBuckets[2]!.value++;
      else if (ssl < 90) sslBuckets[3]!.value++;
      else sslBuckets[4]!.value++;
    }
    const h = Number(d.healthScore);
    if (!Number.isNaN(h) && d.healthScore !== '') {
      if (h <= 25) healthBuckets[0]!.value++;
      else if (h <= 50) healthBuckets[1]!.value++;
      else if (h <= 75) healthBuckets[2]!.value++;
      else healthBuckets[3]!.value++;
    }
  }
  return {
    status: tally((d) => d.status),
    hosting: tally((d) => d.hostingProvider),
    cdn: tally((d) => d.cdn),
    cms: tally((d) => d.cms),
    framework: tally((d) => d.framework),
    sslExpiryBuckets: sslBuckets,
    healthBuckets,
    category: tally((d) => d.category),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * GET with Pages fallback. On backend failure (network/timeout/5xx) attempts
 * the static cache mapping; flips the global fallback flag accordingly.
 */
export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  try {
    const data = await liveRequest<T>(path);
    useConnectionStore.getState().setUsingFallback(false);
    return { data, source: 'live' };
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 401) throw err;
    if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) throw err;
    const fallback = await pagesFallback(path).catch(() => undefined);
    if (fallback !== undefined) {
      useConnectionStore.getState().setUsingFallback(true);
      return { data: fallback as T, source: 'cache' };
    }
    if (err instanceof ApiClientError) throw err;
    useConnectionStore.getState().setUsingFallback(true);
    throw new ApiClientError('API unreachable', 0);
  }
}

/** GET that never uses the fallback (jobs, logs, settings, audit...). */
export async function apiGetLive<T>(path: string, timeoutMs?: number): Promise<T> {
  return liveRequest<T>(path, {}, timeoutMs);
}

/** Mutations always target the live backend (longer timeout for cold starts). */
export async function apiMutate<T>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  timeoutMs = 60000,
): Promise<T> {
  return liveRequest<T>(
    path,
    { method, body: body === undefined ? undefined : JSON.stringify(body) },
    timeoutMs,
  );
}

/** Ping /healthz (no auth). Resolves true when the backend responds. */
export async function pingHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/healthz`, { cache: 'no-store' }, 5000);
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch the full /healthz payload (no auth, root-level path). */
export async function fetchHealthz(): Promise<import('@uptime/shared').HealthResponse> {
  const res = await fetchWithTimeout(`${API_BASE}/healthz`, { cache: 'no-store' }, 8000);
  if (!res.ok) throw new ApiClientError(`healthz failed (${res.status})`, res.status);
  return (await res.json()) as import('@uptime/shared').HealthResponse;
}

/** Download a binary export via blob, forwarding auth. Throws on failure. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/v1${path}`,
    { headers: authHeaders() },
    120000,
  );
  if (res.status === 401) {
    handleUnauthorized();
    throw new ApiClientError('Session expired', 401);
  }
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
