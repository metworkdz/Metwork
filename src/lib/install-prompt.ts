/**
 * Should we invite this person to install Metwork on their phone, and how?
 *
 * All of the decision lives here, as pure functions over a plain context
 * object — no `window`, no React — so every rule can be tested without a
 * browser. The hook that feeds it (`@/hooks/use-install-prompt`) is the only
 * part that touches browser APIs, and the card itself only renders.
 *
 * ── The two paths ───────────────────────────────────────────────────────
 *
 * ANDROID / CHROMIUM fires `beforeinstallprompt`. We keep that event and hand
 * it back when the person taps Install, which opens the real system sheet.
 * One tap, and the browser does the rest.
 *
 * IOS SAFARI exposes no install API at all — Apple does not provide one, and
 * no library changes that. The only honest option is to show the person where
 * the Share button is and what to pick. The steps are only offered in Safari:
 * Chrome and Firefox on iOS put "Add to Home Screen" somewhere else (or not at
 * all), so showing Safari's steps there would send someone hunting for a
 * button that is not on their screen.
 *
 * Everything else — desktop, a browser with no hook, a guest — gets nothing.
 */

/** How often to come back after someone says "later". */
export const REASK_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Waiting this long counts as "they have settled in" (see `settledIn`). */
export const SETTLE_DELAY_MS = 20_000;

/** …or this many page views in the session, whichever lands first. */
export const SETTLE_PAGE_VIEWS = 2;

/** Where the dismissal record lives. Per-device, never sent anywhere. */
export const DISMISSAL_KEY = 'metwork.installPrompt.dismissed';

export interface DismissalState {
  /** How many times they have waved it away. */
  count: number;
  /** Epoch ms of the most recent dismissal. */
  at: number;
}

export type InstallHiddenReason =
  | 'ALREADY_INSTALLED'
  | 'NOT_SIGNED_IN'
  | 'NOT_A_PHONE'
  | 'DISMISSED_RECENTLY'
  | 'NOT_SETTLED_IN'
  | 'NO_WAY_TO_INSTALL';

export type InstallDecision =
  | { kind: 'hidden'; reason: InstallHiddenReason }
  /** Chromium gave us the hook — tapping Install opens the system sheet. */
  | { kind: 'native' }
  /** iOS Safari — we can only show where the Share button is. */
  | { kind: 'ios-steps' };

export interface InstallContext {
  /** Only signed-in people are asked. A guest has not chosen the product yet. */
  signedIn: boolean;
  /** Phones only — a desktop install prompt is a different decision. */
  isPhone: boolean;
  /** Already running as an installed app. Never ask inside the app itself. */
  standalone: boolean;
  /** True once `beforeinstallprompt` has been captured. */
  hasNativeHook: boolean;
  /** iOS Safari specifically — not Chrome or Firefox on iOS. */
  isIosSafari: boolean;
  /** They have opened a second page, or been here ~20 seconds. */
  settledIn: boolean;
  dismissal: DismissalState | null;
  now: number;
}

/**
 * The single rule set. Order matters: the most decisive facts come first, so a
 * person already inside the installed app is never evaluated against anything
 * else.
 */
export function decideInstallPrompt(ctx: InstallContext): InstallDecision {
  if (ctx.standalone) return { kind: 'hidden', reason: 'ALREADY_INSTALLED' };
  if (!ctx.signedIn) return { kind: 'hidden', reason: 'NOT_SIGNED_IN' };
  if (!ctx.isPhone) return { kind: 'hidden', reason: 'NOT_A_PHONE' };

  if (ctx.dismissal && ctx.now - ctx.dismissal.at < REASK_AFTER_MS) {
    return { kind: 'hidden', reason: 'DISMISSED_RECENTLY' };
  }

  // Checked AFTER the dismissal rule so a returning visitor who is still
  // inside their quiet window is never put on a timer at all.
  if (!ctx.settledIn) return { kind: 'hidden', reason: 'NOT_SETTLED_IN' };

  // The hook is the definitive signal that a real install is possible — more
  // reliable than reading the user agent, and it is what makes the one-tap
  // path work. Chromium withholds it when the app is already installed.
  if (ctx.hasNativeHook) return { kind: 'native' };
  if (ctx.isIosSafari) return { kind: 'ios-steps' };

  return { kind: 'hidden', reason: 'NO_WAY_TO_INSTALL' };
}

/* ───────────────────────────── Platform reading ───────────────────────── */

export interface PlatformProbe {
  userAgent: string;
  /** `navigator.maxTouchPoints` — iPadOS 13+ reports a desktop UA. */
  maxTouchPoints: number;
  /** `navigator.platform`, still the only way to catch that iPad. */
  platform: string;
}

/** Any iOS device, including an iPad pretending to be a Mac. */
export function isIos(probe: PlatformProbe): boolean {
  if (/iPad|iPhone|iPod/.test(probe.userAgent)) return true;
  // iPadOS 13+ sends a Mac user agent; touch points give it away.
  return probe.platform === 'MacIntel' && probe.maxTouchPoints > 1;
}

/**
 * iOS Safari, and not one of the other browsers on iOS.
 *
 * Every iOS browser renders with WebKit, so the engine tells us nothing — the
 * vendor token in the user agent is the only signal. Chrome is `CriOS`,
 * Firefox `FxiOS`, Edge `EdgiOS`, Opera `OPiOS`, Brave `BraveiOS`.
 */
export function isIosSafari(probe: PlatformProbe): boolean {
  if (!isIos(probe)) return false;
  return !/CriOS|FxiOS|EdgiOS|OPiOS|BraveiOS|GSA/.test(probe.userAgent);
}

/* ──────────────────────────── Dismissal record ────────────────────────── */

/** Parse whatever is in storage, tolerating anything that is not ours. */
export function readDismissal(raw: string | null): DismissalState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DismissalState>;
    if (typeof parsed?.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    const count = typeof parsed.count === 'number' && parsed.count > 0 ? parsed.count : 1;
    return { count, at: parsed.at };
  } catch {
    // Corrupt or foreign value: treat as never dismissed rather than throwing
    // inside a render. The worst case is asking once more.
    return null;
  }
}

/** The record to store after a dismissal. */
export function nextDismissal(previous: DismissalState | null, now: number): DismissalState {
  return { count: (previous?.count ?? 0) + 1, at: now };
}

/** Has this session earned the prompt yet? */
export function settledIn(pageViews: number, msOnSite: number): boolean {
  return pageViews >= SETTLE_PAGE_VIEWS || msOnSite >= SETTLE_DELAY_MS;
}
