'use client';

/**
 * Browser wiring for the "add to home screen" card.
 *
 * Every rule lives in `@/lib/install-prompt`; this only reads the browser and
 * feeds it. Split that way because the rules are worth testing and the browser
 * APIs are not mockable in a node test run.
 *
 * The one genuinely awkward part is timing. `beforeinstallprompt` fires early
 * — routinely before React has hydrated — and it fires ONCE. A hook that only
 * starts listening in an effect will miss it on most loads, and the person
 * then sees nothing however long they stay. So a few lines in the document
 * head (see `InstallPromptCapture`) stash the event on a global the moment it
 * arrives, and this hook reads that global as well as listening, so it works
 * whichever order the two happen in.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DISMISSAL_KEY,
  SETTLE_DELAY_MS,
  decideInstallPrompt,
  isIosSafari,
  nextDismissal,
  readDismissal,
  settledIn,
  type DismissalState,
  type InstallDecision,
} from '@/lib/install-prompt';

/** The slice of `BeforeInstallPromptEvent` we use. Not in lib.dom yet. */
interface DeferredInstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    /** Set by the head script the instant the browser offers the hook. */
    __metworkInstallEvent?: DeferredInstallEvent | null;
  }
}

/** Counts page views for this tab, so "second page" survives client routing. */
const PAGE_VIEW_KEY = 'metwork.installPrompt.pageViews';

function bumpPageViews(): number {
  try {
    const next = Number(sessionStorage.getItem(PAGE_VIEW_KEY) ?? '0') + 1;
    sessionStorage.setItem(PAGE_VIEW_KEY, String(next));
    return next;
  } catch {
    // Private mode or storage disabled — fall back to the timer alone.
    return 1;
  }
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // Android / desktop report the display mode; iOS sets a flag on navigator.
  const byDisplayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const byIosFlag = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return byDisplayMode || byIosFlag;
}

export interface UseInstallPrompt {
  decision: InstallDecision;
  /** Chromium path: opens the real system sheet. Resolves once they answer. */
  install: () => Promise<void>;
  /** "Later" or ✕ — remembered on this device. */
  dismiss: () => void;
}

export function useInstallPrompt(signedIn: boolean): UseInstallPrompt {
  const [hasNativeHook, setHasNativeHook] = useState(false);
  const [isSettled, setIsSettled] = useState(false);
  const [dismissal, setDismissal] = useState<DismissalState | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isPhone, setIsPhone] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const mounted = useRef(false);

  // ── Read the environment once ──────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    setInstalled(isStandalone());
    setDismissal(readDismissal(safeGet(DISMISSAL_KEY)));
    setIosSafari(isIosSafari({
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      platform: navigator.platform,
    }));

    // "Phone" is a width question, not a user-agent one: what matters is that
    // the card has to sit above a bottom tab bar that only exists below `lg`.
    const phone = window.matchMedia('(max-width: 1023px) and (pointer: coarse)');
    const readPhone = () => setIsPhone(phone.matches);
    readPhone();
    phone.addEventListener('change', readPhone);
    return () => { phone.removeEventListener('change', readPhone); mounted.current = false; };
  }, []);

  // ── The install hook: whichever arrives first, the global or the event ──
  useEffect(() => {
    if (window.__metworkInstallEvent) setHasNativeHook(true);

    const onAvailable = () => setHasNativeHook(true);
    const onInstalled = () => {
      // Hide the card the moment the install lands, without a reload, and drop
      // the spent event so a second tap cannot reach a dead handle.
      window.__metworkInstallEvent = null;
      setHasNativeHook(false);
      setInstalled(true);
    };

    window.addEventListener('beforeinstallprompt', onAvailable);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onAvailable);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  // ── "Settled in": the second page, or twenty seconds ───────────────────
  useEffect(() => {
    const views = bumpPageViews();
    if (settledIn(views, 0)) { setIsSettled(true); return; }
    const timer = setTimeout(() => { if (mounted.current) setIsSettled(true); }, SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  const decision = decideInstallPrompt({
    signedIn,
    isPhone,
    standalone: installed,
    hasNativeHook,
    isIosSafari: iosSafari,
    settledIn: isSettled,
    dismissal,
    now: Date.now(),
  });

  const recordDismissal = useCallback(() => {
    const next = nextDismissal(readDismissal(safeGet(DISMISSAL_KEY)), Date.now());
    safeSet(DISMISSAL_KEY, JSON.stringify(next));
    setDismissal(next);
  }, []);

  const install = useCallback(async () => {
    const event = window.__metworkInstallEvent;
    if (!event) return;
    // A deferred event can only be prompted once; clear it first so a double
    // tap cannot call into a spent handle.
    window.__metworkInstallEvent = null;
    setHasNativeHook(false);
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      // Declining the SYSTEM sheet is still a "no". Record it, or the card
      // reappears on the next page as if nothing had been asked.
      if (outcome === 'dismissed') recordDismissal();
    } catch {
      // The browser refused to show it (spent event, or no gesture). Nothing
      // to tell the user — the card simply goes away.
    }
  }, [recordDismissal]);

  return { decision, install, dismiss: recordDismissal };
}

/* Storage can throw outright in private mode — never let that reach a render. */
function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* nothing to do */ }
}
