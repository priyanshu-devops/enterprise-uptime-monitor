'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { DomainRecord } from '@uptime/shared';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/status-badge';
import { cn, fmtMs } from '@/lib/utils';
import { healthColor, riskColor, sslColor } from '@/lib/status';

function num(s: string): number {
  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

export function DomainsTable({
  data,
  globalFilter,
}: {
  data: DomainRecord[];
  globalFilter: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'healthScore', desc: false }]);

  const columns = useMemo<ColumnDef<DomainRecord>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: ({ column }) => <SortHeader column={column} label="Domain" />,
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link
              href={`/domains/${encodeURIComponent(row.original.domain)}`}
              className="font-medium hover:underline"
            >
              {row.original.domain}
            </Link>
            {row.original.website && (
              <a
                href={row.original.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Open website"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => <SortHeader column={column} label="Status" />,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        accessorKey: 'httpStatus',
        header: 'HTTP',
        cell: ({ row }) => <span className="tabular-nums">{row.original.httpStatus || '—'}</span>,
      },
      {
        id: 'responseTime',
        accessorFn: (r) => num(r.responseTime),
        header: ({ column }) => <SortHeader column={column} label="Response" />,
        cell: ({ row }) => (
          <span className="tabular-nums">{fmtMs(row.original.responseTime)}</span>
        ),
      },
      {
        id: 'sslDaysRemaining',
        accessorFn: (r) => (r.sslDaysRemaining === '' ? Infinity : num(r.sslDaysRemaining)),
        header: ({ column }) => <SortHeader column={column} label="SSL" />,
        cell: ({ row }) => {
          const raw = row.original.sslDaysRemaining;
          if (raw === '') return <span className="text-muted-foreground">—</span>;
          const d = num(raw);
          return (
            <span className={cn('tabular-nums', sslColor(d))}>
              {d < 0 ? `expired ${Math.abs(d)}d` : `${d}d`}
            </span>
          );
        },
      },
      {
        id: 'healthScore',
        accessorFn: (r) => num(r.healthScore),
        header: ({ column }) => <SortHeader column={column} label="Health" />,
        cell: ({ row }) => (
          <span className={cn('font-medium tabular-nums', healthColor(num(row.original.healthScore)))}>
            {row.original.healthScore || '—'}
          </span>
        ),
      },
      {
        id: 'riskScore',
        accessorFn: (r) => num(r.riskScore),
        header: ({ column }) => <SortHeader column={column} label="Risk" />,
        cell: ({ row }) => (
          <span className={cn('font-medium tabular-nums', riskColor(num(row.original.riskScore)))}>
            {row.original.riskScore || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'hostingProvider',
        header: 'Hosting',
        cell: ({ row }) => (
          <span className="truncate text-muted-foreground">
            {row.original.hostingProvider || '—'}
          </span>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ row }) => (
          <span className="text-muted-foreground">{row.original.category || '—'}</span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _col, filter) => {
      const q = String(filter).toLowerCase();
      const r = row.original;
      return (
        r.domain.toLowerCase().includes(q) ||
        r.company.toLowerCase().includes(q) ||
        r.project.toLowerCase().includes(q) ||
        r.owner.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.tags.toLowerCase().includes(q) ||
        r.hostingProvider.toLowerCase().includes(q)
      );
    },
    initialState: { pagination: { pageSize: 25 } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead key={header.id} className="whitespace-nowrap">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No domains match your filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className="whitespace-nowrap">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {table.getFilteredRowModel().rows.length} domain(s) · page{' '}
          {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SortHeader({
  column,
  label,
}: {
  column: { toggleSorting: (desc?: boolean) => void; getIsSorted: () => false | 'asc' | 'desc' };
  label: string;
}) {
  return (
    <button
      className="inline-flex items-center gap-1 hover:text-foreground"
      onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-50" />
    </button>
  );
}
