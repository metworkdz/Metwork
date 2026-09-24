'use client';

/**
 * « Résumé des réponses » — how the confirmed participants answered each
 * multiple-choice question, counted on the server (answers given in any of
 * the three languages fold into one option). Sits above the registrations
 * table; free-text answers stay in the table.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart3, ChevronDown, ChevronUp } from 'lucide-react';

import { questionLabel, questionOptions } from '@/lib/registration-question';
import type { AnswerSummary } from '@/server/registrations/answer-summary';

interface Props {
  entityType: 'PROGRAM' | 'EVENT';
  entityId: string;
  endpoint: '/api/incubator/registrations' | '/api/consultant/registrations';
  /** Bumped by the table whenever its data changes, so the counts follow. */
  version: number;
}

export function AnswerSummaryPanel({ entityType, entityId, endpoint, version }: Props) {
  const t = useTranslations('answerSummary');
  const tq = useTranslations('defaultQuestions');
  const [summary, setSummary] = useState<AnswerSummary | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ entityType, entityId, view: 'summary' });
        const res = await fetch(`${endpoint}?${params}`, { credentials: 'include', signal: controller.signal });
        if (!res.ok) return;
        setSummary(await res.json() as AnswerSummary);
      } catch { /* the table still shows every answer */ }
    })();
    return () => controller.abort();
  }, [entityType, entityId, endpoint, version]);

  const questions = summary?.questions.filter((q) => q.answered > 0) ?? [];
  if (!summary || questions.length === 0) return null;

  const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="size-4 text-primary" aria-hidden />
          {t('title')}
          <span className="font-normal text-muted-foreground">· {t('base', { count: summary.confirmed })}</span>
        </span>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="grid gap-5 border-t border-border px-4 py-4 lg:grid-cols-2">
          {questions.map((q) => {
            const options = questionOptions(q, (k) => tq(k)) ?? q.options;
            const multi = q.type === 'CHECKBOX';
            const rows = options
              .map((label, i) => ({ label, count: q.counts[i] ?? 0 }))
              .sort((a, b) => b.count - a.count);
            return (
              <div key={q.fieldId} className="space-y-2">
                <div>
                  <p className="text-sm font-medium">{questionLabel(q, (k) => tq(k))}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('answered', { count: q.answered })}
                    {multi && <> · {t('multi')}</>}
                  </p>
                </div>
                <ul className="space-y-1.5" aria-label={questionLabel(q, (k) => tq(k))}>
                  {rows.map((r) => (
                    <li key={r.label} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                      <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${pct(r.count, q.answered)}%` }} />
                      </span>
                      <span className="whitespace-nowrap text-end tabular-nums" dir="ltr">
                        {r.count} · {pct(r.count, q.answered)} %
                      </span>
                    </li>
                  ))}
                  {q.other > 0 && (
                    <li className="text-xs text-muted-foreground">{t('other', { count: q.other })}</li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
