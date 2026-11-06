/**
 * PUBLIC — /[locale]/attestation/linkedin/[token]
 *
 * Where the « Partager sur LinkedIn » button of the certificate email leads.
 * The participant sees exactly what will be published — the certificate image
 * and the ready-made text, with the @Metwork tag — and one button. LinkedIn
 * asks them to allow Metwork the first time; nothing is posted without that
 * click. They come back here with a link to their post.
 *
 * The token is the signed share link (`@/server/certificates/linkedin/config`),
 * never the verification token printed in the QR code.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2, ExternalLink, Info, SearchX } from 'lucide-react';

import { resolveShareTarget } from '@/server/certificates/linkedin/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
  searchParams: Promise<{ published?: string; error?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'certificateLinkedIn' });
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

const ERROR_KEYS = {
  CANCELLED: 'errorCancelled',
  BUSY: 'errorBusy',
  RATE_LIMITED: 'errorRateLimited',
  LINKEDIN_ERROR: 'errorLinkedIn',
} as const;

function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className} fill="currentColor">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

export default async function CertificateLinkedInPage({ params, searchParams }: PageProps) {
  const { locale, token } = await params;
  const { published, error } = await searchParams;
  setRequestLocale(locale);
  const t = await getTranslations('certificateLinkedIn');

  let decoded = '';
  try { decoded = decodeURIComponent(token); } catch { /* stays empty → not found */ }
  const target = await resolveShareTarget(decoded);

  if (!target.ok) {
    const key = target.reason === 'REVOKED' ? 'revoked' : target.reason === 'DISABLED' ? 'disabled' : 'notFound';
    return (
      <main className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-primary-900 via-primary-800 to-primary-900 px-4 py-8">
        <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="flex items-center justify-center gap-2 bg-zinc-700 px-4 py-3.5 text-base font-bold text-white">
            <SearchX className="size-5" />
            {t(`${key}Title`)}
          </div>
          <p className="p-6 text-center text-sm text-zinc-600">{t(`${key}Body`)}</p>
        </div>
      </main>
    );
  }

  const imageSrc = `/api/certificates/linkedin/image?t=${encodeURIComponent(decoded)}`;
  const startHref = `/api/certificates/linkedin/start?t=${encodeURIComponent(decoded)}`;
  const errorKey = error && error in ERROR_KEYS ? ERROR_KEYS[error as keyof typeof ERROR_KEYS] : null;
  // The post was in the store before the redirect landed — trust it, not the query.
  const isPublished = Boolean(target.postUrl);
  const postDir = target.lang === 'ar' ? 'rtl' : 'ltr';

  return (
    <main className="min-h-dvh bg-gradient-to-b from-primary-900 via-primary-800 to-primary-900 px-4 py-8">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <div className="overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="space-y-1 px-6 pt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary-700">{t('eyebrow')}</p>
            <h1 className="text-balance text-xl font-bold leading-tight text-zinc-900">
              {isPublished ? t('publishedTitle') : t('title')}
            </h1>
            <p className="text-sm text-zinc-600">{isPublished ? t('publishedBody') : t('intro')}</p>
          </div>

          {isPublished && (
            <div className="mx-6 mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="size-4 shrink-0" />
              {published ? t('justPublished') : t('alreadyPublished')}
            </div>
          )}
          {!isPublished && errorKey && (
            <div role="alert" className="mx-6 mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
              <Info className="mt-0.5 size-4 shrink-0" />
              {t(errorKey)}
            </div>
          )}

          {/* What LinkedIn will show: the text, then the certificate. */}
          <div className="m-6 overflow-hidden rounded-2xl border border-zinc-200">
            <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-xs font-medium text-zinc-500">
              <LinkedInMark className="size-4 text-[#0A66C2]" />
              {t('previewLabel')}
            </div>
            <p dir={postDir} className="whitespace-pre-line px-4 py-3 text-sm leading-relaxed text-zinc-800">
              {target.segments.map((s, i) => {
                if (s.kind === 'mention') {
                  return <span key={i} className="font-semibold text-[#0A66C2]">{s.name}</span>;
                }
                if (s.kind === 'hashtag') {
                  return <span key={i} className="font-semibold text-[#0A66C2]">#{s.tag}</span>;
                }
                return <span key={i}>{s.text}</span>;
              })}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a per-participant PNG from our own route */}
            <img
              src={imageSrc}
              alt={t('imageAlt', { title: target.certificate.programTitle })}
              className="block aspect-[1.414] w-full bg-zinc-100 object-contain"
            />
          </div>

          <div className="space-y-3 px-6 pb-6">
            {isPublished ? (
              <a
                href={target.postUrl!}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A66C2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#004182]"
              >
                <LinkedInMark className="size-4" />
                {t('viewPost')}
                <ExternalLink className="size-4" />
              </a>
            ) : (
              <>
                <a
                  href={startHref}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0A66C2] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#004182]"
                >
                  <LinkedInMark className="size-4" />
                  {t('publish')}
                </a>
                <p className="text-center text-xs leading-relaxed text-zinc-500">{t('consentNote')}</p>
              </>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-white/50">
          {t('poweredBy')} <span className="font-semibold text-white/70">Metwork</span>
        </p>
      </div>
    </main>
  );
}
