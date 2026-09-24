/**
 * PUBLIC certificate verification — /[locale]/attestation/[token]
 *
 * Where the QR code on a participation certificate leads. An employer, a
 * school or anyone holding the paper can check, without an account, that it
 * was really issued, to whom, for which training.
 *
 * The token is random (120 bits), not the printed number: sequential numbers
 * could be walked one by one to list every participant's name. Validity is
 * read live on every request — a certificate revoked after printing must stop
 * verifying at once, so nothing here is cached.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BadgeCheck, SearchX, XCircle } from 'lucide-react';

import { verifyCertificate } from '@/server/certificates/verify';
import { certificateNameLine } from '@/server/certificates/text';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'certificateVerify' });
  return {
    title: t('metaTitle'),
    // A participant's name has no business in a search index.
    robots: { index: false, follow: false },
  };
}

const INTL_LOCALE: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-DZ' };

function formatRange(locale: string, startIso: string, endIso: string): string {
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers',
  });
  try { return fmt.formatRange(new Date(startIso), new Date(endIso)); }
  catch { return fmt.format(new Date(startIso)); }
}

function formatDay(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale] ?? 'fr-FR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Algiers',
  }).format(new Date(iso));
}

export default async function CertificateVerificationPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('certificateVerify');

  // A mangled link ("%E0%A4") must read as "not found", not crash the page.
  let decoded = '';
  try { decoded = decodeURIComponent(token); } catch { /* stays empty → not found */ }
  const result = await verifyCertificate(decoded);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-primary-900 via-primary-800 to-primary-900 px-4 py-8">
      <div className="w-full max-w-md">
        {result.status === 'NOT_FOUND' ? (
          <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-center gap-2 bg-zinc-700 px-4 py-3.5 text-base font-bold text-white">
              <SearchX className="size-5" />
              {t('notFoundTitle')}
            </div>
            <p className="p-6 text-center text-sm text-zinc-600">{t('notFoundBody')}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div
              className={`flex items-center justify-center gap-2 px-4 py-3.5 text-base font-bold text-white ${
                result.status === 'VALID' ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
              {result.status === 'VALID' ? <BadgeCheck className="size-5" /> : <XCircle className="size-5" />}
              {result.status === 'VALID' ? t('valid') : t('revoked')}
            </div>

            <div className="space-y-5 p-6">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('awardedTo')}</p>
                <p className="mt-1 text-xl font-bold text-zinc-900">
                  {certificateNameLine({ fullName: result.fullName, civility: result.civility })}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5">
                <p className="text-xs text-zinc-500">{t('training')}</p>
                <p className="mt-1 font-semibold leading-snug text-zinc-900">{result.programTitle}</p>
                <p className="mt-1 text-sm text-zinc-600">{t('organizedBy', { organizer: result.organizer })}</p>
                <p className="mt-0.5 text-sm text-zinc-600">{formatRange(locale, result.startDate, result.endDate)}</p>
              </div>

              <dl className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-zinc-500">{t('number')}</dt>
                  <dd className="font-mono font-semibold tracking-wider text-zinc-900" dir="ltr">{result.number}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-zinc-500">{t('issuedOn')}</dt>
                  <dd className="font-medium text-zinc-900">{formatDay(locale, result.issuedAt)}</dd>
                </div>
              </dl>

              {result.status === 'REVOKED' && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {t('revokedBody')}
                </p>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-white/50">
          {t('poweredBy')} <span className="font-semibold text-white/70">Metwork</span>
        </p>
      </div>
    </main>
  );
}
