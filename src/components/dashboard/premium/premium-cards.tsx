import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Premium dashboard kit (freelancer + founder homes).
 *
 * Presentational server components — no hooks, no data. Pages pass
 * translated strings and formatted values. One deep-green hero per page,
 * white rounded-3xl surfaces under it, 44 px minimum tap targets.
 */

/** Deep-green hero card: eyebrow, big figure, a figures row and actions. */
export function PremiumHero({
  eyebrow,
  badge,
  value,
  unit,
  figures,
  children,
}: {
  eyebrow: string;
  badge?: string;
  value: ReactNode;
  unit?: string;
  figures?: { label: string; value: string }[];
  children?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5 rounded-3xl bg-[#0E3B1E] p-5 text-white shadow-[0_14px_34px_rgba(14,59,30,0.22)] sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[0.8125rem] text-[#B9DDC3]">{eyebrow}</p>
        {badge && <span className="shrink-0 rounded-full bg-primary px-2.5 py-1 text-[0.6875rem] font-semibold">{badge}</span>}
      </div>
      <p className="font-display text-[2rem] font-extrabold leading-none tracking-tight tabular-nums sm:text-4xl">
        {value}
        {unit && <span className="ms-1.5 text-lg font-bold text-[#B9DDC3]">{unit}</span>}
      </p>
      {figures && figures.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[#B9DDC3]">
          {figures.map((f) => (
            <span key={f.label}>
              {f.label} <b className="font-semibold text-white tabular-nums">{f.value}</b>
            </span>
          ))}
        </div>
      )}
      {children}
    </section>
  );
}

/** Action row inside the hero: the first action is the primary one. */
export function HeroActions({ actions }: { actions: { label: string; href: string; icon?: LucideIcon }[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${actions.length}, minmax(0, 1fr))` }}>
      {actions.map((a, i) => {
        const Icon = a.icon;
        return (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-2 text-center text-xs font-semibold text-white transition-colors',
              i === 0 ? 'bg-primary hover:bg-primary/90' : 'bg-[#194B2A] hover:bg-[#1F5A33]',
            )}
          >
            {Icon && <Icon className="size-4 shrink-0" />}
            <span className="line-clamp-2">{a.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

/** Row card with a leading tile (J-12, icon…), title, meta and a chevron. */
export function PremiumRowCard({
  href,
  lead,
  leadTone = 'primary',
  title,
  meta,
  className,
}: {
  href: string;
  lead: ReactNode;
  leadTone?: 'primary' | 'amber' | 'danger';
  title: string;
  meta?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex min-h-16 items-center gap-3 rounded-[1.25rem] border border-border bg-background px-4 py-3.5 transition-colors hover:bg-muted/40',
        leadTone === 'danger' && 'border-destructive/50',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-xl font-display text-[0.8125rem] font-extrabold',
          leadTone === 'primary' && 'bg-primary-50 text-primary-700',
          leadTone === 'amber' && 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
          leadTone === 'danger' && 'bg-destructive/10 text-destructive',
        )}
      >
        {lead}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{title}</span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" />
    </Link>
  );
}

/** Section heading with an optional "see all" link. */
export function PremiumSection({
  title,
  actionLabel,
  actionHref,
  children,
}: {
  title: string;
  actionLabel?: string;
  actionHref?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-base font-bold">{title}</h2>
        {actionLabel && actionHref && (
          <Link href={actionHref} className="text-[0.8125rem] font-semibold text-primary hover:underline">
            {actionLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** White rounded surface. */
export function PremiumSurface({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-[1.25rem] border border-border bg-background', className)}>{children}</div>;
}

/** Small figure tile; `progress` (0–1) draws a bar under the value. */
export function PremiumStat({
  label,
  value,
  hint,
  hintTone,
  progress,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'danger' | 'warning';
  progress?: number;
  href?: string;
}) {
  const body = (
    <>
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-display text-lg font-bold tabular-nums">{value}</p>
      {progress !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className={cn('h-full rounded-full', progress >= 0.95 ? 'bg-destructive' : progress >= 0.8 ? 'bg-amber-500' : 'bg-primary')}
            style={{ width: `${Math.min(100, Math.max(2, progress * 100))}%` }}
          />
        </div>
      )}
      {hint && (
        <p
          className={cn(
            'mt-1.5 line-clamp-2 text-[0.6875rem]',
            hintTone === 'danger' ? 'font-semibold text-destructive' : hintTone === 'warning' ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {hint}
        </p>
      )}
    </>
  );
  const cls = 'block min-w-0 rounded-[1.25rem] border border-border bg-background p-3.5 sm:p-4';
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:bg-muted/40')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Order progress card: title, party · number, status pill, bar, footer. */
export function PremiumOrderCard({
  href,
  title,
  meta,
  status,
  statusTone,
  progress,
  footer,
}: {
  href: string;
  title: string;
  meta: string;
  status: string;
  statusTone: 'primary' | 'amber' | 'muted';
  progress: number;
  footer: string;
}) {
  return (
    <Link href={href} className="flex flex-col gap-2.5 rounded-[1.25rem] border border-border bg-background px-4 py-3.5 transition-colors hover:bg-muted/40">
      <div className="flex justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold" dir="auto">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{meta}</span>
        </span>
        <span
          className={cn(
            'h-fit shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold',
            statusTone === 'primary' && 'bg-primary-50 text-primary-700',
            statusTone === 'amber' && 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
            statusTone === 'muted' && 'bg-muted text-muted-foreground',
          )}
        >
          {status}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, progress * 100)}%` }} />
      </div>
      <p className="truncate text-xs text-muted-foreground">{footer}</p>
    </Link>
  );
}
