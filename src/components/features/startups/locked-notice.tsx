import { Lock } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

interface LockedNoticeProps {
  /** e.g. "Investor account required" */
  label: string;
  /** e.g. "Create an investor account" */
  cta: string;
  /** Tighter padding for grid cards vs. the full detail page. */
  compact?: boolean;
  className?: string;
}

/**
 * Blurred/locked placeholder shown in place of investor-only startup fields
 * on public pages — see DECISION FLAG 2. Always routes to investor signup.
 */
export function LockedNotice({ label, cta, compact, className }: LockedNoticeProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-dashed border-border/70 bg-muted/40',
        compact ? 'p-3' : 'p-5',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 flex select-none items-center justify-center gap-2 text-muted-foreground/20 blur-[2px]"
      >
        <span className="text-lg font-bold tracking-wider">●●● ●●,●●● ●●●</span>
      </div>
      <div className="relative flex flex-col items-center gap-1.5 text-center">
        <Lock className={compact ? 'size-3.5 text-muted-foreground' : 'size-4 text-muted-foreground'} />
        <p className={cn('font-medium text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>
          {label}
        </p>
        <Link
          href="/signup"
          className={cn(
            'font-semibold text-primary-600 underline-offset-2 hover:text-primary-700 hover:underline',
            compact ? 'text-[11px]' : 'text-xs',
          )}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
