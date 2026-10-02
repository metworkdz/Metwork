/**
 * PUBLIC training feedback — /[locale]/feedback/[token]
 *
 * Where the feedback email leads. No account: the signed link is the
 * authorisation (`@/server/feedback/tokens`). The page shows the form and,
 * through a personal link, the person's own earlier answers — never anyone
 * else's, and nothing about the results.
 *
 * Read live on every request: a form closed, or a participant cancelled,
 * must stop accepting answers at once.
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Clock, SearchX } from 'lucide-react';

import { FeedbackAnswerForm } from '@/components/features/feedback/feedback-answer-form';
import { resolveFeedbackLink } from '@/server/feedback/service';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ locale: string; token: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'feedbackPage' });
  // Private by design: no search engine has any business here.
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

export default async function FeedbackPage({ params }: PageProps) {
  const { locale, token } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('feedbackPage');

  let decoded = '';
  try { decoded = decodeURIComponent(token); } catch { /* stays empty → invalid */ }
  const link = await resolveFeedbackLink(decoded);

  if (!link.ok) {
    const closed = link.reason === 'CLOSED';
    return (
      <main className="flex min-h-dvh items-center justify-center bg-muted/40 px-4 py-10">
        <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          {closed
            ? <Clock className="mx-auto size-10 text-muted-foreground" />
            : <SearchX className="mx-auto size-10 text-muted-foreground" />}
          <h1 className="text-lg font-bold">{closed ? t('closedTitle') : t('invalidTitle')}</h1>
          <p className="text-sm text-muted-foreground">{closed ? t('closedBody') : t('invalidBody')}</p>
        </div>
      </main>
    );
  }

  const firstName = link.registration?.fullName.trim().split(/\s+/)[0] ?? null;

  return (
    <main className="min-h-dvh bg-muted/40 px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-xl space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-8">
        <header className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">{t('eyebrow')}</p>
          <h1 dir="auto" className="text-balance text-2xl font-bold leading-tight">{link.program.title}</h1>
          {link.organizer && (
            <p className="text-sm text-muted-foreground">
              {t('byOrganizer', { organizer: link.organizer })}
            </p>
          )}
        </header>
        {firstName && <p className="text-sm">{t('greeting', { name: firstName })}</p>}
        {link.form.intro && <p dir="auto" className="whitespace-pre-line text-sm text-muted-foreground">{link.form.intro}</p>}
        <FeedbackAnswerForm token={decoded} questions={link.form.questions} previous={link.previous} />
      </div>
    </main>
  );
}
