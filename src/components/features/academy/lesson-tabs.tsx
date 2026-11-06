'use client';

/**
 * Under the video: the lesson's Q&A (shared with the course's learners) and
 * the learner's private notes, each pinned to a moment of the video.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, MessageSquare, NotebookPen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { playerBus } from './player-bus';

interface Post { id: string; author: string; authorKind: 'USER' | 'MENTOR' | 'ADMIN'; mine: boolean; body: string; createdAt: string; hidden: boolean }
interface Question extends Post { answers: Post[] }
interface Note { id: string; lessonId: string; positionSec: number; body: string; createdAt: string }

const MAX = 2000;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function LessonTabs({ courseId, lessonId, canDiscuss, initialTab }: { courseId: string; lessonId: string; canDiscuss: boolean; initialTab?: 'qa' | 'notes' }) {
  const t = useTranslations('academy.learning');
  const [tab, setTab] = useState<'qa' | 'notes'>(canDiscuss ? (initialTab ?? 'qa') : 'notes');
  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-border">
        {canDiscuss && <TabButton active={tab === 'qa'} onClick={() => setTab('qa')} icon={<MessageSquare className="size-4" aria-hidden />}>{t('qa.tab')}</TabButton>}
        <TabButton active={tab === 'notes'} onClick={() => setTab('notes')} icon={<NotebookPen className="size-4" aria-hidden />}>{t('notes.tab')}</TabButton>
      </div>
      <div className="pt-4">
        {tab === 'qa' && canDiscuss ? <QaPanel courseId={courseId} lessonId={lessonId} /> : <NotesPanel courseId={courseId} lessonId={lessonId} />}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick(): void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick}
      className={cn('-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold', active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
      {icon}{children}
    </button>
  );
}

function errorText(err: unknown, t: (k: string) => string): string {
  return err instanceof ApiClientError && err.code === 'RATE_LIMITED' ? t('errors.RATE_LIMITED') : t('errors.generic');
}

function QaPanel({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const t = useTranslations('academy.learning');
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [draft, setDraft] = useState('');
  const [answerFor, setAnswerFor] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/academy/learn/${courseId}/lessons/${lessonId}/questions`;

  const load = useCallback(async () => {
    try { setQuestions((await apiClient.get<{ questions: Question[] }>(base)).questions); }
    catch { setQuestions([]); setError(t('errors.generic')); }
  }, [base, t]);
  useEffect(() => { void load(); }, [load]);

  async function send(body: string, parentId: string | null) {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(base, { body, parentId });
      if (parentId) { setAnswer(''); setAnswerFor(null); } else setDraft('');
      await load();
    } catch (err) { setError(errorText(err, t)); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea value={draft} maxLength={MAX} rows={2} placeholder={t('qa.askPlaceholder')} onChange={(e) => setDraft(e.target.value)} className="text-base sm:text-sm" />
        <Button size="sm" disabled={busy || !draft.trim()} onClick={() => send(draft.trim(), null)}>{t('qa.ask')}</Button>
        <p className="text-xs text-muted-foreground">{t('qa.publicHint')}</p>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {!questions ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
      ) : questions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('qa.empty')}</p>
      ) : (
        <ul className="space-y-4">
          {questions.map((q) => (
            <li key={q.id} className="rounded-xl border border-border p-3">
              <PostLine post={q} />
              {q.answers.length > 0 && (
                <ul className="ms-3 mt-3 space-y-3 border-s border-border ps-3">
                  {q.answers.map((a) => <li key={a.id}><PostLine post={a} /></li>)}
                </ul>
              )}
              {answerFor === q.id ? (
                <div className="mt-3 space-y-2">
                  <Textarea value={answer} maxLength={MAX} rows={2} placeholder={t('qa.answerPlaceholder')} onChange={(e) => setAnswer(e.target.value)} className="text-base sm:text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy || !answer.trim()} onClick={() => send(answer.trim(), q.id)}>{t('qa.send')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setAnswerFor(null)}>{t('cancel')}</Button>
                  </div>
                </div>
              ) : (
                <button type="button" className="mt-2 text-xs font-semibold text-primary hover:underline" onClick={() => { setAnswerFor(q.id); setAnswer(''); }}>{t('qa.answer')}</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PostLine({ post }: { post: Post }) {
  const t = useTranslations('academy.learning.qa');
  return (
    <div className={cn(post.hidden && 'opacity-60')}>
      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span dir="auto" className="font-semibold text-foreground">{post.author}</span>
        {post.authorKind === 'MENTOR' && <span className="rounded-full bg-primary/10 px-2 py-0.5 font-bold text-primary">{t('mentor')}</span>}
        {post.authorKind === 'ADMIN' && <span className="rounded-full bg-muted px-2 py-0.5 font-bold">{t('team')}</span>}
        {post.hidden && <span>{t('hidden')}</span>}
      </p>
      <p dir="auto" className="mt-1 whitespace-pre-line text-pretty text-sm">{post.body}</p>
    </div>
  );
}

function NotesPanel({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const t = useTranslations('academy.learning');
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/academy/learn/${courseId}/notes`;

  const load = useCallback(async () => {
    try { setNotes((await apiClient.get<{ notes: Note[] }>(base)).notes.filter((n) => n.lessonId === lessonId)); }
    catch { setNotes([]); setError(t('errors.generic')); }
  }, [base, lessonId, t]);
  useEffect(() => { void load(); }, [load]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(base, { lessonId, positionSec: playerBus.position(), body: draft.trim() });
      setDraft('');
      await load();
    } catch (err) { setError(errorText(err, t)); }
    finally { setBusy(false); }
  }

  async function remove(id: string) {
    try { await apiClient.delete(`${base}/${id}`); await load(); } catch { setError(t('errors.generic')); }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea value={draft} maxLength={MAX} rows={2} placeholder={t('notes.placeholder')} onChange={(e) => setDraft(e.target.value)} className="text-base sm:text-sm" />
        <Button size="sm" disabled={busy || !draft.trim()} onClick={add}>{t('notes.add')}</Button>
        <p className="text-xs text-muted-foreground">{t('notes.privateHint')}</p>
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      {!notes ? (
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" aria-label={t('loading')} />
      ) : notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('notes.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
              <button type="button" dir="ltr" onClick={() => playerBus.seek(n.positionSec)} aria-label={t('notes.jump', { time: clock(n.positionSec) })}
                className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary hover:bg-primary/20">{clock(n.positionSec)}</button>
              <p dir="auto" className="min-w-0 flex-1 whitespace-pre-line text-sm">{n.body}</p>
              <button type="button" onClick={() => remove(n.id)} aria-label={t('notes.delete')} className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
