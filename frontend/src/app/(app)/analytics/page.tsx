'use client';

import { useState } from 'react';
import type { HistoryPoint } from '@uptime/shared';
import { useTrends, useDistributions, useKpis } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/stat-card';
import { ErrorState, EmptyState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TrendAreaChart,
  TrendLineChart,
  DistributionBarChart,
  DonutChart,
  CHART_COLORS,
  type SeriesPoint,
} from '@/components/charts/charts';
import { BarChart3 } from 'lucide-react';
import { fmtMs, fmtNum } from '@/lib/utils';

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const trends = useTrends(days);
  const dist = useDistributions();
  const kpis = useKpis();

  const points: HistoryPoint[] = trends.data?.data.points ?? [];
  const availData: SeriesPoint[] = points.map((p) => ({
    label: p.date.slice(5),
    Up: p.up,
    Down: p.down,
    Degraded: p.degraded,
  }));
  const perfData: SeriesPoint[] = points.map((p) => ({
    label: p.date.slice(5),
    response: p.avgResponseTimeMs,
    ttfb: p.avgTtfbMs,
  }));
  const d = dist.data?.data;
  const k = kpis.data?.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Availability trends, performance and portfolio distributions."
        actions={
          <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
            <SelectTrigger className="w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Avg health" value={fmtNum(k?.avgHealthScore)} tone="success" loading={kpis.isLoading} />
        <StatCard label="Avg risk" value={fmtNum(k?.avgRiskScore)} tone="warning" loading={kpis.isLoading} />
        <StatCard label="Avg response" value={fmtMs(k?.avgResponseTimeMs)} loading={kpis.isLoading} />
        <StatCard label="Avg TTFB" value={fmtMs(k?.avgTtfbMs)} loading={kpis.isLoading} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Availability trend" loading={trends.isLoading} error={trends.isError} empty={!availData.length} onRetry={trends.refetch}>
          <TrendAreaChart
            data={availData}
            series={[
              { key: 'Up', name: 'Up', color: CHART_COLORS[1]! },
              { key: 'Degraded', name: 'Degraded', color: CHART_COLORS[2]! },
              { key: 'Down', name: 'Down', color: CHART_COLORS[3]! },
            ]}
          />
        </ChartCard>

        <ChartCard title="Response time trend" loading={trends.isLoading} error={trends.isError} empty={!perfData.length} onRetry={trends.refetch}>
          <TrendLineChart data={perfData} dataKey="response" name="Response (ms)" color={CHART_COLORS[0]!} />
        </ChartCard>

        <ChartCard title="Status distribution" loading={dist.isLoading} error={dist.isError} empty={!d?.status.length} onRetry={dist.refetch}>
          <DonutChart data={d?.status ?? []} />
        </ChartCard>

        <ChartCard title="Health score buckets" loading={dist.isLoading} error={dist.isError} empty={!d?.healthBuckets.length} onRetry={dist.refetch}>
          <DistributionBarChart data={d?.healthBuckets ?? []} color={CHART_COLORS[1]!} />
        </ChartCard>

        <ChartCard title="Hosting providers" loading={dist.isLoading} error={dist.isError} empty={!d?.hosting.length} onRetry={dist.refetch}>
          <DistributionBarChart data={(d?.hosting ?? []).slice(0, 10)} color={CHART_COLORS[4]!} />
        </ChartCard>

        <ChartCard title="SSL expiry buckets" loading={dist.isLoading} error={dist.isError} empty={!d?.sslExpiryBuckets.length} onRetry={dist.refetch}>
          <DistributionBarChart data={d?.sslExpiryBuckets ?? []} color={CHART_COLORS[2]!} />
        </ChartCard>

        <ChartCard title="CMS breakdown" loading={dist.isLoading} error={dist.isError} empty={!d?.cms.length} onRetry={dist.refetch}>
          <DonutChart data={(d?.cms ?? []).slice(0, 8)} />
        </ChartCard>

        <ChartCard title="CDN breakdown" loading={dist.isLoading} error={dist.isError} empty={!d?.cdn.length} onRetry={dist.refetch}>
          <DonutChart data={(d?.cdn ?? []).slice(0, 8)} />
        </ChartCard>
      </div>
    </>
  );
}

function ChartCard({
  title,
  children,
  loading,
  error,
  empty,
  onRetry,
}: {
  title: string;
  children: React.ReactNode;
  loading: boolean;
  error: boolean;
  empty: boolean;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : error ? (
          <ErrorState message="Failed to load chart data" onRetry={onRetry} />
        ) : empty ? (
          <EmptyState icon={BarChart3} title="No data yet" description="Data appears after the first monitoring runs." />
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
