/**
 * Platform feature flags — THE one switch per feature.
 *
 * Client-safe on purpose (no DB, no server-only imports) so a single flag can
 * gate marketing copy, an API endpoint and a dashboard screen without three
 * different mechanisms and without threading a prop through every call site.
 * That matters more than it sounds: a feature half-hidden is worse than one
 * fully visible, because the half that leaks is the half nobody tested.
 */

/**
 * Network Pass — monthly coworking check-in credits redeemable at partner
 * spaces (QR check-in, per-visit partner payout, monthly credit reset).
 *
 * OFF for launch. The feature is complete and stays complete: nothing is
 * deleted, only gated, so turning it back on is this one line rather than a
 * rebuild. Flip to `true` and every surface below returns together.
 *
 * What this flag controls, and nothing else:
 *   • marketing — the pass line in the plan feature lists
 *     (`passFeature` in `@/server/memberships/plan-view`)
 *   • redemption — `paymentMethod: 'NETWORK_PASS'` space bookings
 *     (`@/server/bookings/service`), the pass QR endpoint, and both check-in
 *     endpoints. These are the money/inventory paths, so each rejects on its
 *     own rather than trusting the UI to have hidden the button.
 *   • UI — the pass option in the space booking form, and the functional half
 *     of the dashboard Network Pass screen (which falls back to a "coming
 *     soon" placeholder rather than disappearing, so the nav entry still leads
 *     somewhere and members can see their plan)
 *
 * What it deliberately does NOT control: the credit engine, the monthly reset
 * cron, and the stored allowances. Those keep computing harmlessly — allowances
 * stay accurate, so nobody's balance silently resets to zero while the feature
 * is off, and nothing can be redeemed regardless.
 *
 * If this ever needs flipping without a deploy, make it read
 * `platformSettings` inside `isNetworkPassEnabled()` (the `landing-visibility`
 * pattern) — every call site already goes through that function, so the change
 * stays inside this module.
 */
const NETWORK_PASS_ENABLED = false;

/** Whether the Network Pass feature is currently live. */
export function isNetworkPassEnabled(): boolean {
  return NETWORK_PASS_ENABLED;
}
