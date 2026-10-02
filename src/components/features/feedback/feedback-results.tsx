'use client';

/**
 * « Résultats » — private to the organizer: the training's overall rating,
 * the average of each star question, and every answer.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Lock } from 'lucide-react';

import type { FeedbackAnswer, FeedbackResults } from '@/server/feedback/types';

import { errorMessage, formatRating, StarsDisplay } from './shared';

interface ResponseView {
  id: string;
  fullName: string | null;
  viaSharedLink: boolean;
  submittedAt: string;
  answers: FeedbackAnswer[];
  average: number | null;
}

interface Props {
  base: string;
  active: boolean;
}

export function FeedbackResultsView({ base, active }: Props) {
  const t = useTranslations('feedback');
  const locale = useLocale();
  const [data, setData] = useState<{ results: FeedbackResults; sent: number; responses: ResponseView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}/results`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
    }
  }, [base, t]);

  useEffect(() => { if (active) void load(); }, [active, load]);

  if (error) return <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!data) return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;

  const { results, sent, responses } = data;
  const labels = new Map(results.questions.map((q) => [q.questionId, q]));
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale);
  const ratings = results.questions.filter((q) => q.kind === 'RATING');

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="size-3.5" /> {t('resultsPrivate')}</p>

      {responses.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t('noResponses')}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <div className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm text-muted-foreground">{t('overall')}</p>
              <p className="flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tabular-nums">{results.overall !== null ? formatRating(results.overall, locale) : '—'}</span>
                <span className="text-muted-foreground">/ 5</span>
              </p>
              <StarsDisplay value={results.overall} className="text-xl" />
              <p className="text-xs text-muted-foreground">
                {sent > 0
                  ? t('responsesOfSent', { count: responses.length, sent })
                  : t('responsesCount', { count: responses.length })}
              </p>
            </div>
            <div className="space-y-2.5 rounded-lg border border-border p-4">
              {ratings.map((q) => (
                <div key={q.questionId} className="grid grid-cols-[minmax(0,1fr)_6rem_2.5rem] items-center gap-3 text-sm">
                  <span dir="auto" className="leading-snug">{q.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted" dir="ltr" aria-hidden>
                    <span className="block h-full rounded-full bg-amber-400" style={{ width: `${((q.average ?? 0) / 5) * 100}%` }} />
                  </span>
                  <span className="text-end font-medium tabular-nums">
                    {q.average !== null ? formatRating(q.average, locale) : '—'}
                    <span className="sr-only"> / 5, {t('answersCount', { count: q.count })}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <ul className="space-y-3">
            {responses.map((r) => (
              <li key={r.id} className="space-y-2.5 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p dir="auto" className="font-semibold">{r.fullName ?? t('anonymous')}</p>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    {fmtDate(r.submittedAt)}
                    {r.average !== null && (
                      <span className="inline-flex items-center gap-1"><StarsDisplay value={r.average} className="text-sm" /> {formatRating(r.average, locale)}</span>
                    )}
                  </p>
                </div>
                <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
                  {r.answers.filter((a) => labels.get(a.questionId)?.kind === 'RATING').map((a) => (
                    <div key={a.questionId} className="contents">
                      <dt dir="auto" className="text-muted-foreground">{labels.get(a.questionId)!.label}</dt>
                      <dd className="flex items-center gap-1.5"><StarsDisplay value={a.rating ?? 0} className="text-sm" /><span className="tabular-nums">{a.rating}</span></dd>
                    </div>
                  ))}
                </dl>
                {r.answers.filter((a) => labels.get(a.questionId)?.kind === 'TEXT' && a.text).map((a) => (
                  <div key={a.questionId} className="border-s-2 border-border ps-3 text-sm">
                    <p dir="auto" className="text-xs font-medium text-muted-foreground">{labels.get(a.questionId)!.label}</p>
                    <p dir="auto" className="whitespace-pre-line">{a.text}</p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
