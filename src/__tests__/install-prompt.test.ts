/**
 * When Metwork asks to be installed — and, mostly, when it does not.
 *
 * The whole value of a prompt like this is the silence around it: shown to the
 * wrong person it is an ad, and shown inside the installed app it is a bug the
 * user can see. Every rule is pure, so all of it is testable without a
 * browser; `use-install-prompt` only feeds these functions.
 *
 * The iOS cases carry the most weight. Apple exposes no install API, so the
 * iPhone path is a set of instructions — and instructions are only correct in
 * Safari. Offering Safari's steps inside Chrome on iOS sends someone hunting
 * for a button that is not on their screen, which is worse than staying quiet.
 */
import { describe, it, expect } from 'vitest';

import {
  REASK_AFTER_MS,
  SETTLE_DELAY_MS,
  decideInstallPrompt,
  isIos,
  isIosSafari,
  nextDismissal,
  readDismissal,
  settledIn,
  type InstallContext,
} from '@/lib/install-prompt';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');

/** Someone who should be asked: signed in, on a phone, settled, Android. */
function ready(over: Partial<InstallContext> = {}): InstallContext {
  return {
    signedIn: true,
    isPhone: true,
    standalone: false,
    hasNativeHook: true,
    isIosSafari: false,
    settledIn: true,
    dismissal: null,
    now: NOW,
    ...over,
  };
}

describe('who gets asked', () => {
  it('offers the one-tap install when the browser gave us the hook', () => {
    expect(decideInstallPrompt(ready())).toEqual({ kind: 'native' });
  });

  it('offers the iPhone steps in Safari, where there is no install API', () => {
    expect(decideInstallPrompt(ready({ hasNativeHook: false, isIosSafari: true })))
      .toEqual({ kind: 'ios-steps' });
  });

  it('prefers the real install over instructions when both could apply', () => {
    // A browser that offers the hook can install properly; never send someone
    // through a manual flow they do not need.
    expect(decideInstallPrompt(ready({ hasNativeHook: true, isIosSafari: true })))
      .toEqual({ kind: 'native' });
  });
});

describe('who is left alone', () => {
  it('says nothing inside the installed app — the bug users can see', () => {
    expect(decideInstallPrompt(ready({ standalone: true })))
      .toEqual({ kind: 'hidden', reason: 'ALREADY_INSTALLED' });
  });

  it('outranks every other rule with "already installed"', () => {
    // Even a signed-out desktop visitor inside the app must not be evaluated
    // further — this is the fact that ends the question.
    const inApp = decideInstallPrompt(ready({ standalone: true, signedIn: false, isPhone: false }));
    expect(inApp).toEqual({ kind: 'hidden', reason: 'ALREADY_INSTALLED' });
  });

  it('never asks a guest', () => {
    expect(decideInstallPrompt(ready({ signedIn: false })))
      .toEqual({ kind: 'hidden', reason: 'NOT_SIGNED_IN' });
  });

  it('never asks on desktop', () => {
    expect(decideInstallPrompt(ready({ isPhone: false })))
      .toEqual({ kind: 'hidden', reason: 'NOT_A_PHONE' });
  });

  it('stays quiet in a browser with no way to install', () => {
    // Firefox on Android, Chrome on iOS, an in-app webview: no hook, not
    // Safari. Showing a card that cannot lead anywhere is worse than nothing.
    expect(decideInstallPrompt(ready({ hasNativeHook: false, isIosSafari: false })))
      .toEqual({ kind: 'hidden', reason: 'NO_WAY_TO_INSTALL' });
  });

  it('waits until they have settled in', () => {
    expect(decideInstallPrompt(ready({ settledIn: false })))
      .toEqual({ kind: 'hidden', reason: 'NOT_SETTLED_IN' });
  });
});

