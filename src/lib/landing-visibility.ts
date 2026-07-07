/**
 * THE landing-visibility helper — the single server-side source of truth for
 * which public landing sections are live. SERVER-ONLY (reads the store);
 * client components receive the resolved map via props.
 *
 * Semantics: `platformSettings.landingVisibility` is additive & nullable —
 * a missing map or missing key means VISIBLE, so existing deployments render
 * exactly as before until an admin hides something.
 */
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { db } from '@/server/db/store';
import type { LandingSection, LandingVisibility } from '@/config/landing-sections';

// `cache` only exists in the react-server build (RSC runtime). Fall back to
// an identity wrapper elsewhere (vitest) — semantics stay identical, we just
// lose the per-request memoisation.
const requestMemo: <T extends (...args: never[]) => unknown>(fn: T) => T =
  typeof cache === 'function' ? cache : (fn) => fn;

/**
 * Resolve the current visibility map. Request-cached (same pattern as
 * `getServerSession`) so the navbar, footer and page guard share one read.
 * NON-BLOCKING: a store failure returns {} (= everything visible) — the
 * public site must never go down because of a settings read.
 */
export const getLandingVisibility = requestMemo(async (): Promise<LandingVisibility> => {
  try {
    const data = await db.read();
    return (data.platformSettings?.landingVisibility ?? {}) as LandingVisibility;
  } catch {
    return {};
  }
});

/** Whether one section is currently visible. */
export async function isLandingSectionVisible(section: LandingSection): Promise<boolean> {
  const visibility = await getLandingVisibility();
  return visibility[section] !== false;
}

/**
 * Server-side 404 enforcement for a landing page (and its child routes).
 * Call at the top of the section's `page.tsx`:
 *
 *   await assertLandingVisible('pricing');
 */
export async function assertLandingVisible(section: LandingSection): Promise<void> {
  if (!(await isLandingSectionVisible(section))) notFound();
}
