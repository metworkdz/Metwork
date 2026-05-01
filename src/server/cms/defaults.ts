/**
 * Default landing-page content.
 * Values are kept in sync with en.json so zero visual change happens on
 * first boot (before the admin has saved anything).
 */
import type { LandingContent } from '@/types/cms';

export const defaultLandingContent: Omit<LandingContent, 'updatedAt'> = {
  hero: {
    badge: "Now live in Algeria",
    title: "Build, launch, and grow your startup",
    subtitle:
      "The unified platform connecting entrepreneurs, investors, and incubators across Algeria. Programs, coworking spaces, funding — all in one place.",
    ctaPrimary: "Apply now",
    ctaSecondary: "Browse programs",
  },
  stats: {
    founders:  { value: '500+', label: 'Founders' },
    investors: { value: '120+', label: 'Investors' },
    incubators:{ value: '40+',  label: 'Incubators' },
    cities:    { value: '15',   label: 'Cities' },
  },
  features: {
    title: "Everything entrepreneurs need",
    subtitle: "From idea to funded startup, in one platform.",
    items: [
      {
        key: 'programs',
        title: 'World-class programs',
        description:
          "Access incubation, acceleration, and training programs from Algeria's top organizations.",
      },
      {
        key: 'spaces',
        title: 'Premium workspaces',
        description:
          'Book coworking, private offices, and meeting rooms in every major Algerian city.',
      },
      {
        key: 'fundraising',
        title: 'Connect with investors',
        description: 'Get discovered by investors actively looking to fund Algerian startups.',
      },
      {
        key: 'community',
        title: 'Active community',
        description: 'Join events, meet founders, and build relationships that last.',
      },
    ],
  },
  roles: {
    title: "Built for everyone in the ecosystem",
    items: [
      {
        key: 'entrepreneur',
        title: 'For entrepreneurs',
        description: 'Find programs, book spaces, raise capital — all from one dashboard.',
      },
      {
        key: 'investor',
        title: 'For investors',
        description: 'Discover vetted Algerian startups and connect with founders directly.',
      },
      {
        key: 'incubator',
        title: 'For incubators',
        description: 'Manage programs, spaces, and bookings from a single SaaS dashboard.',
      },
    ],
  },
  cta: {
    title: "Ready to join Algeria's startup movement?",
    subtitle: "Free to start. Join thousands of founders, investors, and innovators.",
    button: "Create your account",
  },
};
