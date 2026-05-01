import { setRequestLocale } from 'next-intl/server';
import { ForgotPasswordForm } from '@/components/features/auth/forgot-password-form';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export const metadata = { title: 'Forgot password' };

export default async function ForgotPasswordPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <ForgotPasswordForm />;
}
