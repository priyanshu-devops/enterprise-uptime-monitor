'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, XCircle, Clock, Wifi } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtDuration, fmtMs } from '@/lib/utils';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

interface StatusDomain {
  domain: string;
  status: string;
  uptime30d: number | null;
  p95Ms: number | null;
}

interface OpenIncident {
  id: string;
  domain: string;
  type: string;
  openedAt: string;
  message: string;
}

interface FleetData {
  uptime: { '24h': number | null; '7d': number | null; '30d': number | null; '90d': number | null };
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  mttrSeconds30d: number | null;
}

interface StatusResponse {
  generatedAt: string | null;
  fleet: FleetData | null;
  summary: {
    totalDomains: number | null;
    up: number | null;
    down: number | null;
    degraded: number | null;
    finishedAt: string | null;
  } | null;
  domains: StatusDomain[];
  openIncidents: OpenIncident[];
}

async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${API_BASE}/api/v1/public/status`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Status fetch failed (${res.status})`);
  return res.json();
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${v.toFixed(2)}%`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function PublicStatusPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public', 'status'],
    queryFn: fetchStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Loading status...</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <XCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">Unable to load status data.</p>
        </div>
      </div>
    );
  }

  const hasIncidents = data.openIncidents.length > 0;
  const overallStatus = !data.summary
    ? 'unknown'
    : (data.summary.down ?? 0) > 0
      ? 'major'
      : (data.summary.degraded ?? 0) > 0
        ? 'degraded'
        : 'operational';

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-4 py-10">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">System Status</h1>
          </div>
          {data.generatedAt && (
            <span className="text-xs text-muted-foreground">
              Updated {relativeTime(data.generatedAt)}
            </span>
          )}
        </header>

        {/* Overall banner */}
        <div
          className={cn(
            'mb-8 rounded-lg border p-5',
            overallStatus === 'operational' && 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950',
            overallStatus === 'degraded' && 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950',
            overallStatus === 'major' && 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950',
            overallStatus === 'unknown' && 'border-muted bg-muted/30',
          )}
        >
          <div className="flex items-center gap-3">
            {overallStatus === 'operational' && <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />}
            {overallStatus === 'degraded' && <AlertTriangle className="h-6 w-6 text-yellow-600 dark:text-yellow-400" />}
            {overallStatus === 'major' && <XCircle className="h-6 w-6 text-red-600 dark:text-red-400" />}
            {overallStatus === 'unknown' && <Wifi className="h-6 w-6 text-muted-foreground" />}
            <div>
              <p className="font-semibold">
                {overallStatus === 'operational' && 'All Systems Operational'}
                {overallStatus === 'degraded' && 'Partial Service Disruption'}
                {overallStatus === 'major' && 'Major Outage Detected'}
                {overallStatus === 'unknown' && 'Status Unknown'}
              </p>
              {data.summary && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {data.summary.totalDomains} services monitored · {data.summary.up ?? 0} up
                  {(data.summary.down ?? 0) > 0 && ` · ${data.summary.down} down`}
                  {(data.summary.degraded ?? 0) > 0 && ` · ${data.summary.degraded} degraded`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Fleet SLA metrics */}
        {data.fleet && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Uptime & Performance
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="Uptime 24h" value={fmtPct(data.fleet.uptime['24h'])} />
              <MetricCard label="Uptime 7d" value={fmtPct(data.fleet.uptime['7d'])} />
              <MetricCard label="Uptime 30d" value={fmtPct(data.fleet.uptime['30d'])} />
              <MetricCard label="Uptime 90d" value={fmtPct(data.fleet.uptime['90d'])} />
              <MetricCard label="p50 response" value={fmtMs(data.fleet.p50Ms)} />
              <MetricCard label="p95 response" value={fmtMs(data.fleet.p95Ms)} />
              <MetricCard label="p99 response" value={fmtMs(data.fleet.p99Ms)} />
              <MetricCard
                label="MTTR 30d"
                value={data.fleet.mttrSeconds30d != null ? fmtDuration(data.fleet.mttrSeconds30d) : '—'}
              />
            </div>
          </section>
        )}

        {/* Open incidents */}
        {hasIncidents && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Active Incidents ({data.openIncidents.length})
            </h2>
            <div className="divide-y rounded-lg border">
              {data.openIncidents.map((inc) => (
                <div key={inc.id} className="flex items-start gap-3 p-4">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{inc.domain}</p>
                    <p className="truncate text-xs text-muted-foreground">{inc.message}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {relativeTime(inc.openedAt)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Per-domain status */}
        {data.domains.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground uppercase tracking-wide">
              Services ({data.domains.length})
            </h2>
            <div className="divide-y rounded-lg border">
              {data.domains.map((d) => (
                <div key={d.domain} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="truncate text-sm font-medium">{d.domain}</span>
                  <div className="flex shrink-0 items-center gap-4">
                    {d.p95Ms != null && (
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        p95 {fmtMs(d.p95Ms)}
                      </span>
                    )}
                    {d.uptime30d != null && (
                      <span
                        className={cn(
                          'w-16 text-right text-xs font-medium tabular-nums',
                          d.uptime30d >= 99.9 ? 'text-green-600 dark:text-green-400' :
                          d.uptime30d >= 99 ? 'text-yellow-600 dark:text-yellow-400' :
                          'text-red-600 dark:text-red-400',
                        )}
                      >
                        {d.uptime30d.toFixed(2)}%
                      </span>
                    )}
                    <DomainStatusDot status={d.status} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-10 border-t pt-4 text-center text-xs text-muted-foreground">
          Powered by Uptime Monitor · Auto-refreshes every 60s
        </footer>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function DomainStatusDot({ status }: { status: string }) {
  const isUp = status === 'UP';
  const isDown = ['DOWN', 'TIMEOUT', 'DNS_FAILURE', 'ERROR', 'SSL_ERROR'].includes(status);
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 rounded-full',
        isUp && 'bg-green-500',
        isDown && 'bg-red-500',
        !isUp && !isDown && 'bg-yellow-500',
      )}
      title={status}
    />
  );
}
