import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Five stars filled to `value` (0–5, halves rounded down). Hook-free: usable from server and client. */
export function Stars({ value, className, label }: { value: number; className?: string; label?: string }) {
  const full = Math.floor(value);
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-amber-500', className)} role="img" aria-label={label}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} className={cn('size-4', i < full ? 'fill-current' : 'fill-transparent text-muted-foreground/40')} aria-hidden />
      ))}
    </span>
  );
}
