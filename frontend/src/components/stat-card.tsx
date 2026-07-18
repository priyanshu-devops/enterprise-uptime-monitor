import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Compact KPI stat card used on the dashboard and analytics pages. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  loading = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'primary';
  loading?: boolean;
}) {
  const toneText =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'destructive'
          ? 'text-destructive'
          : tone === 'primary'
            ? 'text-primary'
            : 'text-foreground';

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className={cn('h-4 w-4', toneText)} />}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-20" />
      ) : (
        <div className={cn('mt-1 text-2xl font-semibold tabular-nums', toneText)}>{value}</div>
      )}
      {hint && !loading && <p className="mt-1 text-2xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
