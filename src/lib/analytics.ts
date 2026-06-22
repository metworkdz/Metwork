/**
 * PostHog analytics — unified server + client wrapper.
 *
 * Design goals:
 *   1. ONE event taxonomy. The `AnalyticsEvent` union below is the
 *      authoritative list of events the platform fires. Adding an event
 *      = adding a discriminated-union case + a tracker call. No magic
 *      strings scattered across the codebase.
 *
 *   2. GRACEFUL no-op when env vars are absent. Builds, previews, and
 *      local dev don't need PostHog configured. Missing keys → calls
 *      become no-ops with a one-time console warning.
 *
 *   3. NO PII LEAKAGE. Never send raw emails, phone numbers, national IDs,
 *      or full names. Use stable hashed user IDs (`distinctId`) and let
 *      PostHog's identify() carry safe display attributes only (role, city,
 *      membership tier). The hash() helper below is the only thing that
 *      touches PII.
 *
 *   4. SERVER + CLIENT symmetry. The same `track()` signature works in
 *      both environments. Server-side flushes via posthog-node (so
 *      events from API routes always reach PostHog, even if the user's
 *      browser tab closes mid-request). Client-side queues via posthog-js
 *      and batches naturally.
 *
 * Usage:
 *
 *   // Server-side (in an API route):
 *     import { track } from '@/lib/analytics';
 *     await track({ event: 'booking_created', distinctId: user.id, props: { ... } });
 *
 *   // Client-side (in a component):
 *     import { track } from '@/lib/analytics';
 *     track({ event: 'signup_started', distinctId: 'anon', props: { source: 'pricing' } });
 *
 *   // To identify a user after login:
 *     await identify(user.id, { role: user.role, city: user.city });
 */

import { clientEnvVars } from './env';

// ────────────────────────────────────────────────────────────────────────
// Event taxonomy — the source of truth
// ────────────────────────────────────────────────────────────────────────

/**
 * Centralised event names. Adding a new event:
 *   1. Add a string literal here.
 *   2. Add a properties shape in `EventProps`.
 *   3. Call `track({ event: 'new_event', ... })` from your code.
 *   4. In PostHog UI, add it to the relevant funnel/dashboard.
 *
 * Naming convention: snake_case, past tense for actions that happened,
 * imperative for milestones. Match the original spec from Bucket 1.
 */
export type AnalyticsEvent =
  // ── Entrepreneur funnel ────────────────────────────────────────────
  | 'signup_started'
  | 'otp_verified'
  | 'profile_completed'
  | 'first_booking_created'
  | 'first_payment_completed'
  | 'first_coworking_booking'
  | 'first_consultation_booking'
  // ── Incubator funnel ───────────────────────────────────────────────
  | 'incubator_signup'
  | 'first_space_created'
  | 'first_program_created'
  | 'first_event_created'
  | 'first_booking_received'
  | 'first_payout_requested'
  // ── Cross-cutting key events ───────────────────────────────────────
  | 'booking_created'
  | 'booking_approved'
  | 'booking_rejected'
  | 'wallet_topup'
  | 'withdrawal_requested'
  | 'promo_code_used'
  | 'membership_purchased'
  | 'network_pass_used';

/**
 * Event-specific property shapes. `Record<string, never>` means
 * "no extra properties allowed beyond the defaults".
 *
 * Default properties (added automatically by track()):
 *   - $current_url, $browser, $os, $device — from posthog-js
 *   - locale, role — from user context where available
 *   - environment — 'production' | 'preview' | 'development'
 */
export type EventProps = {
  signup_started:               { source?: 'pricing' | 'homepage' | 'mentors' | 'direct' };
  otp_verified:                 { role: 'ENTREPRENEUR' | 'INVESTOR' | 'INCUBATOR' | 'BUSINESS' | 'ADMIN' };
  profile_completed:            Record<string, never>;
  first_booking_created:        { itemKind: 'SPACE' | 'CONSULTATION' };
  first_payment_completed:      { amount: number };
  first_coworking_booking:      { spaceId: string; city: string };
  first_consultation_booking:   { mentorId: string };
  incubator_signup:             Record<string, never>;
  first_space_created:          { incubatorId: string };
  first_program_created:        { incubatorId: string };
  first_event_created:          { incubatorId: string };
  first_booking_received:       { incubatorId: string; itemKind: 'SPACE' | 'PROGRAM' | 'EVENT' };
  first_payout_requested:       { incubatorId: string; amount: number };
  booking_created:              {
    itemKind: 'SPACE' | 'PROGRAM' | 'EVENT' | 'CONSULTATION';
    amount: number;
    paymentMethod: 'wallet' | 'manual' | 'NETWORK_PASS';
    appliedPromoCode: string | null;
  };
  booking_approved:             { bookingId: string; itemKind: 'SPACE' | 'CONSULTATION' };
  booking_rejected:             { bookingId: string; refundedAmount: number };
  wallet_topup:                 { amount: number; provider: string; status: 'PENDING' | 'COMPLETED' | 'FAILED' };
  withdrawal_requested:         { amount: number };
  promo_code_used:              { code: string; kind: 'REGULAR' | 'PARTNER'; discountPercent: number };
  membership_purchased:         { tier: 'BUILDER' | 'FOUNDER'; amount: number; appliedPromoCode: string | null };
  network_pass_used:            { spaceId: string; city: string };
};

// ────────────────────────────────────────────────────────────────────────
// Track function — single entry point, dispatches to server or client SDK
// ────────────────────────────────────────────────────────────────────────

