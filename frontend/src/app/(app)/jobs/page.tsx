'use client';

import { useState } from 'react';
import {
  PlayCircle,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import type { JobRun, TriggerJobRequest } from '@uptime/shared';
import { useDomains, useJobs, useTriggerJob } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn, fmtDuration, relativeTime } from '@/lib/utils';

/** How the run is scoped. */
type RunScope = 'all' | 'batch' | 'domains' | 'limit';

const BATCH_SIZES = [25, 50, 100, 250] as const;

export default function JobsPage() {
  const { data: jobs, isLoading, isError, error, refetch, isFetching } = useJobs();
  const { data: domainsData } = useDomains();
  const totalDomains = domainsData?.data?.total ?? 0;

  const [scope, setScope] = useState<RunScope>('all');
  const [batchSize, setBatchSize] = useState<number>(50);
  const [batchNo, setBatchNo] = useState<number>(1);
  const [domainsText, setDomainsText] = useState('');
  const [limit, setLimit] = useState('');
  const [skipShots, setSkipShots] = useState(false);

  const trigger = useTriggerJob();

  // Number of selectable batches; fall back to 20 until the domain count loads.
  const batchCount = totalDomains > 0 ? Math.ceil(totalDomains / batchSize) : 20;
  const batchStart = (batchNo - 1) * batchSize + 1;
  const batchEnd =
    totalDomains > 0 ? Math.min(batchNo * batchSize, totalDomains) : batchNo * batchSize;

  const handleBatchSizeChange = (v: string) => {
    setBatchSize(Number(v));
    setBatchNo(1);
  };

  const handleTrigger = () => {
    const body: TriggerJobRequest = { skipScreenshots: skipShots };
    let msg = 'Full monitoring run queued';

    if (scope === 'batch') {
      body.batchStart = batchStart;
      body.batchEnd = batchEnd;
      msg = `Batch ${batchNo} queued (domains ${batchStart}–${batchEnd})`;
    } else if (scope === 'domains') {
      const list = domainsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length === 0) {
        toast.error('Enter at least one domain');
        return;
      }
      body.domains = list;
      msg = `${list.length} domain${list.length > 1 ? 's' : ''} queued`;
    } else if (scope === 'limit') {
      const n = Number(limit);
      if (!limit || !Number.isFinite(n) || n < 1) {
        toast.error('Enter a valid limit');
        return;
      }
      body.limit = n;
      msg = `First ${n} domains queued`;
    }

    trigger.mutate(body, {
      onSuccess: () => toast.success(msg),
      onError: (e) => toast.error(e.message || 'Failed to trigger run'),
    });
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Trigger monitoring runs and track GitHub Actions execution history."
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Trigger a run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={scope} onValueChange={(v) => setScope(v as RunScope)}>
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="batch">Batch</TabsTrigger>
                <TabsTrigger value="domains">Domains</TabsTrigger>
                <TabsTrigger value="limit">Limit</TabsTrigger>
              </TabsList>

              <TabsContent value="all" className="mt-3">
                <p className="text-2xs text-muted-foreground">
                  Check every domain in the sheet across parallel shards
                  {totalDomains > 0 && ` (${totalDomains} domains)`}.
                </p>
              </TabsContent>

              <TabsContent value="batch" className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Batch size</Label>
                    <Select value={String(batchSize)} onValueChange={handleBatchSizeChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BATCH_SIZES.map((s) => (
                          <SelectItem key={s} value={String(s)}>
                            {s} domains
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Batch number</Label>
                    <Select
                      value={String(batchNo)}
                      onValueChange={(v) => setBatchNo(Number(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: batchCount }, (_, i) => {
                          const n = i + 1;
                          const s = (n - 1) * batchSize + 1;
                          const e =
                            totalDomains > 0
                              ? Math.min(n * batchSize, totalDomains)
                              : n * batchSize;
                          return (
                            <SelectItem key={n} value={String(n)}>
                              Batch {n} · {s}–{e}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <p className="text-2xs text-muted-foreground">
                  Runs domains {batchStart}–{batchEnd}
                  {totalDomains > 0 && ` of ${totalDomains}`} (sheet order).
                </p>
              </TabsContent>

              <TabsContent value="domains" className="mt-3 space-y-1.5">
                <Label htmlFor="domains">Exact domains</Label>
                <Textarea
                  id="domains"
                  rows={4}
                  placeholder={'example.com, another.com\nor one per line'}
                  value={domainsText}
                  onChange={(e) => setDomainsText(e.target.value)}
                />
                <p className="text-2xs text-muted-foreground">
                  Comma or newline separated. Domains not in the sheet are checked too.
                </p>
              </TabsContent>

              <TabsContent value="limit" className="mt-3 space-y-1.5">
                <Label htmlFor="limit">First N domains</Label>
                <Input
                  id="limit"
                  type="number"
                  min={1}
                  placeholder="e.g. 100"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                />
                <p className="text-2xs text-muted-foreground">
                  Cap the number of domains checked in this run.
                </p>
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="skip">Skip screenshots</Label>
                <p className="text-2xs text-muted-foreground">Faster run, no captures.</p>
              </div>
              <Switch id="skip" checked={skipShots} onCheckedChange={setSkipShots} />
            </div>

            <Button className="w-full" onClick={handleTrigger} disabled={trigger.isPending}>
              {trigger.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="mr-2 h-4 w-4" />
              )}
              {scope === 'batch' ? `Run batch ${batchNo} now` : 'Run monitoring now'}
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? (
              <ErrorState
                message={(error as Error)?.message ?? 'Failed to load runs'}
                onRetry={refetch}
              />
            ) : isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : !jobs || jobs.length === 0 ? (
              <EmptyState
                icon={PlayCircle}
                title="No runs yet"
                description="Trigger a run or wait for the scheduled cron (09:00 & 21:00 IST)."
              />
            ) : (
              <div className="divide-y">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function JobRow({ job }: { job: JobRun }) {
  const { icon: Icon, className, spin, label } = runVisual(job);
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className={cn('h-5 w-5 shrink-0', className, spin && 'animate-spin')} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{job.name || `Run #${job.id}`}</p>
          <p className="text-2xs text-muted-foreground">
            {job.event} · {relativeTime(job.createdAt)}
            {job.durationSeconds != null && ` · ${fmtDuration(job.durationSeconds)}`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={cn('text-2xs font-medium', className)}>{label}</span>
        {job.htmlUrl && (
          <a
            href={job.htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Open run on GitHub"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
      </div>
    </div>
  );
}

function runVisual(job: JobRun): {
  icon: React.ComponentType<{ className?: string }>;
  className: string;
  spin: boolean;
  label: string;
} {
  if (job.status === 'in_progress') return { icon: Loader2, className: 'text-primary', spin: true, label: 'Running' };
  if (job.status === 'queued') return { icon: Clock, className: 'text-muted-foreground', spin: false, label: 'Queued' };
  if (job.conclusion === 'success') return { icon: CheckCircle2, className: 'text-success', spin: false, label: 'Success' };
  if (job.conclusion === 'failure') return { icon: XCircle, className: 'text-destructive', spin: false, label: 'Failed' };
  return { icon: Clock, className: 'text-muted-foreground', spin: false, label: job.conclusion ?? 'Completed' };
}
