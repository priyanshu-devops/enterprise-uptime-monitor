'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import type { AppSettings } from '@uptime/shared';
import { useSettings, useUpdateSettings, useHealth, useResyncSheets } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { cn, fmtDuration } from '@/lib/utils';

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const health = useHealth();
  const update = useUpdateSettings({
    onSuccess: () => toast.success('Settings saved'),
    onError: (e) => toast.error(e.message || 'Save failed'),
  });
  const resync = useResyncSheets({
    onSuccess: () => toast.success('Sheets cache refreshed'),
    onError: (e) => toast.error(e.message || 'Resync failed'),
  });

  const [form, setForm] = useState<AppSettings>({
    sslWarnDays: 30,
    responseTimeWarnMs: 3000,
    savedFilters: [],
  });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const healthy = health.data?.status === 'ok';

  return (
    <>
      <PageHeader
        title="Settings"
        description="Monitoring thresholds, connection status and data synchronization."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Alert thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssl">SSL warning window (days)</Label>
                      <Input
                        id="ssl"
                        type="number"
                        min={1}
                        value={form.sslWarnDays}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, sslWarnDays: Number(e.target.value) }))
                        }
                      />
                      <p className="text-2xs text-muted-foreground">
                        Flag certificates expiring within this many days.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rt">Slow response threshold (ms)</Label>
                      <Input
                        id="rt"
                        type="number"
                        min={100}
                        step={100}
                        value={form.responseTimeWarnMs}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, responseTimeWarnMs: Number(e.target.value) }))
                        }
                      />
                      <p className="text-2xs text-muted-foreground">
                        Mark domains slower than this as degraded-risk.
                      </p>
                    </div>
                  </div>
                  <Button onClick={() => update.mutate(form)} disabled={update.isPending}>
                    {update.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    Save settings
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Data synchronization</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-md text-sm text-muted-foreground">
                Force a refresh of the backend&apos;s Google Sheets cache. Use this after editing
                the sheet directly.
              </p>
              <Button variant="outline" onClick={() => resync.mutate()} disabled={resync.isPending}>
                <RefreshCw className={cn('mr-2 h-4 w-4', resync.isPending && 'animate-spin')} />
                Resync now
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="flex items-center gap-3">
              {health.isLoading ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <>
                  <div
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-full',
                      healthy ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive',
                    )}
                  >
                    {healthy ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  </div>
                  <div>
                    <p className="font-medium">{healthy ? 'Backend online' : 'Backend unreachable'}</p>
                    <p className="text-2xs text-muted-foreground">
                      {health.isError ? 'Serving cached data' : health.data?.status ?? 'unknown'}
                    </p>
                  </div>
                </>
              )}
            </div>

            {health.data && (
              <div className="space-y-2 border-t pt-3">
                <Row label="Version" value={health.data.version} />
                <Row label="Uptime" value={fmtDuration(health.data.uptimeSeconds)} />
                <Row
                  label="Sheets"
                  value={health.data.sheets.reachable ? 'reachable' : 'unreachable'}
                />
                {health.data.sheets.cacheAgeSeconds != null && (
                  <Row label="Cache age" value={fmtDuration(health.data.sheets.cacheAgeSeconds)} />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
