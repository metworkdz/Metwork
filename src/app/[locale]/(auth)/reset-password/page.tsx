import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pages.auth.resetPassword' });
  return { title: t('pageTitle') };
}

export default async function ResetPasswordPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { token = '' } = await searchParams;
  setRequestLocale(locale);
  return <ResetPasswordForm token={token} />;
}
