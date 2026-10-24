'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeft, Check, ChevronRight, Clock, Download, ExternalLink, MessageCircleQuestion, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  GUIDE_STEPS,
  nextStep,
  recommend,
  stepsOf,
  type Capital,
  type ChooserAnswers,
  type GuideId,
  type GuideProgressView,
  type Offer,
  type Partners,
  type StepId,
} from '@/lib/creation-guides';

/* ─────────────────────────── Progress (client) ─────────────────────────── */

export async function putProgress(guide: GuideId, done: StepId[]): Promise<GuideProgressView | null> {
  const res = await fetch('/api/copilot/guide', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guide, done }),
  });
  if (!res.ok) return null;
  return ((await res.json()) as { progress: GuideProgressView }).progress;
}

/* ─────────────────────────── Home ─────────────────────────── */

const CARDS: { id: 'CHOOSER' | GuideId; mark: string; tone: string }[] = [
  { id: 'CHOOSER', mark: '?', tone: 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  { id: 'SARL', mark: 'SM', tone: 'bg-primary-50 text-primary-700' },
  { id: 'PP', mark: 'PP', tone: 'bg-primary-50 text-primary-700' },
  { id: 'AE', mark: 'AE', tone: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
];

/** Guides block shown in the copilot's empty state. */
export function GuidesHome({
  progress,
  onOpen,
  onAsk,
}: {
  progress: GuideProgressView | null;
  onOpen: (target: 'CHOOSER' | GuideId) => void;
  onAsk: (question: string) => void;
}) {
  const t = useTranslations('guides');
  const next = progress ? nextStep(progress.guide, progress.done) : null;
  const total = progress ? GUIDE_STEPS[progress.guide].length : 0;

  return (
    <div className="w-full space-y-5 text-start">
      {progress && (
        <button
          type="button"
          onClick={() => onOpen(progress.guide)}
          className="flex w-full flex-col gap-2.5 rounded-[1.375rem] bg-[#0E3B1E] p-4 text-start text-white shadow-[0_12px_28px_rgba(14,59,30,0.2)]"
        >
          <span className="flex items-center justify-between gap-2 text-xs">
            <span className="text-[#B9DDC3]">{t('resumeEyebrow', { guide: t(`kinds.${progress.guide}.title`) })}</span>
            <span className="font-bold tabular-nums">{t('progress', { done: progress.done.length, total })}</span>
          </span>
          <span className="font-display text-[1.0625rem] font-extrabold leading-snug">
            {next ? t('resumeNext', { step: t(`steps.${next}.title`) }) : t('resumeDone')}
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-[#194B2A]" aria-hidden>
            <span className="block h-full rounded-full bg-[#2ECC71]" style={{ width: `${Math.max(4, (progress.done.length / total) * 100)}%` }} />
          </span>
          <span className="text-[0.8125rem] font-semibold text-[#B9DDC3]">{t('resumeCta')} →</span>
        </button>
      )}

      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('homeTitle')}</h3>
        <div className="grid grid-cols-2 gap-2.5">
          {CARDS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c.id)}
              className="flex min-h-[6.5rem] flex-col gap-2 rounded-[1.125rem] border border-border bg-background p-3.5 text-start transition-colors hover:bg-muted/50"
            >
              <span className={cn('flex size-9 items-center justify-center rounded-xl font-display text-sm font-extrabold', c.tone)}>{c.mark}</span>
              <span className="text-sm font-semibold leading-snug">{c.id === 'CHOOSER' ? t('chooser.title') : t(`kinds.${c.id}.card`)}</span>
              <span className="text-xs text-muted-foreground">
                {c.id === 'CHOOSER' ? t('chooser.sub') : `${t(`kinds.${c.id}.sub`)} · ${t('stepsCount', { count: GUIDE_STEPS[c.id].length })}`}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('faqTitle')}</h3>
        <div className="flex flex-wrap gap-2">
          {(['q1', 'q2', 'q3', 'q4', 'q5'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onAsk(t(`faq.${k}`))}
              className="min-h-10 rounded-full border border-border bg-background px-3.5 py-2 text-start text-[0.8125rem] transition-colors hover:bg-muted/60"
            >
              {t(`faq.${k}`)}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────── Shared header ─────────────────────────── */

function ViewHeader({ title, sub, onBack, children }: { title: string; sub?: string; onBack: () => void; children?: React.ReactNode }) {
  const t = useTranslations('guides');
  return (
    <div className="space-y-3 pb-2 pt-3">
      <div className="flex items-center gap-1">
        <button type="button" onClick={onBack} aria-label={t('back')} className="-ms-2 flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-muted">
          <ArrowLeft className="size-5 rtl:rotate-180" />
        </button>
        <div className="min-w-0">
          <h2 className="truncate font-display text-[1.0625rem] font-extrabold">{title}</h2>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/* ─────────────────────────── Chooser ─────────────────────────── */

const QUESTIONS = [
  { key: 'offer', options: ['PRODUCTS', 'SERVICES'] },
  { key: 'partners', options: ['ALONE', 'PARTNERS'] },
  { key: 'capital', options: ['SMALL', 'MEDIUM', 'LARGE'] },
] as const;

/** "Which status for me?" — three tap-to-answer questions, then a recommendation. */
export function GuideChooser({
  progress,
  onBack,
  onStart,
}: {
  progress: GuideProgressView | null;
  onBack: () => void;
  onStart: (guide: GuideId) => void;
}) {
  const t = useTranslations('guides');
  const [answers, setAnswers] = useState<Partial<ChooserAnswers>>({});
  const [showAlt, setShowAlt] = useState(false);
  const asked = QUESTIONS.filter((q) => answers[q.key] !== undefined);
  const current = QUESTIONS.find((q) => answers[q.key] === undefined);
  const rec = current ? null : recommend(answers as ChooserAnswers);

  return (
    <div className="pb-4">
      <ViewHeader title={t('chooser.title')} sub={t('chooser.sub')} onBack={onBack} />
      <div className="space-y-4">
        {asked.map((q) => (
          <div key={q.key} className="space-y-2">
            <BotLine text={t(`chooser.${q.key}`)} />
            <p className="ms-auto w-fit rounded-full bg-muted px-3.5 py-2 text-sm">{t(`chooser.${q.key}${answers[q.key]!}`)}</p>
          </div>
        ))}

        {current && (
          <div className="space-y-2.5">
            <BotLine text={t(`chooser.${current.key}`)} />
            <div className="flex flex-col items-end gap-2">
              {current.options.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setAnswers((a) => ({ ...a, [current.key]: o as Offer & Partners & Capital }))}
                  className="min-h-11 rounded-full border border-primary/40 bg-background px-4 py-2 text-sm font-medium text-primary-700 transition-colors hover:bg-primary-50"
                >
                  {t(`chooser.${current.key}${o}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {rec && (
          <div className="space-y-3">
            <RecommendationCard guide={rec.guide} reason={t(`why.${rec.reason}`)} onStart={() => onStart(rec.guide)} primary />
            {showAlt ? (
              <RecommendationCard guide={rec.alternative} reason={t(`kinds.${rec.alternative}.summary`)} onStart={() => onStart(rec.alternative)} />
            ) : (
              <button type="button" onClick={() => setShowAlt(true)} className="mx-auto block min-h-11 text-sm font-medium text-muted-foreground hover:text-foreground">
                {t('compareWith', { guide: t(`kinds.${rec.alternative}.title`) })}
              </button>
            )}
            <button
              type="button"
              onClick={() => { setAnswers({}); setShowAlt(false); }}
              className="mx-auto flex min-h-11 items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-4" />{t('chooser.restart')}
            </button>
            {progress && progress.guide !== rec.guide && progress.done.length > 0 && (
              <p className="text-center text-xs text-muted-foreground">{t('progressLong', { done: progress.done.length, total: GUIDE_STEPS[progress.guide].length })} · {t(`kinds.${progress.guide}.title`)}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function BotLine({ text }: { text: string }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[0.6875rem] font-bold text-primary-foreground" aria-hidden>M</span>
      <p className="pt-0.5 text-[0.9375rem] leading-relaxed">{text}</p>
    </div>
  );
}

function RecommendationCard({ guide, reason, onStart, primary }: { guide: GuideId; reason: string; onStart: () => void; primary?: boolean }) {
  const t = useTranslations('guides');
  return (
    <div className={cn('space-y-2.5 rounded-[1.25rem] border p-4', primary ? 'border-primary bg-primary-50/50 dark:bg-primary/10' : 'border-border bg-background')}>
      {primary && <span className="inline-block rounded-full bg-primary px-2.5 py-0.5 text-[0.6875rem] font-bold text-primary-foreground">{t('chooser.recommended')}</span>}
      <p className="font-display text-xl font-extrabold">{t(`kinds.${guide}.name`)}</p>
      <p className="text-sm leading-relaxed text-foreground/80">{reason}</p>
      <p className="text-xs text-muted-foreground">{t('stepsCount', { count: GUIDE_STEPS[guide].length })}</p>
      <button
        type="button"
        onClick={onStart}
        className={cn('min-h-12 w-full rounded-2xl text-[0.9375rem] font-semibold', primary ? 'bg-primary text-primary-foreground' : 'border border-border hover:bg-muted')}
      >
        {t('startGuide')}
      </button>
    </div>
  );
}

/* ─────────────────────────── Steps ─────────────────────────── */

/** The guide's checklist: done steps folded, the next one open, any step tappable. */
export function GuideSteps({
  guide,
  progress,
  onBack,
  onChange,
  onSwitch,
  onAsk,
}: {
  guide: GuideId;
  progress: GuideProgressView | null;
  onBack: () => void;
  onChange: (p: GuideProgressView) => void;
  onSwitch: () => void;
  onAsk: (question: string) => void;
}) {
  const t = useTranslations('guides');
  const steps = stepsOf(guide);
  const done: StepId[] = progress?.guide === guide ? progress.done : [];
  const next = nextStep(guide, done);
  const [open, setOpen] = useState<StepId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const expanded = open ?? next;

  async function toggle(step: StepId) {
    if (saving) return;
    const nextDone = done.includes(step) ? done.filter((s) => s !== step) : [...done, step];
    setSaving(true);
    setError(false);
    const saved = await putProgress(guide, nextDone).catch(() => null);
    setSaving(false);
    if (!saved) { setError(true); return; }
    onChange(saved);
    setOpen(null);
  }

  return (
    <div className="pb-4">
      <ViewHeader title={t(`kinds.${guide}.card`)} sub={t('progressLong', { done: done.length, total: steps.length })} onBack={onBack}>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={done.length} aria-label={t('progress', { done: done.length, total: steps.length })}>
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(3, (done.length / steps.length) * 100)}%` }} />
        </div>
      </ViewHeader>

      {!next && (
        <div className="mb-3 rounded-[1.25rem] border border-primary bg-primary-50/50 p-4 dark:bg-primary/10">
          <p className="font-display text-base font-extrabold">{t('finishedTitle')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('finishedBody')}</p>
        </div>
      )}

      <ol className="space-y-2">
        {steps.map((s, i) => {
          const isDone = done.includes(s.id);
          const isOpen = expanded === s.id;
          const text = t.raw(`steps.${s.id}`) as { title: string; body: string; duration?: string };
          return (
            <li key={s.id} className={cn('rounded-[1.125rem] border bg-background', isOpen && !isDone ? 'border-primary' : 'border-border')}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? (s.id === next ? null : next) : s.id)}
                aria-expanded={isOpen}
                className="flex min-h-12 w-full items-center gap-3 px-3.5 py-2.5 text-start"
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    isDone ? 'bg-primary text-primary-foreground' : s.id === next ? 'border-2 border-primary text-primary' : 'bg-muted text-muted-foreground',
                  )}
                >
                  {isDone ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                </span>
                <span className={cn('min-w-0 flex-1 text-sm', isDone ? 'text-muted-foreground line-through' : 'font-semibold')}>{text.title}</span>
                {s.download && !isDone && <Download className="size-4 shrink-0 text-primary" aria-hidden />}
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform rtl:rotate-180', isOpen && 'rotate-90 rtl:rotate-90')} aria-hidden />
              </button>

              {isOpen && (
                <div className="space-y-3 px-3.5 pb-3.5">
                  <p className="text-sm leading-relaxed text-foreground/85">{text.body}</p>
                  {(s.links.length > 0 || text.duration) && (
                    <div className="flex flex-wrap gap-1.5">
                      {s.links.map((l) => (
                        <a
                          key={l.href}
                          href={l.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-blue-200 bg-blue-50/70 px-3 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
                        >
                          {l.label}<ExternalLink className="size-3" />
                        </a>
                      ))}
                      {text.duration && (
                        <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-3 text-xs text-muted-foreground">
                          <Clock className="size-3" />{t('duration', { value: text.duration })}
                        </span>
                      )}
                    </div>
                  )}
                  {s.download && (
                    <a
                      href={s.download.href}
                      download
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/40 text-sm font-semibold text-primary-700 hover:bg-primary-50"
                    >
                      <Download className="size-4" />{t('download', { label: s.download.label })}
                    </a>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void toggle(s.id)}
                      className={cn(
                        'min-h-11 rounded-xl text-sm font-semibold disabled:opacity-60',
                        isDone ? 'border border-border hover:bg-muted' : 'bg-primary text-primary-foreground',
                      )}
                    >
                      {isDone ? t('undo') : t('markDone')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAsk(t('askAbout', { step: text.title, guide: t(`kinds.${guide}.title`) }))}
                      className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-semibold hover:bg-muted"
                    >
                      <MessageCircleQuestion className="size-4" />{t('ask')}
                    </button>
                  </div>
                  {error && <p role="alert" className="text-xs text-destructive">{t('saveError')}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <button type="button" onClick={onSwitch} className="mx-auto mt-4 block min-h-11 text-sm font-medium text-muted-foreground hover:text-foreground">
        {t('switchGuide')}
      </button>
    </div>
  );
}
