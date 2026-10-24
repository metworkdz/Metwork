'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowUp, Check, Copy, Globe, SquarePen, Sparkles } from 'lucide-react';
import { Link } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import type { CopilotAnswer, CopilotQuota, CopilotSource } from '@/server/copilot/service';
import type { GuideId, GuideProgressView } from '@/lib/creation-guides';
import { GuideChooser, GuideSteps, GuidesHome, putProgress } from '@/components/features/copilot/creation-guides';

interface Exchange {
  question: string;
  /** Plain text while streaming; replaced by `answer` when done. */
  draft: string;
  /** The texts didn't cover it and the answer is being looked up on the web. */
  web: boolean;
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
  /** Where the user is in a business-creation guide. */
  initialGuideProgress: GuideProgressView | null;
}

type View = { kind: 'chat' } | { kind: 'chooser' } | { kind: 'guide'; guide: GuideId };

const ERROR_KEYS: Record<string, string> = {
  QUOTA_EXCEEDED: 'errorQuota',
  KB_UNAVAILABLE: 'errorKb',
  AI_UNAVAILABLE: 'errorAi',
  OFF_TOPIC: 'errorOffTopic',
  REFUSED: 'errorRefused',
  RATE_LIMITED: 'errorRate',
};

/**
 * The copilot, as a chat: answers from the legal texts with their sources,
 * and from the web (flagged, with links) when the texts don't cover it.
 */
