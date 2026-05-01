import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { SignupForm } from '@/components/features/auth/signup-form';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('auth.signup');
  return { title: t('title') };
}

export default async function SignupPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <SignupForm />;
}