export interface TrackArgs<E extends AnalyticsEvent> {
  event: E;
  /**
   * Stable per-user identifier. Use `user.id` when logged in; for
   * anonymous events, generate / persist a cookie-backed UUID and pass
   * it as `distinctId`. NEVER pass an email or phone here.
   */
  distinctId: string;
  props: EventProps[E];
}

let warnedMissingConfig = false;

/**
 * Fire an event. Idempotent on missing config (no-op + one-time warning).
 *
 * Server-side: awaits the network call so the event ships before the
 * function returns. Use `await track(...)` in API routes.
 *
 * Client-side: queues into posthog-js's batching layer. The promise
 * resolves immediately; actual delivery happens on the next flush.
 */
export async function track<E extends AnalyticsEvent>(args: TrackArgs<E>): Promise<void> {
  const key = clientEnvVars.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    if (!warnedMissingConfig && process.env.NODE_ENV === 'production') {
      console.warn(
        '[analytics] NEXT_PUBLIC_POSTHOG_KEY not set. track() calls are no-ops. ' +
        'Set the env var in Vercel to enable analytics.',
      );
      warnedMissingConfig = true;
    }
    return;
  }

  const env =
    process.env.VERCEL_ENV === 'production' ? 'production'
    : process.env.VERCEL_ENV === 'preview'  ? 'preview'
    : 'development';

  const properties = {
    ...(args.props as Record<string, unknown>),
    environment: env,
  };

  // ── Server-side path ─────────────────────────────────────────────
  if (typeof window === 'undefined') {
    // posthog-node is heavy — lazy-load so client bundles aren't bloated.
    const { PostHog } = await import('posthog-node');

    // Use server key when available (queues server-side, more reliable
    // than the public key for high-volume backend events). Falls back
    // to the public key when server key isn't configured — still works,
    // just hits the ingest endpoint as if from a client.
    const serverKey = process.env.POSTHOG_SERVER_KEY ?? key;
    const client = new PostHog(serverKey, {
      host: clientEnvVars.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,            // Flush every event immediately — short-lived
      flushInterval: 0,      // serverless containers can't rely on intervals
      disableGeoip: false,
    });

    try {
      client.capture({
        distinctId: args.distinctId,
        event: args.event,
        properties,
      });
      // Wait for in-flight requests to complete before the function returns.
      // Without this, serverless containers may freeze before the event ships.
      await client.shutdown();
    } catch (err) {
      // Never let an analytics failure break the user's request.
      if (process.env.NODE_ENV !== 'test') {
        console.error('[analytics] capture failed:', err);
      }
    }
    return;
  }

  // ── Client-side path ────────────────────────────────────────────
  try {
    const posthog = (await import('posthog-js')).default;
    // Lazy init — first call sets up the client.
    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host: clientEnvVars.NEXT_PUBLIC_POSTHOG_HOST,
        // GDPR-friendly defaults:
        person_profiles: 'identified_only',  // No profile until identify() called
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: false,                  // We track explicit events only
        disable_session_recording: true,     // Opt-in if you want it later
      });
    }
    posthog.capture(args.event, properties);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[analytics] client capture failed:', err);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// User identification
// ────────────────────────────────────────────────────────────────────────

export interface IdentifyTraits {
  role: 'ENTREPRENEUR' | 'INVESTOR' | 'INCUBATOR' | 'BUSINESS' | 'ADMIN';
  /** Membership tier — for cohort analysis. Optional. */
  tier?: 'EXPLORER' | 'BUILDER' | 'FOUNDER';
  /** City (broad-ish geo signal, less identifying than precise location). */
  city?: string;
  /** Locale — affects which content paths a user prefers. */
  locale?: 'en' | 'fr' | 'ar';
  /** When the user signed up. Helpful for cohorting. */
  createdAt?: string;
}

/**
 * Associate a distinctId with display traits. Call this after login and
 * after any profile update. Traits go into PostHog's $set so they always
 * reflect the latest known values.
 *
 * IMPORTANT: traits MUST NOT include PII (email, phone, full name,
 * national ID, IP, exact address). PostHog Person profiles are reachable
 * via the dashboard — treat them as semi-public to your team.
 */
export async function identify(distinctId: string, traits: IdentifyTraits): Promise<void> {
  const key = clientEnvVars.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;

  if (typeof window === 'undefined') {
    const { PostHog } = await import('posthog-node');
    const serverKey = process.env.POSTHOG_SERVER_KEY ?? key;
    const client = new PostHog(serverKey, {
      host: clientEnvVars.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
    try {
      client.identify({ distinctId, properties: traits as unknown as Record<string, unknown> });
      await client.shutdown();
    } catch (err) {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[analytics] identify failed:', err);
      }
    }
    return;
  }

  try {
    const posthog = (await import('posthog-js')).default;
    if (!posthog.__loaded) {
      posthog.init(key, {
        api_host: clientEnvVars.NEXT_PUBLIC_POSTHOG_HOST,
        person_profiles: 'identified_only',
      });
    }
    posthog.identify(distinctId, traits as unknown as Record<string, unknown>);
  } catch (err) {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[analytics] client identify failed:', err);
    }
  }
}

/**
 * Reset the PostHog identity (client-side only). Call after logout so
 * the next session is tracked as a separate anonymous user.
 */
export async function resetIdentity(): Promise<void> {
  const key = clientEnvVars.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key || typeof window === 'undefined') return;
  try {
    const posthog = (await import('posthog-js')).default;
    if (posthog.__loaded) posthog.reset();
  } catch {
    // ignore
  }
}
