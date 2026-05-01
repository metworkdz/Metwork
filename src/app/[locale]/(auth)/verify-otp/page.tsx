import type { Metadata } from 'next';
import { Suspense } from 'react';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { OtpForm } from '@/components/features/auth/otp-form';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth.verifyOtp');
  return { title: t('title') };
}

export default async function VerifyOtpPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-border bg-background p-8 shadow-sm">
          <div className="h-32 animate-pulse rounded-md bg-muted" />
        </div>
      }
    >
      <OtpForm />
    </Suspense>
  );
}
