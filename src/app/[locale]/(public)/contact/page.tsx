import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { assertLandingVisible } from '@/lib/landing-visibility';
import { ContactClient } from './contact-client';

// ISR so the admin landing-visibility toggle propagates without a redeploy
// (page stays statically delivered; re-rendered at most once per minute).
export const revalidate = 60;

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata(): Promise<Metadata> {
  // Gate here too: metadata resolves before the first byte, so a hidden section
  // returns a real 404 status (the page-body gate alone streams 200 + 404 UI).
  await assertLandingVisible('contact');
  return {};
}

/**
 * Thin server wrapper: the page body is a client component (form state), so
 * the server-side landing-visibility gate lives here.
 */
export default async function ContactPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Landing-visibility gate — 404s server-side when the admin hides this section.
  await assertLandingVisible('contact');

  return <ContactClient />;
}
