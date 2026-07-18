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
import type { JobRun } from '@uptime/shared';
import { useJobs, useTriggerJob } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn, fmtDuration, relativeTime } from '@/lib/utils';

export default function JobsPage() {
  const { data: jobs, isLoading, isError, error, refetch, isFetching } = useJobs();
  const [limit, setLimit] = useState('');
  const [skipShots, setSkipShots] = useState(false);

  const trigger = useTriggerJob({
    onSuccess: () => toast.success('Monitoring run queued'),
    onError: (e) => toast.error(e.message || 'Failed to trigger run'),
  });

  const handleTrigger = () => {
    trigger.mutate({
      limit: limit ? Number(limit) : undefined,
      skipScreenshots: skipShots,
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
            <div className="space-y-1.5">
              <Label htmlFor="limit">Limit (optional)</Label>
              <Input
                id="limit"
                type="number"
                min={1}
                placeholder="All domains"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
              <p className="text-2xs text-muted-foreground">
                Cap the number of domains checked in this run.
              </p>
            </div>
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
              Run monitoring now
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
  const { icon: Icon, className, label } = runVisual(job);
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className={cn('h-5 w-5 shrink-0', className)} />
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
  label: string;
} {
  if (job.status === 'in_progress') return { icon: Loader2, className: 'text-primary animate-spin', label: 'Running' };
  if (job.status === 'queued') return { icon: Clock, className: 'text-muted-foreground', label: 'Queued' };
  if (job.conclusion === 'success') return { icon: CheckCircle2, className: 'text-success', label: 'Success' };
  if (job.conclusion === 'failure') return { icon: XCircle, className: 'text-destructive', label: 'Failed' };
  return { icon: Clock, className: 'text-muted-foreground', label: job.conclusion ?? 'Completed' };
}
