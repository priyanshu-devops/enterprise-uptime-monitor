'use client';

import { useState } from 'react';
import { FileText, Download, Loader2, FileSpreadsheet, FileJson, FileCode } from 'lucide-react';
import type { ExportFormat, ReportPeriod } from '@uptime/shared';
import { useExportReport } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';

const PERIODS: { value: ReportPeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const FORMATS: { value: ExportFormat; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { value: 'xlsx', label: 'Excel', icon: FileSpreadsheet, hint: 'Formatted workbook with sheets' },
  { value: 'csv', label: 'CSV', icon: FileText, hint: 'Flat data for spreadsheets' },
  { value: 'json', label: 'JSON', icon: FileJson, hint: 'Machine-readable snapshot' },
  { value: 'pdf', label: 'PDF', icon: FileText, hint: 'Print-ready summary' },
  { value: 'md', label: 'Markdown', icon: FileCode, hint: 'Docs-friendly report' },
  { value: 'html', label: 'HTML', icon: FileCode, hint: 'Standalone web page' },
];

export default function ReportsPage() {
  const [period, setPeriod] = useState<ReportPeriod>('weekly');
  const [pending, setPending] = useState<ExportFormat | null>(null);

  const exportReport = useExportReport({
    onSuccess: () => {
      toast.success('Report downloaded');
      setPending(null);
    },
    onError: (e) => {
      toast.error(e.message || 'Export failed');
      setPending(null);
    },
  });

  const handleExport = (format: ExportFormat) => {
    setPending(format);
    exportReport.mutate({ format, period });
  };

  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate portfolio reports across six export formats. Snapshots are built from live monitoring data."
        actions={
          <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FORMATS.map((f) => {
          const Icon = f.icon;
          const isPending = pending === f.value;
          return (
            <Card key={f.value} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4 text-primary" />
                  {f.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-xs text-muted-foreground">{f.hint}</p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleExport(f.value)}
                  disabled={pending !== null}
                >
                  {isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download {f.label}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>What&apos;s in a report?</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <ul className="list-inside list-disc space-y-1">
            <li>Portfolio KPIs (uptime, health, risk, SSL posture)</li>
            <li>Status, hosting, CDN and CMS distributions</li>
            <li>Incidents opened and resolved in the period</li>
          </ul>
          <ul className="list-inside list-disc space-y-1">
            <li>Worst-performing domains by response time</li>
            <li>Certificates expiring within the window</li>
            <li>Actionable recommendations</li>
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
