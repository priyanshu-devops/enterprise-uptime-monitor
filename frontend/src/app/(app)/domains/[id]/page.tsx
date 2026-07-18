'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ExternalLink,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { DomainRecord } from '@uptime/shared';
import { useDomain, useUpdateDomain, useDeleteDomain, useTriggerJob } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { StatusBadge } from '@/components/status-badge';
import { ErrorState } from '@/components/empty-state';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { cn, fmtMs, relativeTime, splitTags } from '@/lib/utils';
import { healthColor, riskColor, sslColor } from '@/lib/status';

const PAGES_BASE = process.env.NEXT_PUBLIC_PAGES_BASE_URL ?? '';

export default function DomainDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const domain = decodeURIComponent(id);
  const router = useRouter();
  const { data, isLoading, isError, error, refetch } = useDomain(domain);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const trigger = useTriggerJob({
    onSuccess: () => toast.success('Re-check queued'),
    onError: (e) => toast.error(e.message),
  });
  const del = useDeleteDomain({
    onSuccess: () => {
      toast.success('Domain deleted');
      router.push('/domains');
    },
    onError: (e) => toast.error(e.message),
  });

  const d = data?.data;

  if (isError) {
    return (
      <>
        <BackLink />
        <ErrorState message={(error as Error)?.message ?? 'Failed to load domain'} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title={domain}
        description={d?.website}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => trigger.mutate({ domains: [domain] })}
              disabled={trigger.isPending}
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', trigger.isPending && 'animate-spin')} />
              Re-check
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!d}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </>
        }
      />

      {isLoading || !d ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Availability</CardTitle>
                <StatusBadge status={d.status} />
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Metric label="HTTP status" value={d.httpStatus || '—'} />
                <Metric label="Response time" value={fmtMs(d.responseTime)} />
                <Metric label="TTFB" value={fmtMs(d.ttfb)} />
                <Metric
                  label="Health"
                  value={d.healthScore || '—'}
                  className={healthColor(Number(d.healthScore))}
                />
                <Metric
                  label="Risk"
                  value={d.riskScore || '—'}
                  className={riskColor(Number(d.riskScore))}
                />
                <Metric label="HTTPS" value={d.https || '—'} />
              </CardContent>
            </Card>

            <div className="grid gap-6 sm:grid-cols-2">
              <Section title="SSL / TLS">
                <Field label="Expiry" value={d.sslExpiry || '—'} />
                <Field
                  label="Days remaining"
                  value={d.sslDaysRemaining || '—'}
                  className={sslColor(d.sslDaysRemaining === '' ? null : Number(d.sslDaysRemaining))}
                />
                <Field label="Issuer" value={d.sslIssuer || '—'} />
                <Field label="TLS version" value={d.tlsVersion || '—'} />
              </Section>

              <Section title="DNS / Registration">
                <Field label="Server IP" value={d.serverIp || '—'} />
                <Field label="DNS records" value={d.dns || '—'} />
                <Field label="Nameservers" value={d.nameservers || '—'} />
                <Field label="Domain expiry" value={d.domainExpiry || '—'} />
              </Section>

              <Section title="Hosting / CDN">
                <Field label="Hosting" value={d.hostingProvider || '—'} />
                <Field label="CDN" value={d.cdn || '—'} />
                <Field label="Cloudflare" value={d.cloudflare || '—'} />
              </Section>

              <Section title="Technology">
                <Field label="CMS" value={d.cms || '—'} />
                <Field label="WordPress" value={d.wordpress || '—'} />
                <Field label="Framework" value={d.framework || '—'} />
                <Field label="Stack" value={d.technologyStack || '—'} />
              </Section>

              <Section title="SEO / Content">
                <Field label="Title" value={d.metaTitle || '—'} />
                <Field label="Description" value={d.metaDescription || '—'} />
                <Field label="robots.txt" value={d.robotsTxt || '—'} />
                <Field label="sitemap.xml" value={d.sitemapXml || '—'} />
                <Field label="Favicon" value={d.favicon || '—'} />
                <Field label="Page size" value={d.pageSize ? `${d.pageSize} KB` : '—'} />
              </Section>

              <Section title="Security">
                <Field label="Headers grade" value={d.securityHeaders || '—'} />
                <Field label="Redirect URL" value={d.redirectUrl || '—'} />
                {d.errorMessage && (
                  <Field label="Last error" value={d.errorMessage} className="text-destructive" />
                )}
              </Section>
            </div>
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Screenshot</CardTitle>
              </CardHeader>
              <CardContent>
                <ScreenshotView domain={d} />
                <p className="mt-3 text-2xs text-muted-foreground">
                  Last checked {d.lastCheckedDate} {d.lastCheckedTime} ·{' '}
                  {relativeTime(`${d.lastCheckedDate}T${d.lastCheckedTime || '00:00:00'}`)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Ownership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm">
                <Field label="Company" value={d.company || '—'} />
                <Field label="Project" value={d.project || '—'} />
                <Field label="Owner" value={d.owner || '—'} />
                <Field label="Department" value={d.department || '—'} />
                <Field label="Category" value={d.category || '—'} />
                <div>
                  <span className="text-xs text-muted-foreground">Tags</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {splitTags(d.tags).length ? (
                      splitTags(d.tags).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm">—</span>
                    )}
                  </div>
                </div>
                {d.notes && <Field label="Notes" value={d.notes} />}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {d && <EditDialog domain={d} open={editOpen} onOpenChange={setEditOpen} />}
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        domain={domain}
        pending={del.isPending}
        onConfirm={() => del.mutate(domain)}
      />
    </>
  );
}

