'use client';

/**
 * Language switcher for the consultant portal. The portal lives at the
 * non-localized `/mentordashboard` route, so the UI language is driven entirely
 * by the `metwork_consultant_locale` cookie (read by the mentordashboard layout
 * to pick messages + text direction). Switching records the cookie and reloads
 * so the layout re-resolves messages and `dir` for the new locale.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Globe } from 'lucide-react';
import { localeMetadata, locales } from '@/i18n/config';
import { cn } from '@/lib/utils';
import { CP_GREEN } from './shared';

/** One-year cookie that records the consultant's explicit language choice. */
export const CONSULTANT_LOCALE_COOKIE = 'metwork_consultant_locale';

export function LanguageSwitcher({ className, tone = 'dark' }: { className?: string; tone?: 'dark' | 'light' }) {
  const locale = useLocale();
  const t = useTranslations('consultantPortal.nav');
  const [open, setOpen] = useState(false);
  const light = tone === 'light';

  function pick(next: string) {
    setOpen(false);
    if (next === locale) return;
    // Record the explicit choice, then reload so the mentordashboard layout
    // re-reads the cookie and renders messages + `dir` for the new locale.
    document.cookie = `${CONSULTANT_LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button" onClick={() => setOpen((o) => !o)} aria-label={t('language')} aria-expanded={open}
        className={cn(
          'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
          light
            ? 'border-[#E3E6E4] bg-white text-[#5A615E] hover:bg-[#F7F8F9] hover:text-[#0D0D0D]'
            : 'border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.08] hover:text-white',
        )}
      >
        <Globe className="size-4" />
        <span className="uppercase">{locale}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className={cn(
            'absolute end-0 z-50 mt-2 w-44 overflow-hidden rounded-2xl border p-1 shadow-xl',
            light ? 'border-[#E3E6E4] bg-white shadow-black/10' : 'border-white/10 bg-[#161616] shadow-black/40',
          )}>
            {locales.map((l) => {
              const active = l === locale;
              return (
                <button
                  key={l} type="button" onClick={() => pick(l)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-start text-sm transition-colors',
                    light
                      ? cn('hover:bg-[#F7F8F9]', active ? 'text-[#0D0D0D]' : 'text-[#5A615E]')
                      : cn('hover:bg-white/[0.06]', active ? 'text-white' : 'text-white/70'),
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
