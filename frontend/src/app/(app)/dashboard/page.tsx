'use client';

import Link from 'next/link';
import {
  Globe,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertTriangle,
  ShieldAlert,
  Gauge,
  Clock,
  Cloud,
  RefreshCw,
} from 'lucide-react';
import { useKpis, useMonitoringStatus, useIncidents, useTriggerJob } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/stat-card';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { fmtMs, fmtNum, relativeTime } from '@/lib/utils';

export default function DashboardPage() {
  const kpis = useKpis();
  const status = useMonitoringStatus();
  const incidents = useIncidents();
  const trigger = useTriggerJob({
    onSuccess: () => toast.success('Monitoring run queued'),
    onError: (e) => toast.error(e.message || 'Failed to trigger run'),
  });

  const k = kpis.data?.data;
  const lastRun = status.data?.data.lastRun;
  const openIncidents = (incidents.data?.data.incidents ?? []).filter((i) => i.status === 'open');

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Portfolio-wide health, availability and risk at a glance."
        actions={
          <Button
            onClick={() => trigger.mutate({})}
            disabled={trigger.isPending}
            size="sm"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${trigger.isPending ? 'animate-spin' : ''}`} />
            Run monitoring now
          </Button>
        }
      />

      {kpis.isError ? (
        <ErrorState
          message={(kpis.error as Error)?.message ?? 'Failed to load KPIs'}
          onRetry={() => kpis.refetch()}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <StatCard
            label="Total"
            value={fmtNum(k?.totalDomains)}
            icon={Globe}
            tone="primary"
            loading={kpis.isLoading}
          />
          <StatCard
            label="Up"
            value={fmtNum(k?.healthy)}
            icon={ArrowUpCircle}
            tone="success"
            loading={kpis.isLoading}
          />
          <StatCard
            label="Down"
            value={fmtNum(k?.down)}
            icon={ArrowDownCircle}
            tone="destructive"
            loading={kpis.isLoading}
          />
          <StatCard
            label="Degraded"
            value={fmtNum(k?.degraded)}
            icon={AlertTriangle}
            tone="warning"
            loading={kpis.isLoading}
          />
          <StatCard
            label="SSL ≤30d"
            value={fmtNum(k?.sslExpiringSoon)}
            icon={ShieldAlert}
            tone="warning"
            loading={kpis.isLoading}
          />
          <StatCard
            label="SSL expired"
            value={fmtNum(k?.sslExpired)}
            icon={ShieldAlert}
            tone="destructive"
            loading={kpis.isLoading}
          />
          <StatCard
            label="Avg health"
            value={fmtNum(k?.avgHealthScore)}
            icon={Gauge}
            tone="success"
            loading={kpis.isLoading}
          />
          <StatCard
            label="Avg response"
            value={fmtMs(k?.avgResponseTimeMs)}
            icon={Clock}
            loading={kpis.isLoading}
          />
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Open incidents */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Open incidents</CardTitle>
            <Link href="/domains?status=DOWN" className="text-xs text-primary hover:underline">
              View affected
            </Link>
          </CardHeader>
          <CardContent>
            {incidents.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : openIncidents.length === 0 ? (
              <EmptyState
                icon={ArrowUpCircle}
                title="No open incidents"
                description="Every monitored domain is currently healthy."
              />
            ) : (
              <div className="divide-y">
                {openIncidents.slice(0, 8).map((inc) => (
                  <div key={inc.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/domains/${encodeURIComponent(inc.domain)}`}
                        className="truncate text-sm font-medium hover:underline"
                      >
                        {inc.domain}
                      </Link>
                      <p className="truncate text-2xs text-muted-foreground">{inc.message}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusBadge status={inc.toStatus} />
                      <span className="hidden text-2xs text-muted-foreground sm:inline">
                        {relativeTime(inc.openedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Last run + stack */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Last run</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {status.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : lastRun ? (
                <>
                  <Row label="Finished" value={relativeTime(lastRun.finishedAt)} />
                  <Row label="Checked" value={fmtNum(lastRun.totalDomains)} />
                  <Row label="Up / Down" value={`${fmtNum(lastRun.up)} / ${fmtNum(lastRun.down)}`} />
                  <Row label="Screenshots" value={fmtNum(lastRun.screenshotsCaptured)} />
                  <Row
                    label="Incidents"
                    value={`+${fmtNum(lastRun.incidentsOpened)} / -${fmtNum(lastRun.incidentsResolved)}`}
                  />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">No runs recorded yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stack coverage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Cloud className="h-3.5 w-3.5" /> Cloudflare
                  </span>
                }
                value={fmtNum(k?.cloudflareCount)}
              />
              <Row label="WordPress" value={fmtNum(k?.wordpressCount)} />
              <Row label="HTTPS" value={fmtNum(k?.httpsCount)} />
              <Row label="DNS issues" value={fmtNum(k?.dnsIssues)} />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
