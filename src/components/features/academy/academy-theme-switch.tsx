'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  ACADEMY_THEME_ROOT_ATTR,
  ACADEMY_THEME_STORAGE_KEY,
  isThemePref,
  type AcademyThemePref,
} from '@/lib/academy-theme';
import { cn } from '@/lib/utils';

function root(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${ACADEMY_THEME_ROOT_ATTR}]`);
}

function apply(pref: AcademyThemePref) {
  const el = root();
  if (!el) return;
  const dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
  el.setAttribute('data-theme-pref', pref);
}

const OPTIONS: { pref: AcademyThemePref; Icon: typeof Sun }[] = [
  { pref: 'light', Icon: Sun },
  { pref: 'system', Icon: Monitor },
  { pref: 'dark', Icon: Moon },
];

/**
 * Light / auto / dark. Auto follows the phone or computer and is the default.
 * `compact` is one button that cycles through the three (phone header).
 */
export function AcademyThemeSwitch({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations('academy.theme');
  // Read the choice the inline bootstrap already applied, after mount (no SSR mismatch).
  const [pref, setPref] = useState<AcademyThemePref>('system');

  useEffect(() => {
    const current = root()?.getAttribute('data-theme-pref');
    if (isThemePref(current)) setPref(current);
  }, []);

  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  function choose(next: AcademyThemePref) {
    setPref(next);
    try {
      if (next === 'system') localStorage.removeItem(ACADEMY_THEME_STORAGE_KEY);
      else localStorage.setItem(ACADEMY_THEME_STORAGE_KEY, next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    apply(next);
  }

  if (compact) {
    const order: AcademyThemePref[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(pref) + 1) % order.length]!;
    const Icon = OPTIONS.find((o) => o.pref === pref)!.Icon;
    return (
      <button
        type="button"
        onClick={() => choose(next)}
        aria-label={`${t('label')}: ${t(pref)}`}
        className={cn(
          'inline-flex size-9 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground',
          'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
      >
        <Icon className="size-4" aria-hidden />
      </button>
    );
  }

  return (
    <div role="radiogroup" aria-label={t('label')} className={cn('inline-flex items-center rounded-lg border border-border bg-background p-0.5', className)}>
      {OPTIONS.map(({ pref: p, Icon }) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={pref === p}
          title={t(p)}
          onClick={() => choose(p)}
          className={cn(
            'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            pref === p && 'bg-primary text-primary-foreground hover:text-primary-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{t(p)}</span>
        </button>
      ))}
    </div>
  );
}
