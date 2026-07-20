'use client';

import { useState, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus, Search, Download, Loader2 } from 'lucide-react';
import type { DomainRecord } from '@uptime/shared';
import { useDomains, useCreateDomain } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { DomainsTable } from '@/components/domains/domains-table';
import { ErrorState } from '@/components/empty-state';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/toast';
import { downloadCsv } from '@/lib/utils';

const STATUS_OPTIONS = [
  'ALL',
  'UP',
  'DOWN',
  'DEGRADED',
  'REDIRECT',
  'SSL_ERROR',
  'DNS_FAILURE',
  'TIMEOUT',
  'PAUSED',
  'ERROR',
];

function DomainsContent() {
  const searchParams = useSearchParams();
  const { data, isLoading, isError, error, refetch } = useDomains();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? 'ALL');
  const [category, setCategory] = useState('ALL');
  const [addOpen, setAddOpen] = useState(false);

  const allDomains = useMemo(() => data?.data.items ?? [], [data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const d of allDomains) if (d.category.trim()) set.add(d.category.trim());
    return ['ALL', ...[...set].sort()];
  }, [allDomains]);

  const filtered = useMemo(() => {
    return allDomains.filter((d) => {
      if (status !== 'ALL' && d.status !== status) return false;
      if (category !== 'ALL' && d.category.trim() !== category) return false;
      return true;
    });
  }, [allDomains, status, category]);

  const exportCsv = () => {
    const headers = [
      'Domain',
      'Status',
      'HTTP',
      'ResponseMs',
      'SSLDays',
      'Health',
      'Risk',
      'Hosting',
      'Category',
    ];
    const rows = filtered.map((d) => [
      d.domain,
      d.status,
      d.httpStatus,
      d.responseTime,
      d.sslDaysRemaining,
      d.healthScore,
      d.riskScore,
      d.hostingProvider,
      d.category,
    ]);
    downloadCsv(`domains-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  return (
    <>
      <PageHeader
        title="Domains"
        description={`${allDomains.length} monitored domain(s) across your portfolio.`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filtered.length}>
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add domain
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search domain, company, owner, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ALL' ? 'All statuses' : s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c === 'ALL' ? 'All categories' : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError ? (
        <ErrorState message={(error as Error)?.message ?? 'Failed to load domains'} onRetry={refetch} />
      ) : isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <DomainsTable data={filtered} globalFilter={search} />
      )}

      <AddDomainDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}

export default function DomainsPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <DomainsContent />
    </Suspense>
  );
}

function AddDomainDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [form, setForm] = useState({
    website: '',
    company: '',
    project: '',
    owner: '',
    category: '',
    tags: '',
  });
  const create = useCreateDomain({
    onSuccess: () => {
      toast.success('Domain added');
      onOpenChange(false);
      setForm({ website: '', company: '', project: '', owner: '', category: '', tags: '' });
    },
    onError: (e) => toast.error(e.message || 'Failed to add domain'),
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add domain</DialogTitle>
          <DialogDescription>
            Enter a website URL. The monitor fills in all technical fields on the next run.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <Field label="Website URL *">
            <Input placeholder="https://example.com" value={form.website} onChange={set('website')} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <Input value={form.company} onChange={set('company')} />
            </Field>
            <Field label="Project">
              <Input value={form.project} onChange={set('project')} />
            </Field>
            <Field label="Owner">
              <Input value={form.owner} onChange={set('owner')} />
            </Field>
            <Field label="Category">
              <Input value={form.category} onChange={set('category')} />
            </Field>
          </div>
          <Field label="Tags (comma-separated)">
            <Input placeholder="prod, critical" value={form.tags} onChange={set('tags')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate(form)}
            disabled={!form.website.trim() || create.isPending}
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add domain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
