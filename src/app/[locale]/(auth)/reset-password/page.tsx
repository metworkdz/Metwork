import { setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/features/auth/reset-password-form';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}

export const metadata = { title: 'Reset password' };

export default async function ResetPasswordPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  const { token = '' } = await searchParams;
  setRequestLocale(locale);
  return <ResetPasswordForm token={token} />;
}
