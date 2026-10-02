'use client';

/**
 * The participant's side of a training feedback form: stars from 0 to 5 and
 * free-text answers, sent in one go. Through a personal link it opens with
 * the person's earlier answers, which they may change while the form is open.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Lock, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FeedbackAnswer, FeedbackQuestion } from '@/server/feedback/types';

interface Props {
  token: string;
  questions: FeedbackQuestion[];
  previous: FeedbackAnswer[] | null;
}

type Values = Record<string, { rating?: number | null; text?: string }>;

function initialValues(previous: FeedbackAnswer[] | null): Values {
  const v: Values = {};
  for (const a of previous ?? []) v[a.questionId] = { rating: a.rating ?? null, text: a.text ?? '' };
  return v;
}

function StarInput({
  id, value, onChange, required,
}: { id: string; value: number | null | undefined; onChange: (v: number | null) => void; required: boolean }) {
  const t = useTranslations('feedbackPage');
  const choose = (n: number) => onChange(n);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* LTR on purpose: the scale reads 0 → 5 the same way in every language. */}
      <div role="radiogroup" aria-labelledby={`${id}-label`} dir="ltr" className="flex items-center gap-1">
        <button
          type="button" role="radio" aria-checked={value === 0} aria-label={t('zeroLabel')}
          onClick={() => choose(0)}
          className={cn(
            'me-1 rounded-md border px-2.5 py-1.5 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
          )}
        >
          {t('zero')}
        </button>
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = typeof value === 'number' && value >= n;
          return (
            <button
              key={n} type="button" role="radio" aria-checked={value === n}
              aria-label={t('starLabel', { count: n })}
              onClick={() => choose(n)}
              className="rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn('size-8 transition-colors', filled ? 'fill-amber-400 text-amber-400' : 'text-zinc-300')}
                strokeWidth={1.5}
              />
            </button>
          );
        })}
      </div>
      {!required && typeof value === 'number' && (
        <button type="button" onClick={() => onChange(null)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {t('clear')}
        </button>
      )}
    </div>
  );
}

export function FeedbackAnswerForm({ token, questions, previous }: Props) {
  const t = useTranslations('feedbackPage');
  const [values, setValues] = useState<Values>(() => initialValues(previous));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [answeredBefore, setAnsweredBefore] = useState(Boolean(previous));

  const set = (qid: string, patch: Values[string]) =>
    setValues((v) => ({ ...v, [qid]: { ...v[qid], ...patch } }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Point at the first missing required answer before asking the server.
    for (const q of questions) {
      const v = values[q.id];
      const missing = q.kind === 'RATING' ? typeof v?.rating !== 'number' : !(v?.text ?? '').trim();
      if (q.required && missing) {
        setError(t('errorMissing', { label: q.label }));
        document.getElementById(`q-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    const answers: FeedbackAnswer[] = questions.map((q) => (q.kind === 'RATING'
      ? { questionId: q.id, rating: values[q.id]?.rating ?? null }
      : { questionId: q.id, text: values[q.id]?.text ?? '' }));

    setSending(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, answers }),
      });
      if (res.ok) { setDone(true); setAnsweredBefore(true); window.scrollTo({ top: 0 }); return; }
      const body = await res.json().catch(() => null) as
        { error?: { code?: string; message?: string; details?: { questionId?: string } } } | null;
      if (res.status === 429) setError(t('errorRate'));
      else if (body?.error?.code === 'MISSING_REQUIRED') {
        const q = questions.find((x) => x.id === body.error?.details?.questionId);
        setError(q ? t('errorMissing', { label: q.label }) : t('errorGeneric'));
      } else setError(body?.error?.message ?? t('errorGeneric'));
    } catch {
      setError(t('errorGeneric'));
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-4 py-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-primary" />
        <h2 className="text-xl font-bold">{t('thanksTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('thanksBody')}</p>
        {token.startsWith('p.') && (
          <Button variant="outline" onClick={() => setDone(false)}>{t('editAgain')}</Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-1" noValidate>
      <p className="flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2.5 text-sm text-foreground">
        <Lock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        {t('privateNote')}
      </p>
      {answeredBefore && (
        <p className="pt-2 text-sm text-muted-foreground">{t('alreadyAnswered')}</p>
      )}

      {questions.map((q) => (
        <div
          key={q.id} id={`q-${q.id}`} role="group" aria-labelledby={`q-${q.id}-label`}
          className="space-y-2.5 border-b border-border py-5 last:border-0"
        >
          <p id={`q-${q.id}-label`} className="text-[15px] font-semibold leading-snug">
            <span dir="auto">{q.label}</span>
            {q.required && <span className="ms-0.5 text-destructive" aria-hidden>*</span>}
          </p>
          {q.kind === 'RATING' ? (
            <StarInput
              id={`q-${q.id}`} required={q.required}
              value={values[q.id]?.rating}
              onChange={(rating) => set(q.id, { rating })}
            />
          ) : (
            <textarea
              aria-labelledby={`q-${q.id}-label`}
              dir="auto"
              value={values[q.id]?.text ?? ''}
              onChange={(e) => set(q.id, { text: e.target.value })}
              maxLength={2000}
              rows={3}
              placeholder={t('textPlaceholder')}
              // 16px: iOS zooms the page into any smaller field.
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </div>
      ))}

      <p className="pt-1 text-xs text-muted-foreground">{t('requiredHint')}</p>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="pt-3">
        <Button type="submit" className="w-full sm:w-auto" loading={sending}>
          {sending ? t('submitting') : answeredBefore ? t('update') : t('submit')}
        </Button>
      </div>
    </form>
  );
}
