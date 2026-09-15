'use client';

/**
 * "Add Metwork to your home screen" — the card, and the iPhone steps.
 *
 * Renders nothing unless `useInstallPrompt` says to: signed in, on a phone, in
 * a browser rather than the installed app, past the quiet window, and with a
 * way to install. All of that is decided in `@/lib/install-prompt`; this file
 * only draws.
 *
 * LAYOUT NOTE. Both surfaces that mount this have a fixed bottom tab bar, and
 * the two bars are NOT the same height. The card measures whichever one is on
 * the page rather than assuming — see `useBottomNavOffset`.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Share, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useInstallPrompt } from '@/hooks/use-install-prompt';

/** Breathing room between the card and whatever sits under it. */
const GAP_PX = 12;

/**
 * How high the card has to float to clear the bottom navigation.
 *
 * MEASURED, not hardcoded: the dashboard's tab bar is 3.25rem tall and the
 * consultant portal's is noticeably taller, so a single magic number overlaps
 * one of them — it overlapped the portal's by 4px before this. Both bars carry
 * `data-app-bottom-nav`, and their measured height already includes the iOS
 * safe-area padding, so this is the whole calculation.
 */
function useBottomNavOffset(): number {
  const [offset, setOffset] = useState(GAP_PX);

  useEffect(() => {
    const bar = document.querySelector<HTMLElement>('[data-app-bottom-nav]');
    if (!bar) return;                       // a surface with no bottom nav
    const measure = () => setOffset(bar.getBoundingClientRect().height + GAP_PX);
    measure();
    // Keeps up with a bar that changes height — rotation, a badge wrapping.
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  return offset;
}

export function InstallAppPrompt({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations('installPrompt');
  const { decision, install, dismiss } = useInstallPrompt(signedIn);
  const [showSteps, setShowSteps] = useState(false);
  const bottom = useBottomNavOffset();

  if (decision.kind === 'hidden') return null;

  const isIos = decision.kind === 'ios-steps';

  return (
    <>
      <div
        role="dialog"
        aria-label={t('title')}
        style={{ bottom }}
        className="fixed inset-x-3 z-50 rounded-lg border border-border bg-card p-3.5 shadow-lg lg:hidden"
      >
        <button
          type="button"
          onClick={dismiss}
          aria-label={t('dismiss')}
          className="absolute end-2 top-2 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex items-start gap-3 pe-7">
          {/* The app's own icon — this is what will sit on their home screen. */}
          <img
            src="/icons/icon-192.png"
            alt=""
            width={40}
            height={40}
            className="size-10 shrink-0 rounded-[10px] border border-border"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{t('title')}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t('body')}</p>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" onClick={dismiss}>
            {t('later')}
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => { if (isIos) setShowSteps(true); else void install(); }}
          >
            {t('install')}
          </Button>
        </div>
      </div>

      {isIos && showSteps && (
        <IosSteps onClose={() => { setShowSteps(false); dismiss(); }} />
      )}
    </>
  );
}

/**
 * iOS has no install API, so this is the whole of the iPhone path: show where
 * the Share button is and what to pick.
 *
 * The Share button lives in the BOTTOM toolbar on modern iOS Safari. Most
 * guides still point at the top, which is where it was years ago — sending
 * someone to the wrong corner of their screen is worse than not asking.
 */
function IosSteps({ onClose }: { onClose: () => void }) {
  const t = useTranslations('installPrompt.ios');

  const steps = [
    { n: 1, text: t('step1'), icon: <Share className="size-3.5" /> },
    { n: 2, text: t('step2'), icon: <Plus className="size-3.5" /> },
    { n: 3, text: t('step3'), icon: null },
  ];

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button
        type="button"
        aria-label={t('close')}
        onClick={onClose}
        className="absolute inset-0 bg-foreground/40"
      />
      <div className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-lg">
        <span aria-hidden className="mx-auto mb-4 block h-1.5 w-11 rounded-full bg-border" />
        <h2 className="text-base font-semibold tracking-tight">{t('title')}</h2>

        <ol className="mt-4 space-y-3">
          {steps.map(({ n, text, icon }) => (
            <li key={n} className="flex items-start gap-3 text-sm leading-relaxed">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-50 text-xs font-bold text-primary-700">
                {n}
              </span>
              <span className="min-w-0">
                {icon && (
                  <span className="me-1.5 inline-grid size-5 place-items-center rounded bg-muted align-[-4px] text-foreground">
                    {icon}
                  </span>
                )}
                {text}
              </span>
            </li>
          ))}
        </ol>

        {/* Points at the real toolbar, which is directly below this sheet. */}
        <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t('hint')}
        </p>

        <Button variant="outline" className="mt-4 w-full" onClick={onClose}>
          {t('close')}
        </Button>
      </div>
    </div>
  );
}
