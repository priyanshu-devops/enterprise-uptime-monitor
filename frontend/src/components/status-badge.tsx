import { cn } from '@/lib/utils';
import { statusVisual, toneDot } from '@/lib/status';
import type { DomainStatus } from '@uptime/shared';

/** Status pill with a colored dot, driven by the shared status map. */
export function StatusBadge({
  status,
  className,
}: {
  status: DomainStatus | string;
  className?: string;
}) {
  const v = statusVisual(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium',
        v.className,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', toneDot(v.tone))} />
      {v.label}
    </span>
  );
}
