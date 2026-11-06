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

/**
 * Freelancer Premium on sale (Metwork 2.0).
 *
 * ON since 2026-10-23 (owner decision, after phase 3b): freelancer booking
 * (the 10 % on spaces and mentors) and the document review (the verified
 * badge) are live. Turning it off again stops new purchases and trial starts;
 * existing Premium members keep their plan until it ends.
 *
 * What it controls: `purchasablePlansFor('FREELANCER')` — and through it the
 * purchase route, the renewal cron and every plan card — plus the freelancer
 * section of the public pricing page. Admin grants are unaffected.
 */
const FREELANCER_PREMIUM_ON_SALE = true;

/** Whether freelancers can currently buy Premium. */
export function isFreelancerPremiumOnSale(): boolean {
  return FREELANCER_PREMIUM_ON_SALE;
}

/**
 * Startup Academy (the e-learning platform at /academy) opens in three steps,
 * one switch each, so a link can go to testers before anything is announced:
 *
 *   1. ACADEMY_LIVE — /academy works for anyone who has the link, including
 *      buying (the routes, the pages, the APIs). Off: the whole tree is a 404.
 *   2. ACADEMY_ANNOUNCED — the public launch: the site's menu and footer point
 *      to /academy (not the coming-soon page at /startupacademy, which then
 *      redirects), search engines may index it, the Premium perk card and the
 *      incubators' seats menu appear.
 *   3. ACADEMY_STUDIO_LIVE — consultants: the portal's Academy tab, the Studio
 *      API, and the notices sent to mentors.
 *
 * `NEXT_PUBLIC_ACADEMY_PREVIEW=true` turns all three on for a local or preview
 * deployment. Inlined at build time, so a Vercel env change needs a redeploy.
 */
const ACADEMY_LIVE = true;
const ACADEMY_ANNOUNCED = false;
const ACADEMY_STUDIO_LIVE = false;

const academyPreview = () => process.env.NEXT_PUBLIC_ACADEMY_PREVIEW === 'true';

export function isAcademyEnabled(): boolean {
  return ACADEMY_LIVE || academyPreview();
}

export function isAcademyAnnounced(): boolean {
  return ACADEMY_ANNOUNCED || academyPreview();
}

export function isAcademyStudioEnabled(): boolean {
  return ACADEMY_STUDIO_LIVE || academyPreview();
}
