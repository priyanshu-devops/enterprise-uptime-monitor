'use client';

import { useState } from 'react';
import { ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { useAudit } from '@/lib/api/hooks';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { relativeTime } from '@/lib/utils';

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useAudit(page, 50);

  const entries = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / 50));

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every administrative action — who did what, when, and the result."
      />

      <Card>
        <CardContent className="p-0">
          {isError ? (
            <div className="p-6">
              <ErrorState
                message={(error as Error)?.message ?? 'Failed to load audit log'}
                onRetry={refetch}
              />
            </div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={ShieldCheck}
                title="No audit entries"
                description="Administrative actions will appear here."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e, i) => (
                    <TableRow key={`${e.timestamp}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {relativeTime(e.timestamp)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-medium">{e.actor || '—'}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.action}</TableCell>
                      <TableCell className="max-w-[240px] truncate text-muted-foreground">
                        {e.target || '—'}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            e.status === 'success'
                              ? 'text-2xs font-medium text-success'
                              : 'text-2xs font-medium text-destructive'
                          }
                        >
                          {e.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {total} entries · page {page} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page >= pageCount}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
