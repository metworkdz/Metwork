import type { Metadata } from 'next';
import { Suspense } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { Container } from '@/components/ui/container';
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
  return (
    <Container className="py-6">
      {/* useSearchParams (sign-in error code) needs a Suspense boundary. */}
      <Suspense>
        <ConsultantPortal />
      </Suspense>
    </Container>
  );
}