export function CopilotChat({ initialQuota, kbReady, suggestions, membershipHref, initialQuestion, initialGuideProgress }: Props) {
  const t = useTranslations('copilot');
  const locale = useLocale() as 'fr' | 'en' | 'ar';
  const [quota, setQuota] = useState(initialQuota);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [question, setQuestion] = useState(initialQuestion ?? '');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>({ kind: 'chat' });
  const [guideProgress, setGuideProgress] = useState(initialGuideProgress);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const outOfQuestions = quota.remaining === 0;

  useEffect(() => {
    if (exchanges.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [exchanges]);

  // Grow the composer with its text, up to ~6 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

  const patchLast = (patch: Partial<Exchange> | ((e: Exchange) => Partial<Exchange>)) =>
    setExchanges((xs) => xs.map((x, i) => (i === xs.length - 1 ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x)));

  async function ask(q: string) {
    const text = q.trim();
    if (text.length < 3 || busy || outOfQuestions) return;
    const history = exchanges
      .filter((x) => x.answer)
      .map((x) => ({ question: x.question, answer: x.answer!.segments.map((s) => s.text).join('') }));
    setExchanges((xs) => [...xs, { question: text, draft: '', web: false, answer: null, error: null }]);
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
            | { type: 'status'; stage: 'web' }
            | { type: 'done'; answer: CopilotAnswer; quota: CopilotQuota }
            | { type: 'error'; code: string };
          if (ev.type === 'text') patchLast((x) => ({ draft: x.draft + ev.text }));
          else if (ev.type === 'status') patchLast({ web: true, draft: '' });
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

  function openGuide(target: 'CHOOSER' | GuideId) {
    setView(target === 'CHOOSER' ? { kind: 'chooser' } : { kind: 'guide', guide: target });
    window.scrollTo({ top: 0 });
  }

  /** Chooser picked a guide: make it the user's guide (shared steps carry over). */
  async function startGuide(guide: GuideId) {
    const saved = await putProgress(guide, guideProgress?.done ?? []).catch(() => null);
    if (saved) setGuideProgress(saved);
    openGuide(guide);
  }

  function askFromGuide(q: string) {
    setView({ kind: 'chat' });
    void ask(q);
  }

  function newChat() {
    if (busy) return;
    setView({ kind: 'chat' });
    setExchanges([]);
    setQuestion('');
    inputRef.current?.focus();
  }

  const quotaBadge = quota.limit === null ? t('badgeUnlimited') : t('badgeLeft', { count: quota.remaining ?? 0 });
  const empty = exchanges.length === 0;

  return (
    // Fills the screen between the app header and the bottom nav, so the
    // composer sits at the bottom even when the chat is short.
    <div className="mx-auto flex min-h-[calc(100dvh-3.5rem-9rem-env(safe-area-inset-bottom))] w-full max-w-3xl flex-col lg:min-h-[calc(100dvh-4rem-4rem)]">
      <header className="-mx-4 -mt-6 mb-2 flex h-14 items-center justify-between gap-2 border-b border-border/70 bg-background/95 px-4 backdrop-blur sm:-mx-6 sm:-mt-8 sm:px-6 lg:mx-0 lg:mt-0 lg:rounded-2xl lg:border">
        <h1 className="flex min-w-0 items-center gap-2 font-display text-base font-bold">
          <span className="truncate">{t('chatTitle')}</span>
          <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[0.6875rem] font-semibold text-primary-700">{quotaBadge}</span>
        </h1>
        <button
          type="button"
          onClick={newChat}
          disabled={busy || (empty && view.kind === 'chat')}
          aria-label={t('newChat')}
          title={t('newChat')}
          className="flex size-11 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <SquarePen className="size-5" />
        </button>
      </header>

      {view.kind === 'chooser' ? (
        <GuideChooser progress={guideProgress} onBack={() => setView({ kind: 'chat' })} onStart={(g) => void startGuide(g)} />
      ) : view.kind === 'guide' ? (
        <GuideSteps
          guide={view.guide}
          progress={guideProgress}
          onBack={() => setView({ kind: 'chat' })}
          onChange={setGuideProgress}
          onSwitch={() => setView({ kind: 'chooser' })}
          onAsk={askFromGuide}
        />
      ) : !kbReady ? (
        <p className="mt-6 rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{t('kbNotReady')}</p>
      ) : (
        <>
          {empty ? (
            <div className="flex flex-col items-center px-2 pb-6 pt-10 text-center sm:pt-16">
              <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_20px_rgba(26,127,55,0.3)]">
                <Sparkles className="size-7" />
              </span>
              <h2 className="mt-4 font-display text-2xl font-extrabold tracking-tight">{t('emptyTitle')}</h2>
              <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{t('subtitle')}</p>
              <div className="mt-6 w-full">
                <GuidesHome progress={guideProgress} onOpen={openGuide} onAsk={(q) => void ask(q)} />
              </div>
              <div className="mt-5 grid w-full gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={busy || outOfQuestions}
                    onClick={() => void ask(s)}
                    className="min-h-14 rounded-2xl border border-border bg-background px-4 py-3 text-start text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-4 pt-4">
              {exchanges.map((x, i) => (
                <div key={i} className="space-y-4">
                  <p dir="auto" className="ms-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-3xl bg-muted px-4 py-2.5 text-[0.9375rem] leading-relaxed">
                    {x.question}
                  </p>
                  <div className="flex gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Sparkles className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1 pt-1 text-[0.9375rem] leading-relaxed">
                      {x.answer ? (
                        <AnswerBody answer={x.answer} />
                      ) : x.error ? (
                        <p role="alert" className="text-destructive">{x.error}</p>
                      ) : x.draft ? (
                        <p dir="auto" className="whitespace-pre-wrap"><Rich text={x.draft} /><span className="ms-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/60 align-middle" /></p>
                      ) : (
                        <Thinking label={x.web ? t('searchingWeb') : t('searching')} web={x.web} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          <div className="sticky bottom-0 z-10 -mx-1 -mb-[calc(6rem+env(safe-area-inset-bottom))] mt-auto bg-gradient-to-t from-background from-90% to-transparent px-1 pb-[calc(6.25rem+env(safe-area-inset-bottom))] pt-4 lg:-mb-0 lg:pb-4">
            <form
              className="flex items-end gap-2 rounded-[1.625rem] border border-border bg-background py-1.5 pe-1.5 ps-4 shadow-[0_4px_16px_rgba(14,59,30,0.08)] focus-within:border-primary/50"
              onSubmit={(e) => { e.preventDefault(); void ask(question); }}
            >
              <label htmlFor="copilot-q" className="sr-only">{t('placeholder')}</label>
              <textarea
                id="copilot-q"
                ref={inputRef}
                rows={1}
                maxLength={1000}
                dir="auto"
                value={question}
                disabled={outOfQuestions}
                placeholder={outOfQuestions ? t('errorQuota') : t('placeholder')}
                className="max-h-40 min-h-11 flex-1 resize-none bg-transparent py-2.5 text-base leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(question); }
                }}
              />
              <button
                type="submit"
                disabled={busy || question.trim().length < 3 || outOfQuestions}
                aria-label={t('send')}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-35"
              >
                <ArrowUp className="size-5" strokeWidth={2.4} />
              </button>
            </form>
            {quota.limit !== null && (
              <p className="px-3 pb-1 pt-1.5 text-center text-xs text-muted-foreground">
                {t('quotaLeft', { count: quota.remaining ?? 0, limit: quota.limit })} ·{' '}
                <Link href={membershipHref} className="font-medium text-primary hover:underline">{t('upgrade')}</Link>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Thinking({ label, web }: { label: string; web: boolean }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      {web && <Globe className="size-4 text-blue-600" />}
      <span className="flex gap-1" aria-hidden>
        {[0, 150, 300].map((d) => (
          <span key={d} className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: `${d}ms` }} />
        ))}
      </span>
      {label}
    </p>
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

function hostOf(url: string | null): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function AnswerBody({ answer }: { answer: CopilotAnswer }) {
  const t = useTranslations('copilot');
  const [open, setOpen] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const web = answer.origin === 'WEB';
  const plain = answer.segments.map((s) => s.text).join('');
  const opened = answer.sources.find((s) => s.n === open && s.kind === 'DOC');

  async function copy() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked: nothing to do */ }
  }

  return (
    <div className="space-y-3">
      {web && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-blue-700 dark:text-blue-300">
          <Globe className="size-3.5" />{t('fromWeb')}
        </p>
      )}
      <p dir="auto" className="whitespace-pre-wrap">
        {answer.segments.map((s, i) => (
          <Fragment key={i}>
            <Rich text={s.text} />
            {s.sources.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOpen(open === n ? null : n)}
                className={cn(
                  'mx-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 align-super text-[10px] font-semibold',
                  web ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' : 'bg-primary-50 text-primary-700',
                )}
                aria-label={t('sourceN', { n })}
              >
                {n}
              </button>
            ))}
          </Fragment>
        ))}
      </p>

      {answer.sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {answer.sources.map((s) => <SourceChip key={s.n} source={s} active={open === s.n} onToggle={() => setOpen(open === s.n ? null : s.n)} />)}
        </div>
      )}
      {opened && opened.quotes.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border bg-muted/30 p-3 text-xs">
          <p className="font-semibold">{opened.title}{opened.article ? ` · ${opened.article}` : ''} · {t('page', { page: opened.page })}</p>
          {opened.quotes.map((q, i) => (
            <blockquote key={i} dir="ltr" className="whitespace-pre-wrap border-s-2 border-primary/40 ps-2 text-muted-foreground">{q}</blockquote>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? t('copied') : t('copy')}
        title={copied ? t('copied') : t('copy')}
        className="-ms-2 flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {copied ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

function SourceChip({ source, active, onToggle }: { source: CopilotSource; active: boolean; onToggle: () => void }) {
  const t = useTranslations('copilot');
  if (source.kind === 'WEB' && source.url) {
    return (
      <a
        href={source.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        title={source.title}
        className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50/70 px-3 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
      >
        <span className="font-semibold">{source.n}</span>
        <span className="truncate">{t('webSource')} · {hostOf(source.url)}</span>
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={active}
      title={source.title}
      className={cn(
        'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
        active ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      <span className="font-semibold">{source.n}</span>
      <span className="truncate">{[source.title, source.article].filter(Boolean).join(' · ')}</span>
    </button>
  );
}
