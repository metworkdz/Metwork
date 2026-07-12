/**
 * PUBLIC voucher verification page — /[locale]/verify/[code]
 *
 * No auth, no login redirect: this page is shown by members to hotel /
 * restaurant staff on a phone screen, so it is mobile-first, high-contrast
 * and legible at a glance. Status is computed live server-side on every
 * request (force-dynamic — a pass must never be served from a static cache).
 *
 * The QR encodes this page's own URL via the qrserver.com image API in a
 * plain <img> — no client JS, no new dependency (approved approach).
 */
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { BadgeCheck, XCircle, SearchX, RefreshCcw } from 'lucide-react';
import { MembershipTierBadge } from '@/components/ui/membership-tier-badge';
import { verifyVoucher } from '@/server/perks/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; code: string }>;
}

export default async function VerifyVoucherPage({ params }: PageProps) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('pages.verify');

  const result = await verifyVoucher(decodeURIComponent(code));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://metwork.dz';
  const pageUrl = `${appUrl}/${locale}/verify/${encodeURIComponent(
    decodeURIComponent(code).trim().toUpperCase(),
  )}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pageUrl)}`;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-primary-900 via-primary-800 to-primary-900 px-4 py-8">
      <div className="w-full max-w-sm">
        {result ? (
          <PassCard
            result={result}
            code={decodeURIComponent(code).trim().toUpperCase()}
            qrSrc={qrSrc}
            locale={locale}
            t={t}
          />
        ) : (
          <InvalidCard t={t} />
        )}

        <p className="mt-6 text-center text-xs text-white/50">
          {t('poweredBy')} <span className="font-semibold text-white/70">Metwork</span>
        </p>
      </div>
    </main>
  );
}

/* ─────────────────────── Pass card ─────────────────────── */

function PassCard({
  result,
  code,
  qrSrc,
  locale,
  t,
}: {
  result: NonNullable<Awaited<ReturnType<typeof verifyVoucher>>>;
  code: string;
  qrSrc: string;
  locale: string;
  t: Awaited<ReturnType<typeof getTranslations<'pages.verify'>>>;
}) {
  const active = result.status === 'ACTIVE';

  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
      {/* Status banner — the thing staff must read in one glance */}
      <div
        className={`flex items-center justify-center gap-2 px-4 py-3.5 text-base font-bold text-white ${
          active ? 'bg-emerald-600' : 'bg-red-600'
        }`}
      >
        {active ? <BadgeCheck className="size-5" /> : <XCircle className="size-5" />}
        {active ? t('statusActive') : t('statusExpired')}
      </div>

      <div className="space-y-5 p-6">
        {/* Partner */}
        <div className="flex items-center gap-3">
          {result.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={result.logoUrl}
              alt={result.partnerName}
              className="size-14 shrink-0 rounded-2xl border border-zinc-200 bg-white object-contain p-1"
            />
          ) : (
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 text-xl font-semibold text-zinc-500">
              {result.partnerName.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {result.partnerName}
            </p>
            <h1 className="text-lg font-bold leading-snug text-zinc-900">{result.perkTitle}</h1>
          </div>
        </div>

        {/* Holder */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5">
          <p className="text-xs text-zinc-500">{t('memberLabel')}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-xl font-bold text-zinc-900">{result.holderName}</p>
            {result.tier !== 'FREE' && <MembershipTierBadge tier={result.tier} size="sm" />}
          </div>
        </div>

        {/* Replaced / expiry notes */}
        {result.replaced && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
            <RefreshCcw className="mt-0.5 size-4 shrink-0" />
            {t('replacedNote')}
          </p>
        )}

        {/* Meta */}
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">{t('passCode')}</dt>
            <dd className="font-mono font-semibold tracking-wider text-zinc-900">{code}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-zinc-500">{t('issuedOn')}</dt>
            <dd className="font-medium text-zinc-900">
              {new Date(result.issuedAt).toLocaleDateString(locale)}
            </dd>
          </div>
          {active && result.membershipExpiresAt && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-zinc-500">{t('memberUntil')}</dt>
              <dd className="font-medium text-zinc-900">
                {new Date(result.membershipExpiresAt).toLocaleDateString(locale)}
              </dd>
            </div>
          )}
        </dl>

        {/* QR of this page's own URL */}
        <div className="flex flex-col items-center gap-2 border-t border-zinc-100 pt-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt={t('qrAlt')}
            width={160}
            height={160}
            className="size-40 rounded-lg"
          />
          <p className="text-center text-xs text-zinc-400">{t('qrHint')}</p>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────── Invalid state ─────────────────────── */

function InvalidCard({
  t,
}: {
  t: Awaited<ReturnType<typeof getTranslations<'pages.verify'>>>;
}) {
  return (
    <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div className="flex items-center justify-center gap-2 bg-zinc-700 px-4 py-3.5 text-base font-bold text-white">
        <SearchX className="size-5" />
        {t('invalidTitle')}
      </div>
      <div className="space-y-2 p-6 text-center">
        <p className="text-sm text-zinc-600">{t('invalidBody')}</p>
        <p className="text-xs text-zinc-400">{t('invalidHint')}</p>
      </div>
    </div>
  );
}
