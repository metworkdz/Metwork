import type { Metadata } from 'next';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { ConsultantPortal } from '@/components/features/consultant/consultant-portal';

export const metadata: Metadata = {
  title: 'Consultant portal — Metwork',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function ConsultantPortalPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  // The portal owns a full-bleed dark "app" surface; no Container wrapper.
  // The French default + language switching are handled in middleware
  // (so they're real redirects, not RSC-cached). useSearchParams (token /
  // error code) needs a Suspense boundary.
  return (
    <Suspense>
      <ConsultantPortal />
    </Suspense>
  );
}
