'use client';

/**
 * « Questions » — the host edits the feedback form: title, an optional
 * introduction, the questions (stars 0–5 or free text), and whether the form
 * is open and has a shared link.
 *
 * A question keeps its id through renames and moves, so its answers stay
 * attached; a new one is sent without an id and the server gives it one.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, MessageSquareText, Plus, RotateCcw, Star, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { defaultFeedbackQuestions, FEEDBACK_LIMITS, type FeedbackLang, type FeedbackQuestionKind } from '@/server/feedback/types';

import { errorMessage } from './shared';

export interface EditableQuestion {
  /** Null for a question not saved yet. */
  id: string | null;
  /** Stable React key, saved or not. */
  key: string;
  kind: FeedbackQuestionKind;
  label: string;
  required: boolean;
}

export interface FormState {
  title: string;
  intro: string;
  isOpen: boolean;
  sharedLinkEnabled: boolean;
  questions: EditableQuestion[];
}

let keySeq = 0;
const nextKey = () => `k${++keySeq}`;

export function toEditable(questions: Array<{ id: string | null; kind: FeedbackQuestionKind; label: string; required: boolean }>): EditableQuestion[] {
  return questions.map((q) => ({ ...q, key: nextKey() }));
}

interface Props {
  base: string;
  initial: FormState;
  saved: boolean;
  hasResponses: boolean;
  /** The form was just saved — the editor remounts with it, so say so here. */
  justSaved?: boolean;
  onSaved: () => void;
}

export function FeedbackEditor({ base, initial, saved, hasResponses, justSaved, onSaved }: Props) {
  const t = useTranslations('feedback');
  const locale = useLocale();
  const [state, setState] = useState<FormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(justSaved ? t('saved') : null);

  const update = (patch: Partial<FormState>) => { setState((s) => ({ ...s, ...patch })); setNotice(null); };
  const setQuestion = (key: string, patch: Partial<EditableQuestion>) =>
    update({ questions: state.questions.map((q) => (q.key === key ? { ...q, ...patch } : q)) });
  const move = (from: number, to: number) => {
    if (to < 0 || to >= state.questions.length) return;
    const next = state.questions.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    update({ questions: next });
  };
  const add = (kind: FeedbackQuestionKind) => update({
    questions: [...state.questions, { id: null, key: nextKey(), kind, label: '', required: false }],
  });
  const resetDefaults = () => {
    if (!window.confirm(t('resetConfirm'))) return;
    const lang = (['fr', 'en', 'ar'].includes(locale) ? locale : 'fr') as FeedbackLang;
    update({ questions: toEditable(defaultFeedbackQuestions(lang, () => '').map((q) => ({ ...q, id: null }))) });
  };

  const canAdd = state.questions.length < FEEDBACK_LIMITS.questions;

  async function save() {
    setError(null);
    setNotice(null);
    if (!state.title.trim()) { setError(t('errorTitle')); return; }
    if (state.questions.length === 0) { setError(t('errorNoQuestion')); return; }
    if (state.questions.some((q) => !q.label.trim())) { setError(t('errorEmptyQuestion')); return; }
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: state.title,
          intro: state.intro || null,
          isOpen: state.isOpen,
          sharedLinkEnabled: state.sharedLinkEnabled,
          questions: state.questions.map(({ id, kind, label, required }) => ({ id, kind, label, required })),
        }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, t('saveFailed')));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {!saved && <p className="rounded-lg bg-primary/10 px-3 py-2.5 text-sm">{t('draftHint')}</p>}
      {hasResponses && <p className="rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">{t('hasResponsesHint')}</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="fb-title">{t('formTitle')}</Label>
          <Input id="fb-title" className="mt-1" value={state.title} maxLength={FEEDBACK_LIMITS.title}
            onChange={(e) => update({ title: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="fb-intro">{t('formIntro')}</Label>
          <textarea
            id="fb-intro" rows={2} maxLength={FEEDBACK_LIMITS.intro} value={state.intro}
            onChange={(e) => update({ intro: e.target.value })} placeholder={t('formIntroPlaceholder')}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <ol className="space-y-2" aria-label={t('questions')}>
        {state.questions.map((q, i) => (
          <li key={q.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5 rounded-lg border border-border bg-background p-3">
            <span className="mt-2 flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground" title={q.kind === 'RATING' ? t('kindRating') : t('kindText')}>
              {q.kind === 'RATING' ? <Star className="size-3.5" /> : <MessageSquareText className="size-3.5" />}
            </span>
            <div className="min-w-0 space-y-1.5">
              <Input
                value={q.label} maxLength={FEEDBACK_LIMITS.label} dir="auto"
                aria-label={t('questionLabel', { n: i + 1 })}
                placeholder={q.kind === 'RATING' ? t('placeholderRating') : t('placeholderText')}
                onChange={(e) => setQuestion(q.key, { label: e.target.value })}
              />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{q.kind === 'RATING' ? t('kindRating') : t('kindText')}</span>
                <label className="inline-flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox" className="size-3.5 accent-primary" checked={q.required}
                    aria-label={t('requiredFor', { n: i + 1 })}
                    onChange={(e) => setQuestion(q.key, { required: e.target.checked })}
                  />
                  {t('required')}
                </label>
              </div>
            </div>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === 0}
                onClick={() => move(i, i - 1)} aria-label={t('moveUp', { n: i + 1 })}>
                <ArrowUp className="size-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-8" disabled={i === state.questions.length - 1}
                onClick={() => move(i, i + 1)} aria-label={t('moveDown', { n: i + 1 })}>
                <ArrowDown className="size-3.5" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:text-destructive"
                onClick={() => update({ questions: state.questions.filter((x) => x.key !== q.key) })}
                aria-label={t('remove', { n: i + 1 })}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={() => add('RATING')}>
          <Plus className="size-3.5" /> {t('addRating')}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!canAdd} onClick={() => add('TEXT')}>
          <Plus className="size-3.5" /> {t('addText')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={resetDefaults}>
          <RotateCcw className="size-3.5" /> {t('resetDefaults')}
        </Button>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={state.isOpen}
            aria-label={t('openLabel')} onChange={(e) => update({ isOpen: e.target.checked })} />
          <span><span className="font-medium">{t('openLabel')}</span><span className="block text-xs text-muted-foreground">{t('openHint')}</span></span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={state.sharedLinkEnabled}
            aria-label={t('sharedLabel')} onChange={(e) => update({ sharedLinkEnabled: e.target.checked })} />
          <span><span className="font-medium">{t('sharedLabel')}</span><span className="block text-xs text-muted-foreground">{t('sharedHint')}</span></span>
        </label>
      </div>

      {error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary">{notice}</p>}
      <div className="flex justify-end">
        <Button onClick={() => void save()} loading={saving}>{t('save')}</Button>
      </div>
    </div>
  );
}
