'use client';

/**
 * A module's end-of-module quiz in the course builder: questions with 2–5
 * options and one right answer, in the builder's current language. "Draft
 * with AI" asks the server for questions built from the module's saved
 * lessons; they land here to be checked and edited before saving.
 *
 * Rendered inside the module's <fieldset>, so a locked module locks this too.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { localizedText, type LocalizedText } from '@/lib/localized-text';
import { ACADEMY_QUIZ_MAX_OPTIONS, ACADEMY_QUIZ_MAX_QUESTIONS, ACADEMY_QUIZ_MIN_OPTIONS } from '@/lib/academy';
import type { Locale } from '@/i18n/config';
import { LocalizedField } from './localized-field';

export interface QuizQuestionState {
  key: string;
  id?: string;
  prompt: LocalizedText | null;
  options: (LocalizedText | null)[];
  correctIndex: number;
}

let seq = 0;
const tmpKey = () => `q-${++seq}`;

export function newQuestion(): QuizQuestionState {
  return { key: tmpKey(), prompt: null, options: [null, null, null, null], correctIndex: 0 };
}

/** A question is ready to save when it has a prompt and every option has text. */
export function isQuestionComplete(q: QuizQuestionState): boolean {
  return Boolean(q.prompt && q.options.length >= ACADEMY_QUIZ_MIN_OPTIONS && q.options.every(Boolean));
}

interface Props {
  questions: QuizQuestionState[];
  lang: Locale;
  onChange(next: QuizQuestionState[]): void;
  /** The draft endpoint, once the module is saved (it reads the stored lessons). */
  draftUrl: string | null;
  moduleId?: string;
}

export function QuizEditor({ questions, lang, onChange, draftUrl, moduleId }: Props) {
  const t = useTranslations('academyAdmin.builder.quiz');
  const [open, setOpen] = useState(questions.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (i: number, p: Partial<QuizQuestionState>) => onChange(questions.map((q, j) => (j === i ? { ...q, ...p } : q)));

  async function draft() {
    if (!draftUrl || !moduleId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ language: Locale; questions: { prompt: string; options: string[]; correctIndex: number }[] }>(draftUrl, { moduleId, count: 5 });
      const drafted = res.questions.map((q) => ({
        key: tmpKey(),
        prompt: localizedText(res.language, q.prompt),
        options: q.options.map((o) => localizedText(res.language, o)),
        correctIndex: q.correctIndex,
      }));
      onChange([...questions, ...drafted].slice(0, ACADEMY_QUIZ_MAX_QUESTIONS));
    } catch (err) {
      const code = err instanceof ApiClientError ? err.code : '';
      setError(['UNAVAILABLE', 'NO_LESSONS', 'RATE_LIMITED', 'LOCKED'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));
    } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <div className="border-t border-border p-3">
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}><Plus className="me-1 size-4" />{t('add')}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 border-t border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold">{t('title', { count: questions.length })}</p>
        <Button type="button" variant="outline" size="sm" disabled={busy || !draftUrl} onClick={draft} title={draftUrl ? undefined : t('saveFirst')}>
          {busy ? <Loader2 className="me-1 size-4 animate-spin" /> : <Sparkles className="me-1 size-4" />}{t('draft')}
        </Button>
      </div>
      {!draftUrl && <p className="text-xs text-muted-foreground">{t('saveFirst')}</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">{t('hint')}</p>
      <ol className="space-y-3">
        {questions.map((q, qi) => (
          <li key={q.key} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-start gap-2">
              <span className="mt-2 w-6 text-xs font-bold text-muted-foreground">{qi + 1}.</span>
              <div className="min-w-0 flex-1">
                <LocalizedField id={`qq-${q.key}`} value={q.prompt} lang={lang} maxLength={300} multiline aria-label={t('prompt')} placeholder={t('prompt')}
                  onChange={(v) => patch(qi, { prompt: v })} />
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={t('removeQuestion')} onClick={() => onChange(questions.filter((_, j) => j !== qi))}><Trash2 className="size-4" /></Button>
            </div>
            <div className="space-y-1.5 ps-8" role="radiogroup" aria-label={t('correct')}>
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${q.key}`} checked={q.correctIndex === oi} aria-label={t('markCorrect', { n: oi + 1 })}
                    onChange={() => patch(qi, { correctIndex: oi })} className="size-4 shrink-0 accent-[hsl(var(--primary))]" />
                  <div className="min-w-0 flex-1">
                    <LocalizedField id={`qo-${q.key}-${oi}`} value={o} lang={lang} maxLength={200} aria-label={t('option', { n: oi + 1 })} placeholder={t('option', { n: oi + 1 })}
                      onChange={(v) => patch(qi, { options: q.options.map((x, k) => (k === oi ? v : x)) })} />
                  </div>
                  {q.options.length > ACADEMY_QUIZ_MIN_OPTIONS && (
                    <Button type="button" variant="ghost" size="icon" aria-label={t('removeOption')} onClick={() => patch(qi, {
                      options: q.options.filter((_, k) => k !== oi),
                      correctIndex: q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex,
                    })}><Trash2 className="size-3.5" /></Button>
                  )}
                </div>
              ))}
              {q.options.length < ACADEMY_QUIZ_MAX_OPTIONS && (
                <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => patch(qi, { options: [...q.options, null] })}>{t('addOption')}</button>
              )}
            </div>
          </li>
        ))}
      </ol>
      {questions.length < ACADEMY_QUIZ_MAX_QUESTIONS && (
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...questions, newQuestion()])}><Plus className="me-1 size-4" />{t('addQuestion')}</Button>
      )}
    </div>
  );
}
