import { cn } from '@/lib/utils';

interface NavBadgeProps {
  count: number;
  /** Localised accessible label, e.g. "3 nouvelles activités". */
  label: string;
  className?: string;
}

/**
 * Design-system nav activity badge: solid red circle, white numeral in
 * Space Grotesk, capped at "9+". Renders nothing for zero/negative counts,
 * so callers can pass counts unconditionally.
 */
export function NavBadge({ count, label, className }: NavBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={label}
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-red-600 px-1 font-grotesk text-[0.625rem] font-bold leading-none text-white',
        className,
      )}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
