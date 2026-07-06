'use client';

/**
 * Shared building blocks for the consultant portal (PROMPT 4).
 *
 * A premium, Revolut/Airbnb-grade "app" surface: a near-black canvas (#0D0D0D)
 * with layered translucent cards, brand-green (#30a735) accents and glow, and
 * the Metwork white wordmark. Rendered inside a forced-`dark` subtree so every
 * shadcn primitive inherits cohesive dark chrome. Mobile-first, full-width
 * bottom sheets for flows, fully RTL via logical properties.
 */
import type { ReactNode } from 'react';
import Image from 'next/image';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Exact brand tokens (the prompt's palette). */
export const CP_GREEN = '#30a735';
export const CP_BLACK = '#0D0D0D';
/** Soft brand glow for hero/feature surfaces. */
export const CP_GLOW = 'radial-gradient(120% 120% at 100% 0%, rgba(48,167,53,0.22) 0%, rgba(48,167,53,0.05) 35%, transparent 70%)';

export function fmtDZD(n: number): string {
  return `${Math.round(n).toLocaleString('fr-DZ')} DZD`;
}

/** Restrict an arbitrary locale string to the calendar/scheduler locales. */
export function calLocale(locale: string): 'en' | 'fr' | 'ar' {
  return locale === 'fr' || locale === 'ar' ? locale : 'en';
}

/** The Metwork white wordmark, for dark surfaces. Natural aspect ≈ 4.726. */
export function AppLogo({ height = 22, className }: { height?: number; className?: string }) {
  return (
    <Image
      src="/assets/Metworkwhitelogo.png"
      alt="Metwork"
      width={Math.round(height * 4.726)}
      height={height}
      priority
      className={cn('w-auto select-none', className)}
      style={{ height }}
    />
  );
}

/** Initials avatar with a soft green tint. */
export function Avatar({ name, size = 40, className }: { name: string; size?: number; className?: string }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold', className)}
      style={{
        width: size, height: size, fontSize: size * 0.36, color: CP_GREEN,
        background: 'linear-gradient(135deg, rgba(48,167,53,0.28), rgba(48,167,53,0.07))',
        border: '1px solid rgba(48,167,53,0.22)',
      }}
    >
      {initials}
    </div>
  );
}

/** A branded primary CTA — green gradient + glow, no token conflict (ghost base). */
export function BrandButton({
  children, className, loading, disabled, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold',
        'text-[#04130b] transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30a735]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0D0D0D]',
        className,
      )}
      style={{ backgroundImage: 'linear-gradient(180deg,#3ac24a,#268a2b)', boxShadow: '0 10px 26px -10px rgba(48,167,53,0.6)' }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/** Soft neutral / secondary button on the dark surface. */
export function GhostButton({ children, className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 text-sm font-medium text-white/85',
        'transition-all hover:bg-white/[0.08] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Standard portal surface card. */
export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-3xl border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset]', className)}>
      {children}
    </div>
  );
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 px-1">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-white/45">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A field label + control wrapper for the dark surface. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium text-white/70">{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-white/40">{hint}</p>}
    </div>
  );
}

/** A stat tile (earnings / wallet). */
export function StatTile({ label, value, accent, className }: { label: string; value: string; accent?: boolean; className?: string }) {
  return (
    <div className={cn('rounded-2xl border border-white/[0.08] bg-white/[0.035] p-4', className)}>
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-tight tabular-nums" style={{ color: accent ? CP_GREEN : '#fff' }}>
        {value}
      </p>
    </div>
  );
}

/** A tappable row with optional leading node + trailing chevron. */
export function RowButton({ onClick, leading, title, subtitle, trailing, className }: {
  onClick: () => void; leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; className?: string;
}) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn('group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-white/[0.05] active:bg-white/[0.07]', className)}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-white">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-white/45">{subtitle}</div>}
      </div>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-white/25 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
    </button>
  );
}

/** Centered spinner block for loading states. */
export function Spinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-10 text-white/40', className)}>
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/** Inline error banner. */
export function ErrorBanner({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-2xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-xs text-red-300">
      {message}
    </p>
  );
}

/** Empty-state block. */
export function EmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-10 text-center text-sm text-white/45">
      {children}
    </div>
  );
}

/**
 * A bottom-sheet shell for the portal's flows (Revolut-style). Forces the dark
 * subtree, rounds the top, and scrolls its body. The close affordance comes
 * from SheetContent (top-end ✕).
 */
export function FlowSheet({
  open, onOpenChange, title, children, footer,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="dark mx-auto flex max-h-[94dvh] w-full max-w-xl flex-col gap-0 rounded-t-[28px] border-x-0 border-t border-white/10 bg-[#121212] p-0 text-white"
      >
        <div className="flex flex-col items-center px-5 pt-3">
          <span aria-hidden className="mb-3.5 h-1.5 w-11 rounded-full bg-white/15" />
          <h2 className="w-full pe-8 text-start text-[17px] font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-white/[0.08] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

/** Shared input classes for the dark branded surface. */
export const cpInputClass =
  'flex h-11 w-full rounded-2xl border border-white/12 bg-white/[0.045] px-3.5 text-sm text-white placeholder:text-white/35 ' +
  'transition-colors focus-visible:outline-none focus-visible:border-[#30a735]/50 focus-visible:ring-2 focus-visible:ring-[#30a735]/25 disabled:opacity-50';
