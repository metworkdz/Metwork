'use client';

/**
 * Shared building blocks for the consultant portal.
 *
 * Two surfaces share this file:
 *  - The dark auth flow (PIN unlock, email/OTP sign-in, phone verify) — near-black
 *    canvas (#0D0D0D), translucent white overlays. This is every primitive's
 *    *default* styling (no `tone` prop / `tone="dark"`), kept byte-for-byte as
 *    it was so those screens never change.
 *  - The consultant dashboard — now rendered in the SAME design system as the
 *    incubator dashboard: the shared semantic tokens (`bg-card`,
 *    `text-muted-foreground`, `border-border`, `bg-primary`), the shared
 *    `Button`, and the platform's 10px radius. Reached via an explicit
 *    `tone="light"` prop (or, for dashboard-only primitives the auth flow never
 *    imports, styled that way unconditionally).
 *
 * The light surface stays LIGHT whatever the app theme is: the portal root
 * carries `.portal-light`, which re-declares the light token values (see
 * `globals.css`). So the tokens buy consistency with the dashboard without
 * dragging the portal into dark mode.
 *
 * The CP_* constants below are now used ONLY by the dark auth screens. Nothing
 * on the light surface should reference them — that is what kept the two
 * dashboards looking like different products.
 *
 * Mobile-first, full-width bottom sheets for flows, fully RTL via logical
 * properties.
 */
import type { ReactNode } from 'react';
import Image from 'next/image';
import { ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** Exact brand tokens (the prompt's palette). */
export const CP_GREEN = '#30a735';
export const CP_BLACK = '#0D0D0D';
/** Soft brand glow for hero/feature surfaces (dark auth screens only). */
export const CP_GLOW = 'radial-gradient(120% 120% at 100% 0%, rgba(48,167,53,0.22) 0%, rgba(48,167,53,0.05) 35%, transparent 70%)';

/**
 * Light-surface tokens for the redesigned dashboard (brand system: Calendly-style
 * cards on a near-white canvas, #30a735 used as accent only — never a large fill).
 * Kept separate from the dark auth-flow tokens above so neither surface leaks
 * into the other.
 */
export const CP_LIGHT_BG = '#FAFAFA';
export const CP_LIGHT_TEXT = '#0D0D0D';
export const CP_LIGHT_MUTED = '#5A615E';
export const CP_LIGHT_FAINT = '#8A918E';
export const CP_LIGHT_BORDER = '#E3E6E4';
export const CP_LIGHT_SURFACE_MUTED = '#F7F8F9';
export const CP_GREEN_TEXT = '#1F7A2E';
export const CP_GREEN_TINT = '#E6F5EA';

export function fmtDZD(n: number): string {
  return `${Math.round(n).toLocaleString('fr-DZ')} DZD`;
}

/** Restrict an arbitrary locale string to the calendar/scheduler locales. */
export function calLocale(locale: string): 'en' | 'fr' | 'ar' {
  return locale === 'fr' || locale === 'ar' ? locale : 'en';
}

/**
 * The Metwork wordmark. `tone="dark"` (default) is the white mark for the
 * near-black auth screens — unchanged. `tone="light"` is the colored mark for
 * the redesigned white-canvas dashboard.
 */
export function AppLogo({
  height = 22, className, tone = 'dark',
}: { height?: number; className?: string; tone?: 'dark' | 'light' }) {
  const src = tone === 'light' ? '/assets/metworklogo.png' : '/assets/Metworkwhitelogo.png';
  const aspect = tone === 'light' ? 4.813 : 4.726;
  return (
    <Image
      src={src}
      alt="Metwork"
      width={Math.round(height * aspect)}
      height={height}
      priority
      className={cn('w-auto select-none', className)}
      style={{ height }}
    />
  );
}

/**
 * Initials avatar. `variant="tint"` (default) is the light gray chip used in
 * list rows; `variant="solid"` is the near-black chip used in the hero/profile
 * header. Dashboard-only — never rendered on the dark auth screens.
 */
export function Avatar({ name, size = 40, className, variant = 'tint' }: {
  name: string; size?: number; className?: string; variant?: 'tint' | 'solid';
}) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '·';
  return (
    <div
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold',
        // Same two chips as before, now from the shared tokens rather than
        // literals, so the portal's avatars sit in the dashboard's palette.
        variant === 'solid' ? 'bg-foreground text-background' : 'bg-muted text-foreground',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials}
    </div>
  );
}

/**
 * A branded primary CTA.
 *
 * `tone="light"` delegates to the platform's own `Button` — literally the
 * component every incubator dashboard screen uses, so the two can never drift
 * on hover, focus, disabled or radius.
 *
 * `tone="dark"` (the default) is the original green-gradient button on the
 * near-black auth screens, unchanged.
 */
