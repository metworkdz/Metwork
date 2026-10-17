/**
 * Self-hosted fonts (woff2 variable files, Google Fonts "latin"/"arabic"
 * subsets, OFL). We do NOT use `next/font/google`: it downloads at build time,
 * and Google sometimes answers Vercel's builders with extension-less
 * `fonts.gstatic.com/l/font?kit=…` URLs, which crash Next 14's loader
 * ("Cannot read properties of null (reading '1')") and fail the deploy.
 */
import type { CSSProperties } from 'react';
import localFont from 'next/font/local';

export const inter = localFont({
  src: './inter-latin.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

/**
 * Cairo ships as two subset files. next/font/local can't give each its own
 * unicode-range, so they are two families chained in `--font-cairo`
 * (see `cairoVariable` below): Arabic glyphs first, Latin as fallback.
 */
export const cairoArabic = localFont({
  src: './cairo-arabic.woff2',
  weight: '200 1000',
  variable: '--font-cairo-ar',
  display: 'swap',
});

export const cairoLatin = localFont({
  src: './cairo-latin.woff2',
  weight: '200 1000',
  variable: '--font-cairo-latin',
  display: 'swap',
});

/** Inline style for <body> composing the two Cairo faces into `--font-cairo`. */
export const cairoVariable = {
  '--font-cairo': 'var(--font-cairo-ar), var(--font-cairo-latin)',
} as CSSProperties;

export const plusJakartaSans = localFont({
  src: './jakarta-latin.woff2',
  weight: '500 800',
  variable: '--font-display',
  display: 'swap',
});

/** Space Grotesk 300–700; the platform uses 500/700, the CRM 400–700. */
export const spaceGrotesk = localFont({
  src: './grotesk-latin.woff2',
  weight: '300 700',
  variable: '--font-grotesk',
  display: 'swap',
});

export const spaceGroteskCrm = localFont({
  src: './grotesk-latin.woff2',
  weight: '300 700',
  variable: '--font-grotesk-crm',
  display: 'swap',
});
