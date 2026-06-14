import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Mobile-only dashboard UI kit (rendered inside `lg:hidden` blocks).
 *
 * Presentational server components — no hooks, no data fetching. Pages pass
 * already-translated strings + values so these stay framework-light and the
 * desktop tree is never touched. Revolut-like calm density: rounded-2xl
 * surfaces, soft borders, compact type scale, no gradients.
 */

type Tone = 'primary' | 'gold' | 'platinum' | 'blue' | 'amber';

const toneClasses: Record<Tone, string> = {
  primary: 'bg-primary-50 text-primary-600',
  gold: 'bg-gold-50 text-gold-600',
  platinum: 'bg-platinum-100 text-platinum-700',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
};

/* ── Greeting ─────────────────────────────────────────────────────────── */

export function MobileGreeting({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-0.5 truncate text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

/* ── Quick actions (horizontal pill row) ──────────────────────────────── */

export interface MobileAction {
  label: string;
  href: string;
  icon?: LucideIcon;
}

export function MobileQuickActions({ actions }: { actions: MobileAction[] }) {
  if (actions.length === 0) return null;
  return (
    <div className="-mx-4 mb-5 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max gap-2">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.href + a.label}
              href={a.href}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-sm transition-colors active:bg-accent"
            >
              {Icon && <Icon className="size-4 text-primary-600" />}
              {a.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Compact 2-column stat grid ───────────────────────────────────────── */

export interface MobileStat {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: Tone;
}

export function MobileStatGrid({ stats }: { stats: MobileStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {stats.map((s, i) => {
        const Icon = s.icon;
        return (
          <div
            key={`${s.label}-${i}`}
            className="relative overflow-hidden rounded-2xl border border-border bg-card p-3.5 shadow-sm"
          >
            {Icon && (
              <span
                className={cn(
                  'absolute end-3 top-3 flex size-7 items-center justify-center rounded-lg',
                  toneClasses[s.tone ?? 'primary'],
                )}
              >
                <Icon className="size-4" />
              </span>
            )}
            <p className="pe-9 text-xs font-medium text-muted-foreground">{s.label}</p>
            <p className="mt-1.5 truncate text-2xl font-semibold tracking-tight">{s.value}</p>
            {s.hint && (
              <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">{s.hint}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Section + tight list rows ────────────────────────────────────────── */

export function MobileSection({
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
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {actionLabel && actionHref && (
          <Link href={actionHref} className="text-xs font-medium text-primary-600">
            {actionLabel}
          </Link>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {children}
      </div>
    </section>
  );
}

export function MobileListRow({
  icon: Icon,
  tone = 'primary',
  title,
  meta,
  trailing,
  href,
}: {
  icon?: LucideIcon;
  tone?: Tone;
  title: string;
  meta?: string;
  trailing?: ReactNode;
  href?: string;
}) {
  const inner = (
    <>
      {Icon && (
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl',
            toneClasses[tone],
          )}
        >
          <Icon className="size-[1.125rem]" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {trailing && <span className="shrink-0 text-sm font-medium">{trailing}</span>}
      {href && <ChevronRight className="size-4 shrink-0 text-muted-foreground/40 rtl:rotate-180" />}
    </>
  );

  const rowClass =
    'flex items-center gap-3 px-3.5 py-3 transition-colors [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border';

  if (href) {
    return (
      <Link href={href} className={cn(rowClass, 'active:bg-accent')}>
        {inner}
      </Link>
    );
  }
  return <div className={rowClass}>{inner}</div>;
}

export function MobileEmpty({ icon: Icon, text }: { icon?: LucideIcon; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
      {Icon && <Icon className="size-6 text-muted-foreground/50" />}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
