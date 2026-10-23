import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/routing';

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * /signup → /join. Kept so every existing link, ad and email keeps working.
 * A "book before you sign up" intent only exists for entrepreneurs (space
 * bookings), so it goes straight to their page with the intent preserved.
 */
export default async function SignupPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const intent = (await searchParams).bookingIntent;
  if (typeof intent === 'string' && intent) {
    redirect({ href: `/join/entrepreneur?bookingIntent=${encodeURIComponent(intent)}`, locale });
  }
  redirect({ href: '/join', locale });
}
