/**
 * Public landing sections that can be toggled by the admin — CLIENT-SAFE
 * (no server imports) so nav components can map links to sections.
 *
 * Deliberately NOT toggleable: home ('/'), legal pages, auth pages, and every
 * payment/checkout return route (money flows must never 404 mid-payment).
 */
export const LANDING_SECTIONS = [
  'programs',
  'events',
  'spaces',
  'mentors',
  'academy',
  'incubators',
  'investors',
  'startups',
  'consultant',
  'pricing',
  'about',
  'contact',
] as const;

export type LandingSection = (typeof LANDING_SECTIONS)[number];

/** Landing visibility map. Missing key ⇒ visible. */
export type LandingVisibility = Partial<Record<LandingSection, boolean>>;

/**
 * Root path → section. Child routes (`/programs/[slug]`, `/spaces/[id]`, …)
 * belong to their parent's section.
 */
const SECTION_BY_ROOT: Record<string, LandingSection> = {
  '/programs': 'programs',
  '/events': 'events',
  '/spaces': 'spaces',
  '/mentors': 'mentors',
  '/academy': 'academy',
  '/incubators': 'incubators',
  '/investors': 'investors',
  '/startups': 'startups',
  '/consultant': 'consultant',
  '/pricing': 'pricing',
  '/about': 'about',
  '/contact': 'contact',
};

/** Resolve the toggleable section for a public href. Null = never toggleable. */
export function sectionForPath(href: string): LandingSection | null {
  const root = '/' + (href.split('/')[1] ?? '');
  return SECTION_BY_ROOT[root] ?? null;
}

/** Whether a public nav href is visible under the given visibility map. */
export function isPathVisible(href: string, visibility: LandingVisibility): boolean {
  const section = sectionForPath(href);
  if (!section) return true; // non-toggleable routes are always visible
  return visibility[section] !== false; // missing key ⇒ visible
}

/**
 * Filter the public nav config against a visibility map: hidden links are
 * dropped, and a dropdown group disappears when every child is hidden.
 * Pure + client-safe; with an empty map the result is structurally identical
 * to the input (default = everything visible).
 */
export function filterPublicNavItems<
  T extends { href?: string; children?: readonly { href: string }[] },
>(items: readonly T[], visibility: LandingVisibility): T[] {
  const result: T[] = [];
  for (const item of items) {
    if (item.children) {
      const children = item.children.filter((c) => isPathVisible(c.href, visibility));
      if (children.length > 0) result.push({ ...item, children });
    } else if (!item.href || isPathVisible(item.href, visibility)) {
      result.push(item);
    }
  }
  return result;
}
