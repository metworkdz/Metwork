import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Gift } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { assertAcademyEnabled } from '@/server/academy/guard';
import { readSession } from '@/server/auth/session';
import { giftForClaim } from '@/server/academy/gifts';
import { ClaimGiftButton } from '@/components/features/academy/claim-gift-button';

export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ locale: string; token: string }> }

export async function generateMetadata(): Promise<Metadata> {
  // A gift link names people: never indexed.
  return { title: 'Startup Academy', robots: { index: false, follow: false } };
}

/** Where a gift link lands: who offered what, and claim it on your account. */
export default async function AcademyGiftPage({ params }: PageProps) {
  assertAcademyEnabled();
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('academy.gift');
  let decoded = '';
  try { decoded = decodeURIComponent(token); } catch { /* not found below */ }
  const [view, session] = await Promise.all([giftForClaim(decoded, locale), readSession()]);
  const here = `/${locale}/academy/gift/${encodeURIComponent(decoded)}`;

  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center">
      <Gift className="mx-auto size-14 text-primary" aria-hidden />
      {view.status === 'NOT_FOUND' ? (
        <>
          <h1 className="mt-4 font-display text-2xl font-extrabold">{t('notFoundTitle')}</h1>
          <p className="mt-2 text-muted-foreground">{t('notFoundDesc')}</p>
        </>
      ) : (
        <>
          <h1 className="mt-4 text-balance font-display text-2xl font-extrabold">{t('title', { name: view.recipientName ?? '' })}</h1>
          <p className="mt-2 text-muted-foreground">{t('offered', { from: view.fromName ?? '', what: view.what ?? '' })}</p>
          {view.message && <blockquote dir="auto" className="mt-4 rounded-2xl bg-muted px-4 py-3 text-start text-sm italic">« {view.message} »</blockquote>}
          <div className="mt-6">
            {view.status === 'CLAIMED' ? (
              <p className="text-sm text-muted-foreground">{t('alreadyClaimed')}</p>
            ) : view.status === 'EXPIRED' ? (
              <p className="text-sm text-muted-foreground">{t('expired')}</p>
            ) : session ? (
              <ClaimGiftButton token={decoded} />
            ) : (
              <div className="space-y-2">
                <Button asChild size="lg" className="w-full font-bold"><Link href={{ pathname: '/login', query: { next: here } }}>{t('signIn')}</Link></Button>
                <Button asChild size="lg" variant="outline" className="w-full"><Link href="/signup">{t('signUp')}</Link></Button>
                <p className="text-xs text-muted-foreground">{t('signUpHint')}</p>
              </div>
            )}
          </div>
          {view.status === 'CLAIMABLE' && view.expiresAt && (
            <p className="mt-3 text-xs text-muted-foreground">{t('until', { date: new Date(view.expiresAt).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-DZ', { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
          )}
        </>
      )}
    </div>
  );
}
