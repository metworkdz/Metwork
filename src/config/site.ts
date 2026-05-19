/**
 * Centralized site configuration.
 * Update values here once — propagates everywhere.
 */
export const siteConfig = {
  name: 'Metwork',
  shortName: 'Metwork',
  description:
    "Algeria's unified startup ecosystem. Connecting entrepreneurs, investors, incubators, and coworking spaces in one platform.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz',
  /** Absolute URL — used in og:image meta tags and external email templates. */
  ogImage: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/profilelogogreen.png`,
  logo: '/assets/metworklogo.svg',
  /** Absolute URL for use in emails / external embeds where a relative path won't work. */
  logoExternal: `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz'}/assets/Metworkwhitelogo.png`,
  favicon: '/assets/Metworkfavicon.svg',
  links: {
    twitter: 'https://twitter.com/metworkdz',
    linkedin: 'https://linkedin.com/company/metworkdz',
    instagram: 'https://instagram.com/metwork.dz',
    facebook: 'https://facebook.com/metwork.dz',
  },
  contact: {
    email: 'contact@metwork.dz',
    phone: '+213670109105',
    address: 'Boulevard de la Soumam N 02, Bloc 02, Apt 01, Oran',
  },
  academy: {
    externalUrl: 'https://learn.metwork.dz',
  },
  legal: {
    lawReference: 'Law 18-07 (Algerian Personal Data Protection Act)',
  },
} as const;

export type SiteConfig = typeof siteConfig;
