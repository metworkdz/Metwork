/**
 * Centralized site configuration.
 * Update values here once — propagates everywhere.
 */
export const siteConfig = {
  name: 'Metwork',
  shortName: 'Metwork',
  /** Short tagline for the browser-tab / SEO title only — see generateMetadata in the locale layout. */
  tagline: "Algeria's Startup Network",
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
    /** Student registration, then redirect into the LMS dashboard. */
    registerUrl:
      'https://learn.metwork.dz/student-registration/?redirect_to=https://learn.metwork.dz/dashboard',
    /** Public course catalog on the LMS. */
    coursesUrl: 'https://learn.metwork.dz/courses/',
    /** WordPress REST endpoint for the LearnDash "courses" post type. */
    apiUrl: 'https://learn.metwork.dz/wp-json/wp/v2/courses',
  },
  legal: {
    lawReference: 'Law 18-07 (Algerian Personal Data Protection Act)',
  },

  /**
   * Legal entities behind the platform — the SINGLE source of truth for company
   * names, addresses and registration numbers. These used to be literals
   * duplicated across the Terms and Privacy pages, which is exactly how one page
   * ends up stale after an address change.
   *
   * Deliberately NOT translated: a registered company name, address and
   * registration number are legal identifiers and must read identically in every
   * locale. Only the surrounding prose is localised.
   */
  entities: {
    /** Operates the platform; contracting party for wallet + local (DZD) payments. */
    platform: {
      name: 'EURL METWORK',
      registrationNumber: '31/00-1125194 B24',
      address: 'Boulevard de la Soumam N 02, Bloc 02, Apt 01, Oran',
      country: 'Algeria',
      email: 'contact@metwork.dz',
      phone: '+213670109105',
    },
    /**
     * Affiliated UK entity that contracts with the client for INTERNATIONAL card
     * payments (Visa / Mastercard) and is the name shown on the card statement.
     * Local CIB / Edahabia payments and the wallet stay with EURL METWORK.
     */
    internationalPayments: {
      name: 'Transferly Services Limited',
      registrationNumber: '14554642',
      address: '71-75 Shelton Street, Covent Garden, London, WC2H 9JQ',
      country: 'United Kingdom',
      email: 'contact@metwork.dz',
    },
  },
} as const;

export type SiteConfig = typeof siteConfig;
