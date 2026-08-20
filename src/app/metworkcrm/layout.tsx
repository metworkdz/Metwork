import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './crm.css';

/**
 * METWORK OS CRM — root layout.
 *
 * This tree sits OUTSIDE `[locale]` on purpose: French-only, no next-intl
 * (dev rules R-5). `src/app/layout.tsx` is a pass-through that renders only
 * `children`, and <html>/<body> live in `[locale]/layout.tsx` — which the CRM
 * never traverses. So this layout MUST supply them itself.
 *
 * Space Grotesk is instantiated here rather than reusing the platform's
 * `--font-grotesk` (defined in `[locale]/layout.tsx`, out of reach from here).
 * The variable is named `--font-grotesk-crm` so the two can never collide
 * (dev rules R-7).
 */
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-grotesk-crm',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: {
    default: 'METWORK OS',
    template: '%s · METWORK OS',
  },
  description: 'Outil interne Metwork — CRM, écosystème, programmes.',
  // Internal tool: keep it out of every index.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0D0D0D',
};

export default function MetworkCrmRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      {/*
        `data-crm` sits on <body>, NOT <html>: next/font defines
        --font-grotesk-crm on the element carrying `spaceGrotesk.variable`, and
        CSS custom properties inherit downward only. With the attribute on
        <html>, the `[data-crm]` rules resolved `var(--font-grotesk-crm)` to
        nothing and the whole CRM fell back to the default serif.
      */}
      <body data-crm className={`${spaceGrotesk.variable} min-h-screen antialiased`}>
        {children}
      </body>
    </html>
  );
}