export function BrandButton({
  children, className, loading, disabled, tone = 'dark', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; tone?: 'dark' | 'light' }) {
  if (tone === 'light') {
    return (
      <Button {...props} loading={loading} disabled={disabled} className={cn('gap-2', className)}>
        {children}
      </Button>
    );
  }
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold',
        'transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30a735]/60 focus-visible:ring-offset-2',
        'text-[#04130b] focus-visible:ring-offset-[#0D0D0D]',
        className,
      )}
      style={{ backgroundImage: 'linear-gradient(180deg,#3ac24a,#268a2b)', boxShadow: '0 10px 26px -10px rgba(48,167,53,0.6)' }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/**
 * Soft neutral / secondary button. `tone="light"` is the dashboard's outline
 * Button; `tone="dark"` (default) is unchanged for the auth screens.
 */
export function GhostButton({
  children, className, tone = 'dark', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'light' }) {
  if (tone === 'light') {
    return (
      <Button {...props} variant="outline" size="sm" className={cn('gap-1.5', className)}>
        {children}
      </Button>
    );
  }
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-base font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        'border-white/12 bg-white/[0.04] text-white/85 hover:bg-white/[0.08]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Standard portal surface card — the dashboard's card, same radius and rule. */
export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-4 lg:p-5', className)}>
      {children}
    </div>
  );
}

/** Section heading, typed like `DashboardPageHeader` on the incubator side. */
export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A field label + control wrapper for the light dashboard surface. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium leading-none">{label}</label>
      {children}
      {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A stat tile (earnings / wallet). */
export function StatTile({ label, value, accent, className }: { label: string; value: string; accent?: boolean; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-muted/30 p-4', className)}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold leading-tight tabular-nums', accent && 'text-primary')}>
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
      className={cn('group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-start transition-colors hover:bg-accent', className)}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {trailing}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
    </button>
  );
}

/**
 * Centered spinner block for loading states. `tone="dark"` (default) unchanged
 * for the auth screens; `tone="light"` for the dashboard.
 */
export function Spinner({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <div className={cn('flex items-center justify-center py-10', tone === 'light' ? 'text-muted-foreground' : 'text-white/40', className)}>
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

/**
 * POST a file to the consultant self-upload endpoint (session-guarded).
 * Shared by the profile editor and the signup CV step — one upload path.
 */
export async function uploadConsultantFile(file: File, kind: 'avatar' | 'cv'): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', kind);
  const res = await fetch('/api/consultant/upload', {
    method: 'POST',
    credentials: 'include',
    body: fd,
  });
  let data: unknown = null;
  try { data = await res.json(); } catch { /* handled below */ }
  if (!res.ok) {
    const errBody = data as { error?: { message?: string } } | null;
    throw new Error(errBody?.error?.message ?? `Upload failed (${res.status})`);
  }
  return (data as { url: string }).url;
}

/**
 * Inline error banner. `tone="dark"` (default) unchanged for the auth screens;
 * `tone="light"` for the dashboard.
 */
export function ErrorBanner({ message, tone = 'dark' }: { message: string; tone?: 'dark' | 'light' }) {
  return (
    <p role="alert" className={cn('rounded-md border px-3 py-2 text-xs',
      tone === 'light'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-red-500/25 bg-red-500/10 text-red-300')}>
      {message}
    </p>
  );
}

/** Empty-state block. Dashboard-only. */
export function EmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * A bottom-sheet shell for the portal's flows (Calendly-style). Light chrome,
 * rounds the top, and scrolls its body. The close affordance comes from
 * SheetContent (top-end ✕). Dashboard-only — never rendered on the dark auth
 * screens, so no forced `.dark` subtree here.
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
        className="portal-light mx-auto flex max-h-[94dvh] w-full max-w-xl flex-col gap-0 rounded-t-2xl border-x-0 border-t border-border bg-background p-0 text-foreground"
      >
        <div className="flex flex-col items-center px-5 pt-3">
          <span aria-hidden className="mb-3.5 h-1.5 w-11 rounded-full bg-border" />
          <h2 className="w-full pe-8 text-start text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t border-border px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

/** Shared input classes for the dark auth screens. 48px tall / 16px type — comfortable tap targets. */
export const cpInputClass =
  'flex h-12 w-full rounded-2xl border border-white/12 bg-white/[0.045] px-3.5 text-base text-white placeholder:text-white/35 ' +
  'transition-colors focus-visible:outline-none focus-visible:border-[#30a735]/50 focus-visible:ring-2 focus-visible:ring-[#30a735]/25 disabled:opacity-50';

/**
 * Light counterpart of {@link cpInputClass}. Matches the platform `Input`:
 * same border, radius and ring — but keeps the 48px height and 16px type,
 * because iOS zooms a focused field whose text is under 16px and the portal is
 * used on a phone far more than the dashboard is.
 */
export const cpInputClassLight =
  'flex h-12 w-full rounded-md border border-input bg-background px-3 text-base text-foreground placeholder:text-muted-foreground ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