function ScreenshotView({ domain }: { domain: DomainRecord }) {
  const src =
    domain.screenshotUrl ||
    (PAGES_BASE ? `${PAGES_BASE}/screenshots/${domain.domain}/desktop.jpg` : '');
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
        No screenshot available
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <a href={domain.website || src} target="_blank" rel="noopener noreferrer">
      <img
        src={src}
        alt={`Screenshot of ${domain.domain}`}
        className="aspect-video w-full rounded-md border object-cover object-top"
        onError={() => setErrored(true)}
        loading="lazy"
      />
    </a>
  );
}

function BackLink() {
  return (
    <Link
      href="/domains"
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to domains
    </Link>
  );
}

function Metric({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 text-lg font-semibold tabular-nums', className)}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">{children}</CardContent>
    </Card>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words text-right font-medium', className)}>{value}</span>
    </div>
  );
}

function EditDialog({
  domain,
  open,
  onOpenChange,
}: {
  domain: DomainRecord;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [form, setForm] = useState({
    company: domain.company,
    project: domain.project,
    owner: domain.owner,
    department: domain.department,
    category: domain.category,
    tags: domain.tags,
    notes: domain.notes,
  });
  const update = useUpdateDomain({
    onSuccess: () => {
      toast.success('Domain updated');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {domain.domain}</DialogTitle>
          <DialogDescription>
            Only ownership metadata is editable. Technical fields are managed by the monitor.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <EField label="Company">
            <Input value={form.company} onChange={set('company')} />
          </EField>
          <EField label="Project">
            <Input value={form.project} onChange={set('project')} />
          </EField>
          <EField label="Owner">
            <Input value={form.owner} onChange={set('owner')} />
          </EField>
          <EField label="Department">
            <Input value={form.department} onChange={set('department')} />
          </EField>
          <EField label="Category">
            <Input value={form.category} onChange={set('category')} />
          </EField>
          <EField label="Tags">
            <Input value={form.tags} onChange={set('tags')} />
          </EField>
          <div className="col-span-2">
            <EField label="Notes">
              <Textarea rows={3} value={form.notes} onChange={set('notes')} />
            </EField>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => update.mutate({ domain: domain.domain, patch: form })}
            disabled={update.isPending}
          >
            {update.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  domain,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  domain: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete domain</DialogTitle>
          <DialogDescription>
            This removes <span className="font-medium text-foreground">{domain}</span> from the
            sheet. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
