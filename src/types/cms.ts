/* ─────────────────────────── Landing CMS ─────────────────────────── */

export interface HeroContent {
  badge: string;
  title: string;
  subtitle: string;
  ctaPrimary: string;
  ctaSecondary: string;
}

export interface StatItem {
  /** Display value, e.g. "500+" */
  value: string;
  /** Display label, e.g. "Founders" */
  label: string;
}

export interface StatsContent {
  founders: StatItem;
  investors: StatItem;
  incubators: StatItem;
  cities: StatItem;
}

export type FeatureKey = 'programs' | 'spaces' | 'fundraising' | 'community';

export interface FeatureItem {
  key: FeatureKey;
  title: string;
  description: string;
}

export interface FeaturesContent {
  title: string;
  subtitle: string;
  items: FeatureItem[];
}

export type RoleKey = 'entrepreneur' | 'investor' | 'incubator';

export interface RoleItem {
  key: RoleKey;
  title: string;
  description: string;
}

export interface RolesContent {
  title: string;
  items: RoleItem[];
}

export interface CtaContent {
  title: string;
  subtitle: string;
  button: string;
}

export interface LandingContent {
  hero: HeroContent;
  stats: StatsContent;
  features: FeaturesContent;
  roles: RolesContent;
  cta: CtaContent;
  /** ISO timestamp of the last admin save. */
  updatedAt: string;
}
