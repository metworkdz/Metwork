'use client';

/**
 * The « Avis » tab of a program: the questions, who it was sent to, and the
 * private results. Shared by the incubator dashboard and the consultant
 * portal — only `apiBase` differs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BarChart3, ListChecks, Loader2, Send } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { FeedbackQuestion } from '@/server/feedback/types';

import { FeedbackEditor, toEditable, type FormState } from './feedback-editor';
import { FeedbackResultsView } from './feedback-results';
import { FeedbackSend } from './feedback-send';
import { errorMessage, type FeedbackApiBase } from './shared';

interface FormResponse {
  form: {
    id: string | null; title: string; intro: string | null; questions: FeedbackQuestion[];
    isOpen: boolean; sharedLinkEnabled: boolean; sharedLinkVersion: number;
  };
  saved: boolean;
  hasResponses: boolean;
  sharedUrl: string | null;
}

type View = 'questions' | 'send' | 'results';

export function FeedbackPanel({ programId, apiBase }: { programId: string; apiBase: FeedbackApiBase }) {
  const t = useTranslations('feedback');
  const locale = useLocale();
  const base = `${apiBase}/${programId}/feedback`;
  const [data, setData] = useState<FormResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('questions');
  /** Bumped on every load so the editor restarts from what was saved. */
  const [version, setVersion] = useState(0);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${base}?lang=${encodeURIComponent(locale)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(await errorMessage(res, t('loadFailed')));
      const body = await res.json() as FormResponse;
      setData(body);
      setVersion((v) => v + 1);
      setError(null);
      // A saved form opens on what the host most likely came for.
      return body;
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadFailed'));
      return null;
    }
  }, [base, locale, t]);

  useEffect(() => {
    void load().then((body) => { if (body?.saved) setView(body.hasResponses ? 'results' : 'send'); });
  }, [load]);

  if (error && !data) return <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!data) return <div className="flex justify-center py-12 text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>;

  const initial: FormState = {
    title: data.form.title,
    intro: data.form.intro ?? '',
    isOpen: data.form.isOpen,
    sharedLinkEnabled: data.form.sharedLinkEnabled,
    questions: toEditable(data.saved ? data.form.questions : data.form.questions.map((q) => ({ ...q, id: null }))),
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="tablist">
          {([
            ['questions', t('viewQuestions'), ListChecks],
            ['send', t('viewSend'), Send],
            ['results', t('viewResults'), BarChart3],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id} type="button" role="tab" aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn(
                'inline-flex min-h-9 items-center gap-2 rounded-md px-3.5 text-sm font-medium transition-colors',
                view === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <span className={cn(
          'rounded-full px-2.5 py-0.5 text-xs font-medium',
          !data.saved ? 'bg-muted text-muted-foreground' : data.form.isOpen ? 'bg-primary/15 text-primary' : 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-300',
        )}>
          {!data.saved ? t('statusDraft') : data.form.isOpen ? t('statusOpen') : t('statusClosed')}
        </span>
      </div>

      {/* All three stay mounted: switching views never loses unsaved edits. */}
      <div hidden={view !== 'questions'}>
        <FeedbackEditor
          key={version} base={base} initial={initial}
          saved={data.saved} hasResponses={data.hasResponses} justSaved={justSaved}
          onSaved={() => { setJustSaved(true); void load(); }}
        />
      </div>
      <div hidden={view !== 'send'}>
        <FeedbackSend
          base={base} active={view === 'send'}
          saved={data.saved} isOpen={data.form.isOpen} sharedUrl={data.sharedUrl}
          onRotated={() => void load()}
        />
      </div>
      <div hidden={view !== 'results'}>
        <FeedbackResultsView base={base} active={view === 'results'} />
      </div>
    </div>
  );
}
