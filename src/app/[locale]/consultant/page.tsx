import type { Metadata } from 'next';
import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { CONSULTANT_LOCALE_COOKIE } from '@/components/features/consultant/portal/language-switcher';
import { ConsultantPortal } from '@/components/features/consultant/consultant-portal';

export const metadata: Metadata = {
  title: 'Consultant portal — Metwork',
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConsultantPortalPage({ params, searchParams }: PageProps) {
  const { locale } = await params;

  // Consultants default to French (most are French speakers). On a first visit
  // — i.e. before they pick a language with the in-app switcher — any non-French
  // locale is redirected to /fr/consultant, preserving query params (e.g. a PIN
  // ?token=…). Once they choose a language the switcher sets this cookie and the
  // chosen locale is respected.
  const chosen = (await cookies()).get(CONSULTANT_LOCALE_COOKIE)?.value;
  if (!chosen && locale !== 'fr') {
    const sp = await searchParams;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      if (typeof v === 'string') qs.set(k, v);
    }
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    redirect(`/fr/consultant${suffix}`);
  }

  setRequestLocale(locale);
  // The portal owns a full-bleed dark "app" surface; no Container wrapper.
  // useSearchParams (token / error code) needs a Suspense boundary.
  return (
    <Suspense>
      <ConsultantPortal />
    </Suspense>
  );
}
