'use client';

/**
 * Shared building blocks for the consultant portal.
 *
 * Two surfaces share this file:
 *  - The dark auth flow (PIN unlock, email/OTP sign-in, phone verify) — near-black
 *    canvas (#0D0D0D), translucent white overlays. This is every primitive's
 *    *default* styling (no `tone` prop / `tone="dark"`), kept byte-for-byte as
 *    it was so those screens never change.
 *  - The redesigned dashboard — a light, Calendly-style canvas (#FAFAFA) with
 *    white bordered cards and #30a735 used as an accent only. Reached via an
 *    explicit `tone="light"` prop (or, for dashboard-only primitives that the
 *    auth flow never imports, styled light unconditionally).
 *
 * Mobile-first, full-width bottom sheets for flows, fully RTL via logical
 * properties.
 */
import type { ReactNode } from 'react';
import Image from 'next/image';
import { ChevronRight, Loader2 } from 'lucide-react';
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
  const style = variant === 'solid'
    ? { background: CP_BLACK, color: '#FFFFFF' }
    : { background: '#EFEFEF', color: '#2A2F2C' };
  return (
    <div
      className={cn('grid shrink-0 place-items-center rounded-full font-semibold', className)}
      style={{ width: size, height: size, fontSize: size * 0.36, ...style }}
    >
      {initials}
    </div>
  );
}

/**
 * A branded primary CTA. `tone="dark"` (default) is the original green-gradient
 * button used on the near-black auth screens — unchanged. `tone="light"` is the
 * solid `#30a735` fill with white text used on the redesigned white-canvas
 * dashboard.
 */
export function BrandButton({
  children, className, loading, disabled, tone = 'dark', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean; tone?: 'dark' | 'light' }) {
  const light = tone === 'light';
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-4 text-base font-semibold',
        'transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#30a735]/60 focus-visible:ring-offset-2',
        light ? 'text-white focus-visible:ring-offset-white' : 'text-[#04130b] focus-visible:ring-offset-[#0D0D0D]',
        className,
      )}
      style={light
        ? { backgroundColor: CP_GREEN, boxShadow: '0 10px 24px -14px rgba(48,167,53,0.7)' }
        : { backgroundImage: 'linear-gradient(180deg,#3ac24a,#268a2b)', boxShadow: '0 10px 26px -10px rgba(48,167,53,0.6)' }}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

/**
 * Soft neutral / secondary button. `tone="dark"` (default) unchanged for the
 * auth screens; `tone="light"` is a bordered white button for the dashboard.
 */
export function GhostButton({
  children, className, tone = 'dark', ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'dark' | 'light' }) {
  const light = tone === 'light';
  return (
    <button
      {...props}
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-4 text-base font-medium transition-all active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none',
        light
          ? 'border-[#E3E6E4] bg-white text-[#0D0D0D] hover:bg-[#F7F8F9]'
          : 'border-white/12 bg-white/[0.04] text-white/85 hover:bg-white/[0.08]',
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Standard portal surface card — light Calendly-style card. Dashboard-only. */
export function SectionCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-3xl border p-4', className)}
      style={{ borderColor: CP_LIGHT_BORDER, background: '#FFFFFF', boxShadow: '0 1px 2px rgba(13,13,13,0.04)' }}>
      {children}
    </div>
  );
}

export function SectionHeading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3 px-1">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight" style={{ color: CP_LIGHT_TEXT }}>{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs leading-relaxed" style={{ color: CP_LIGHT_MUTED }}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A field label + control wrapper for the light dashboard surface. */
export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium" style={{ color: CP_LIGHT_MUTED }}>{label}</label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed" style={{ color: CP_LIGHT_FAINT }}>{hint}</p>}
    </div>
  );
}

/** A stat tile (earnings / wallet). */
export function StatTile({ label, value, accent, className }: { label: string; value: string; accent?: boolean; className?: string }) {
  return (
    <div className={cn('rounded-2xl p-4', className)} style={{ background: CP_LIGHT_SURFACE_MUTED }}>
      <p className="text-[11px] uppercase tracking-wide" style={{ color: CP_LIGHT_MUTED }}>{label}</p>
      <p className="mt-1 text-[22px] font-bold leading-tight tabular-nums" style={{ color: accent ? CP_GREEN_TEXT : CP_LIGHT_TEXT }}>
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
      className={cn('group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-start transition-colors hover:bg-[#F7F8F9] active:bg-[#F0F1F2]', className)}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium" style={{ color: CP_LIGHT_TEXT }}>{title}</div>
        {subtitle && <div className="mt-0.5 truncate text-xs" style={{ color: CP_LIGHT_MUTED }}>{subtitle}</div>}
      </div>
      {trailing}
      <ChevronRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" style={{ color: CP_LIGHT_FAINT }} />
    </button>
  );
}

/**
 * Centered spinner block for loading states. `tone="dark"` (default) unchanged
 * for the auth screens; `tone="light"` for the dashboard.
 */
export function Spinner({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  return (
    <div className={cn('flex items-center justify-center py-10', tone === 'light' ? 'text-[#8A918E]' : 'text-white/40', className)}>
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
    <p role="alert" className={cn('rounded-2xl border px-3.5 py-2.5 text-xs',
      tone === 'light' ? 'border-red-200 bg-red-50 text-red-700' : 'border-red-500/25 bg-red-500/10 text-red-300')}>
      {message}
    </p>
  );
}

/** Empty-state block. Dashboard-only. */
export function EmptyBlock({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed px-4 py-10 text-center text-sm"
      style={{ borderColor: '#D1D6D3', color: CP_LIGHT_MUTED }}>
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
        className="mx-auto flex max-h-[94dvh] w-full max-w-xl flex-col gap-0 rounded-t-[28px] border-x-0 border-t bg-white p-0"
        style={{ borderColor: CP_LIGHT_BORDER, color: CP_LIGHT_TEXT }}
      >
        <div className="flex flex-col items-center px-5 pt-3">
          <span aria-hidden className="mb-3.5 h-1.5 w-11 rounded-full" style={{ background: CP_LIGHT_BORDER }} />
          <h2 className="w-full pe-8 text-start text-[17px] font-semibold tracking-tight">{title}</h2>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="border-t px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3" style={{ borderColor: CP_LIGHT_BORDER }}>{footer}</div>}
      </SheetContent>
    </Sheet>
  );
}

/** Shared input classes for the dark auth screens. 48px tall / 16px type — comfortable tap targets. */
export const cpInputClass =
  'flex h-12 w-full rounded-2xl border border-white/12 bg-white/[0.045] px-3.5 text-base text-white placeholder:text-white/35 ' +
  'transition-colors focus-visible:outline-none focus-visible:border-[#30a735]/50 focus-visible:ring-2 focus-visible:ring-[#30a735]/25 disabled:opacity-50';

/** Light counterpart of {@link cpInputClass} for the redesigned dashboard. */
export const cpInputClassLight =
  'flex h-12 w-full rounded-2xl border border-[#E3E6E4] bg-white px-3.5 text-base text-[#0D0D0D] placeholder:text-[#8A918E] ' +
  'transition-colors focus-visible:outline-none focus-visible:border-[#30a735]/60 focus-visible:ring-2 focus-visible:ring-[#30a735]/20 disabled:opacity-50';
