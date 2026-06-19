'use client';

/**
 * Language switcher for the consultant portal. Lets a consultant change the UI
 * language at any time (signed in or out). Switching:
 *   • records the choice in a `metwork_consultant_locale` cookie so the portal
 *     stops forcing the French default for this browser, and
 *   • navigates to the same path under the new locale, preserving query params
 *     (e.g. a `?token=…` PIN link).
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Check, Globe } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/routing';
import { localeMetadata, locales } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { CP_GREEN } from './shared';

/** One-year cookie that records the consultant's explicit language choice. */
export const CONSULTANT_LOCALE_COOKIE = 'metwork_consultant_locale';

export function LanguageSwitcher({ className }: { className?: string }) {
  const locale = useLocale();
  const t = useTranslations('consultantPortal.nav');
  // next-intl usePathname() returns the path WITHOUT the locale prefix (e.g. "/consultant").
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  function pick(next: string) {
    setOpen(false);
    if (next === locale) return;
    // Record the explicit choice so the portal stops forcing the French default.
    document.cookie = `${CONSULTANT_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    // Use next-intl's router so it updates its own locale preference (NEXT_LOCALE)
    // atomically with the navigation — a plain location change gets pulled back to
    // the previous locale by the intl middleware. Query params (e.g. a PIN ?token=…)
    // are preserved.
    const query = Object.fromEntries(searchParams.entries());
    router.replace({ pathname, query }, { locale: next });
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-label={t('language')} aria-expanded={open}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <Globe className="size-4" />
        <span className="uppercase">{locale}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute end-0 z-50 mt-2 w-44 overflow-hidden rounded-2xl border border-white/10 bg-[#161616] p-1 shadow-xl shadow-black/40">
            {locales.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l} type="button" onClick={() => pick(l)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm transition-colors hover:bg-white/[0.06]',
                    active ? 'text-white' : 'text-white/70',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden>{localeMetadata[l].flag}</span>
                    {localeMetadata[l].nativeName}
                  </span>
                  {active && <Check className="size-4" style={{ color: CP_GREEN }} />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
