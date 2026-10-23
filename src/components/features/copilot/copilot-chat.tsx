'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUp, BookOpen, Scale, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import type { CopilotAnswer, CopilotQuota, CopilotSource } from '@/server/copilot/service';

interface Exchange {
  question: string;
  /** Plain text while streaming; replaced by `answer` when done. */
  draft: string;
  answer: CopilotAnswer | null;
  error: string | null;
}

interface Props {
  initialQuota: CopilotQuota;
  kbReady: boolean;
  suggestions: string[];
  membershipHref: string;
  /** Question passed in the URL (e.g. from a tax task). */
  initialQuestion?: string;
}

const ERROR_KEYS: Record<string, string> = {
  QUOTA_EXCEEDED: 'errorQuota',
  KB_UNAVAILABLE: 'errorKb',
  AI_UNAVAILABLE: 'errorAi',
  OFF_TOPIC: 'errorOffTopic',
  REFUSED: 'errorRefused',
  RATE_LIMITED: 'errorRate',
};

/** The tax copilot: answers from the legal texts, every claim cited. */
export function CopilotChat({ initialQuota, kbReady, suggestions, membershipHref, initialQuestion }: Props) {
  const t = useTranslations('copilot');
  const locale = useLocale() as 'fr' | 'en' | 'ar';
  const [quota, setQuota] = useState(initialQuota);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const outOfQuestions = quota.remaining === 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [exchanges]);

  const patchLast = (patch: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) =>
    setExchanges((xs) => xs.map((x, i) => (i === xs.length - 1 ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || busy || outOfQuestions) return;
    const history = exchanges
      .filter((x) => x.answer)
      .map((x) => ({ question: x.question, answer: x.answer!.segments.map((s) => s.text).join('') }));
    setExchanges((xs) => [...xs, { question: text, draft: '', answer: null, error: null }]);
    setQuestion('');
    setBusy(true);
    try {
      const res = await fetch('/api/copilot/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: text, lang: locale, history }),
      });
      if (!res.ok || !res.body) {
        const code = ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? 'AI_UNAVAILABLE';
        if (code === 'QUOTA_EXCEEDED') setQuota((qq) => ({ ...qq, remaining: 0 }));
        patchLast({ error: t(ERROR_KEYS[code] ?? 'errorAi') });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as
            | { type: 'text'; text: string }
            | { type: 'done'; answer: CopilotAnswer; quota: CopilotQuota }
            | { type: 'error'; code: string };
          if (ev.type === 'text') patchLast((x) => ({ draft: x.draft + ev.text }));
          else if (ev.type === 'done') { patchLast({ answer: ev.answer }); setQuota(ev.quota); }
          else patchLast({ error: t(ERROR_KEYS[ev.code] ?? 'errorAi') });
        }
      }
    } catch {
      patchLast({ error: t('errorAi') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="note" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
        <Scale className="mt-0.5 size-4 shrink-0" />
        <p>{t('disclaimer')}</p>
      </div>

      {!kbReady ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{t('kbNotReady')}</p>
      ) : (
        <>
          {exchanges.length === 0 && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-medium"><Sparkles className="size-4 text-primary" />{t('suggestionsTitle')}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || outOfQuestions}
                    onClick={() => void ask(s)}
                    className="min-h-[44px] rounded-lg border px-3 py-2 text-start text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-5">
            {exchanges.map((x, i) => (
              <div key={i} className="space-y-3">
                <p className="ms-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">{x.question}</p>
                <div className="max-w-full rounded-2xl rounded-es-sm border bg-card px-4 py-3 text-sm leading-relaxed">
                  {x.answer ? (
                    <AnswerBody answer={x.answer} />
                  ) : x.error ? (
                    <p role="alert" className="text-destructive">{x.error}</p>
                  ) : x.draft ? (
                    <p className="whitespace-pre-wrap">{x.draft}</p>
                  ) : (
                    <p className="animate-pulse text-muted-foreground">{t('searching')}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          <form
            className="sticky bottom-16 z-10 rounded-xl border bg-background p-2 shadow-sm md:bottom-2"
            onSubmit={(e) => { e.preventDefault(); void ask(question); }}
          >
            <label htmlFor="copilot-q" className="sr-only">{t('placeholder')}</label>
            <div className="flex items-end gap-2">
              <Textarea
                id="copilot-q"
                rows={2}
                maxLength={1000}
                value={question}
                disabled={outOfQuestions}
                placeholder={outOfQuestions ? t('errorQuota') : t('placeholder')}
                className="min-h-[44px] flex-1 resize-none border-0 text-base shadow-none focus-visible:ring-0 sm:text-sm"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); }
                }}
              />
              <Button type="submit" size="icon" className="size-11 shrink-0" loading={busy} disabled={question.trim().length < 3 || outOfQuestions} aria-label={t('send')}>
                <ArrowUp className="size-5" />
              </Button>
            </div>
            <p className="px-2 pb-1 pt-1.5 text-xs text-muted-foreground">
              {quota.limit === null ? t('quotaUnlimited') : t('quotaLeft', { count: quota.remaining ?? 0, limit: quota.limit })}
              {quota.limit !== null && (
                <> · <Link href={membershipHref} className="font-medium text-primary hover:underline">{t('upgrade')}</Link></>
              )}
            </p>
          </form>
        </>
      )}
    </div>
  );
}

/** **bold** and line breaks — the only formatting the answers need. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part.replace(/^#{1,4} /gm, '')}</Fragment>,
      )}
    </>
  );
}

function AnswerBody({ answer }: { answer: CopilotAnswer }) {
  const t = useTranslations('copilot');
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-3">
      <p className="whitespace-pre-wrap">
        {answer.segments.map((s, i) => (
          <Fragment key={i}>
            <Rich text={s.text} />
            {s.sources.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOpen(open === n ? null : n)}
                className="mx-0.5 inline-flex min-w-[1.4rem] items-center justify-center rounded bg-primary-50 px-1 align-super text-[10px] font-semibold text-primary-700 hover:bg-primary-100"
                aria-label={t('sourceN', { n })}
              >
                {n}
              </button>
            ))}
          </Fragment>
        ))}
      </p>
      {answer.sources.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><BookOpen className="size-3.5" />{t('sources')}</p>
          <ol className="space-y-1.5">
            {answer.sources.map((s) => <SourceItem key={s.n} source={s} open={open === s.n} onToggle={() => setOpen(open === s.n ? null : s.n)} />)}
          </ol>
        </div>
      )}
    </div>
  );
}

function SourceItem({ source, open, onToggle }: { source: CopilotSource; open: boolean; onToggle: () => void }) {
  const t = useTranslations('copilot');
  return (
    <li className={cn('rounded-md border text-xs', open && 'bg-muted/40')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[40px] w-full items-start gap-2 p-2 text-start">
        <span className="font-semibold text-primary-700">{source.n}.</span>
        <span className="min-w-0">
          <span className="block font-medium">{source.title}</span>
          <span className="block text-muted-foreground">
            {[source.article, t('page', { page: source.page })].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
      {open && source.quotes.map((q, i) => (
        <blockquote key={i} dir="ltr" className="mx-2 mb-2 whitespace-pre-wrap border-s-2 border-primary/40 ps-2 text-muted-foreground">{q}</blockquote>
      ))}
    </li>
  );
}
