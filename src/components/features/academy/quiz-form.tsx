'use client';

/** A module quiz: answer every question, see the score and which ones to look at again, retry. */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface Question { id: string; prompt: string; options: string[] }
interface Result { bestScore: number; attempts: number; passedAt: string | null }
interface Outcome { score: number; passed: boolean; wrong: string[]; result: Result }

export function QuizForm({ courseId, moduleId, questions, passScore, initial, backHref }: {
  courseId: string; moduleId: string; questions: Question[]; passScore: number; initial: Result | null; backHref: string;
}) {
  const t = useTranslations('academy.learning.quiz');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const best = outcome?.result ?? initial;
  const complete = questions.every((q) => answers[q.id] !== undefined);
  const pct = (n: number) => Math.round(n * 100);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<Outcome>(`/academy/learn/${courseId}/quiz/${moduleId}`, { answers });
      setOutcome(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['RATE_LIMITED', 'INVALID_ANSWERS'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t('rule', { percent: pct(passScore) })}</p>
      {best?.passedAt && !outcome && <p className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-3 text-sm font-semibold text-primary"><CheckCircle2 className="size-4" aria-hidden />{t('alreadyPassed', { percent: pct(best.bestScore) })}</p>}
      {outcome && (
        <div role="status" className={cn('rounded-xl px-4 py-3 text-sm', outcome.passed ? 'bg-primary/10 text-primary' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200')}>
          <p className="flex items-center gap-2 font-bold">
            {outcome.passed ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
            {outcome.passed ? t('passed', { percent: pct(outcome.score) }) : t('failed', { percent: pct(outcome.score) })}
          </p>
          {outcome.passed
            ? <Link href={backHref} className="mt-1 inline-block font-semibold underline">{t('backToCourse')}</Link>
            : <p className="mt-1">{t('retryHint')}</p>}
        </div>
      )}

      <ol className="space-y-4">
        {questions.map((q, i) => {
          const wrong = outcome?.wrong.includes(q.id);
          return (
            <li key={q.id} className={cn('rounded-2xl border p-4', wrong ? 'border-amber-400' : 'border-border')}>
              <fieldset>
                <legend className="font-semibold">{i + 1}. {q.prompt}</legend>
                {wrong && <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-400">{t('wrong')}</p>}
                <div className="mt-3 space-y-2">
                  {q.options.map((o, oi) => (
                    <label key={oi} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm', answers[q.id] === oi ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50')}>
                      <input type="radio" name={q.id} className="mt-0.5 accent-[hsl(var(--primary))]" checked={answers[q.id] === oi}
                        onChange={() => { setAnswers((a) => ({ ...a, [q.id]: oi })); setOutcome(null); }} />
                      <span>{o}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <Button size="lg" className="w-full sm:w-auto" disabled={busy || !complete} onClick={submit}>
        {busy && <Loader2 className="me-1 size-4 animate-spin" />}{outcome && !outcome.passed ? t('retry') : t('submit')}
      </Button>
      {best && <p className="text-xs text-muted-foreground">{t('best', { percent: pct(best.bestScore), attempts: best.attempts })}</p>}
    </div>
  );
}