describe('after they say "later"', () => {
  it('goes quiet for a week', () => {
    const justNow = { count: 1, at: NOW - 60_000 };
    expect(decideInstallPrompt(ready({ dismissal: justNow })))
      .toEqual({ kind: 'hidden', reason: 'DISMISSED_RECENTLY' });
  });

  it('asks again once the week is up', () => {
    const lastWeek = { count: 1, at: NOW - REASK_AFTER_MS - 1 };
    expect(decideInstallPrompt(ready({ dismissal: lastWeek }))).toEqual({ kind: 'native' });
  });

  it('keeps asking however many times they decline', () => {
    // The chosen policy: weekly, indefinitely. A tenth dismissal is treated
    // exactly like the first — this test is here so that stays a decision
    // somebody made, not something that drifts.
    const declinedTenTimes = { count: 10, at: NOW - REASK_AFTER_MS - 1 };
    expect(decideInstallPrompt(ready({ dismissal: declinedTenTimes }))).toEqual({ kind: 'native' });
  });

  it('counts the dismissals it has seen', () => {
    expect(nextDismissal(null, NOW)).toEqual({ count: 1, at: NOW });
    expect(nextDismissal({ count: 2, at: 0 }, NOW)).toEqual({ count: 3, at: NOW });
  });

  it('checks the quiet window before the settle timer', () => {
    // Someone inside their week is never put on a timer at all. Rule ORDER is
    // what makes that true, so it gets its own test.
    expect(decideInstallPrompt(ready({ dismissal: { count: 1, at: NOW }, settledIn: false })))
      .toEqual({ kind: 'hidden', reason: 'DISMISSED_RECENTLY' });
  });
});

describe('reading the stored dismissal', () => {
  it('reads what it wrote', () => {
    const stored = JSON.stringify(nextDismissal(null, NOW));
    expect(readDismissal(stored)).toEqual({ count: 1, at: NOW });
  });

  it('treats nothing, rubbish and foreign values as never dismissed', () => {
    // A throw here would land inside a render, so it never throws.
    expect(readDismissal(null)).toBeNull();
    expect(readDismissal('')).toBeNull();
    expect(readDismissal('not json at all')).toBeNull();
    expect(readDismissal('{"at":"yesterday"}')).toBeNull();
    expect(readDismissal('{"something":"else"}')).toBeNull();
  });

  it('repairs a record with a usable timestamp but no count', () => {
    expect(readDismissal('{"at":123}')).toEqual({ count: 1, at: 123 });
  });
});

describe('settling in', () => {
  it('counts the second page as settled', () => {
    expect(settledIn(1, 0)).toBe(false);
    expect(settledIn(2, 0)).toBe(true);
  });

  it('counts twenty seconds on one page as settled', () => {
    expect(settledIn(1, SETTLE_DELAY_MS - 1)).toBe(false);
    expect(settledIn(1, SETTLE_DELAY_MS)).toBe(true);
  });
});

describe('reading the platform', () => {
  const IPHONE_SAFARI =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const IPHONE_CHROME =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1';
  const IPHONE_FIREFOX =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15';
  const ANDROID_CHROME =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const MAC_SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';

  const probe = (userAgent: string, maxTouchPoints = 5, platform = 'iPhone') =>
    ({ userAgent, maxTouchPoints, platform });

  it('recognises an iPhone', () => {
    expect(isIos(probe(IPHONE_SAFARI))).toBe(true);
    expect(isIos(probe(ANDROID_CHROME, 5, 'Linux armv8l'))).toBe(false);
  });

  it('recognises an iPad that claims to be a Mac', () => {
    // iPadOS 13+ sends a desktop user agent; touch points are the only tell.
    expect(isIos(probe(MAC_SAFARI, 5, 'MacIntel'))).toBe(true);
    // …and a real Mac, which has no touch screen, is not iOS.
    expect(isIos(probe(MAC_SAFARI, 0, 'MacIntel'))).toBe(false);
  });

  it('offers the steps in Safari only', () => {
    expect(isIosSafari(probe(IPHONE_SAFARI))).toBe(true);
    // Every iOS browser is WebKit underneath, so the engine proves nothing —
    // only the vendor token separates them.
    expect(isIosSafari(probe(IPHONE_CHROME))).toBe(false);
    expect(isIosSafari(probe(IPHONE_FIREFOX))).toBe(false);
  });

  it('does not mistake desktop Safari for an iPhone', () => {
    expect(isIosSafari(probe(MAC_SAFARI, 0, 'MacIntel'))).toBe(false);
  });
});
