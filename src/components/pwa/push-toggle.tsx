'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BellRing, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { disablePush, enablePush, pushState, type PushApi, type PushState } from '@/lib/push-client';

function usePush(api: PushApi) {
  const locale = useLocale() as 'fr' | 'en' | 'ar';
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    pushState().then((s) => { if (alive) setState(s); }).catch(() => { if (alive) setState('unsupported'); });
    return () => { alive = false; };
  }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    setError(false);
    try {
      setState(on ? await enablePush(api, locale) : await disablePush(api));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return { state, busy, error, toggle };
}

/** Settings row: "Notifications on this phone" with a switch. */
export function PushToggle({ api = '/api/push/subscription', className }: { api?: PushApi; className?: string }) {
  const t = useTranslations('push');
  const { state, busy, error, toggle } = usePush(api);
  if (state === null || state === 'unsupported') return null;
  const on = state === 'on';
  const hint = state === 'needs-install' ? t('needsInstall') : state === 'denied' ? t('denied') : t('hint');

  return (
    <section className={cn('flex items-center gap-4 rounded-[1.25rem] border border-border bg-background p-4 sm:p-5', className)}>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700">
        <BellRing className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p id="push-toggle-label" className="text-sm font-semibold">{t('title')}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        {error && <p role="alert" className="mt-1 text-xs text-destructive">{t('error')}</p>}
      </div>
      {(state === 'on' || state === 'off') && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="push-toggle-label"
          disabled={busy}
          onClick={() => void toggle(!on)}
          className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-primary' : 'bg-muted-foreground/30')}
        >
          <span className={cn('absolute top-0.5 size-6 rounded-full bg-white shadow transition-[inset-inline-start]', on ? 'start-[1.375rem]' : 'start-0.5')} />
        </button>
      )}
    </section>
  );
}

const DISMISS_KEY = 'metwork.pushPrompt.dismissedAt';
const QUIET_DAYS = 14;

/**
 * One-tap prompt on the dashboard home: shown while push is off on a device
 * that can get it, hidden for two weeks once dismissed.
 */
export function PushPrompt({ api = '/api/push/subscription' }: { api?: PushApi }) {
  const t = useTranslations('push');
  const { state, busy, error, toggle } = usePush(api);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      const at = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
      setDismissed(Date.now() - at < QUIET_DAYS * 86_400_000);
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed || state !== 'off') return null;

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setDismissed(true);
  }

  return (
    <section className="flex items-center gap-3 rounded-[1.25rem] border border-primary-200 bg-primary-50/50 p-3.5 dark:bg-primary/10">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <BellRing className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t('promptTitle')}</p>
        <p className="text-xs text-muted-foreground">{error ? t('error') : t('promptBody')}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle(true)}
        className="min-h-11 shrink-0 rounded-xl bg-primary px-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {t('enable')}
      </button>
      <button type="button" onClick={dismiss} aria-label={t('dismiss')} className="-me-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
        <X className="size-4" />
      </button>
    </section>
  );
}
