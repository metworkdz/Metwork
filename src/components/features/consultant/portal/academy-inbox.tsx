'use client';

/**
 * Studio inbox: learners' questions on the mentor's courses (unanswered
 * first) and their reviews. The mentor answers a question in its lesson
 * thread, and replies to a review once, publicly.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { apiClient, ApiClientError } from '@/lib/api-client';
import { Stars } from '@/components/features/academy/stars';
import { BrandButton, EmptyBlock, ErrorBanner, GhostButton, SectionCard, SectionHeading, Spinner } from './shared';

interface InboxQuestion {
  id: string; courseId: string; courseTitle: string; lessonId: string; lessonTitle: string;
  author: string; body: string; createdAt: string; answers: number; answeredByMentor: boolean;
}
interface Post { id: string; author: string; authorKind: 'USER' | 'MENTOR' | 'ADMIN'; body: string }
interface Thread extends Post { answers: Post[] }
interface Review {
  id: string; courseTitle: string; author: string; rating: number; text: string | null; createdAt: string;
  reply: { mentorName: string; text: string } | null;
}

const MAX = 2000;

export function AcademyInbox() {
  const t = useTranslations('consultantPortal.academy.inbox');
  const locale = useLocale();
  const [tab, setTab] = useState<'questions' | 'reviews'>('questions');
  const [data, setData] = useState<{ questions: InboxQuestion[]; reviews: Review[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<InboxQuestion | null>(null);

  const load = useCallback(async () => {
    try { setData(await apiClient.get(`/consultant/academy/questions?locale=${locale}`)); setError(null); }
    catch { setError(t('loadError')); }
  }, [locale, t]);
  useEffect(() => { void load(); }, [load]);

  const unanswered = data?.questions.filter((q) => !q.answeredByMentor).length ?? 0;

  return (
    <SectionCard>
      <SectionHeading title={t('title')} subtitle={t('subtitle')} />
      <div role="tablist" className="mb-3 flex gap-2">
        <GhostButton tone="light" role="tab" aria-selected={tab === 'questions'} onClick={() => setTab('questions')} className={tab === 'questions' ? 'ring-2 ring-primary' : ''}>
          {t('questionsTab')}{unanswered > 0 && <span className="ms-1.5 rounded-full bg-amber-500 px-1.5 text-[11px] font-bold text-white">{unanswered}</span>}
        </GhostButton>
        <GhostButton tone="light" role="tab" aria-selected={tab === 'reviews'} onClick={() => setTab('reviews')} className={tab === 'reviews' ? 'ring-2 ring-primary' : ''}>
          {t('reviewsTab')}
        </GhostButton>
      </div>
      {error && <ErrorBanner tone="light" message={error} />}
      {!data ? (
        <div className="flex justify-center py-6"><Spinner tone="dark" /></div>
      ) : tab === 'questions' ? (
        open ? <ThreadView q={open} onBack={() => { setOpen(null); void load(); }} /> : data.questions.length === 0 ? (
          <EmptyBlock>{t('noQuestions')}</EmptyBlock>
        ) : (
          <ul className="divide-y divide-border">
            {data.questions.map((q) => (
              <li key={q.id}>
                <button type="button" onClick={() => setOpen(q)} className="w-full py-3 text-start hover:bg-muted/40">
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {!q.answeredByMentor && <Badge variant="outline" className="border-amber-300 text-amber-800">{t('toAnswer')}</Badge>}
                    <span className="truncate">{q.courseTitle} · {q.lessonTitle}</span>
                  </p>
                  <p dir="auto" className="mt-1 line-clamp-2 text-sm"><span className="font-semibold">{q.author} : </span>{q.body}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t('answers', { count: q.answers })}</p>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : data.reviews.length === 0 ? (
        <EmptyBlock>{t('noReviews')}</EmptyBlock>
      ) : (
        <ul className="divide-y divide-border">
          {data.reviews.map((r) => <ReviewRow key={r.id} review={r} onDone={load} />)}
        </ul>
      )}
    </SectionCard>
  );
}

function ThreadView({ q, onBack }: { q: InboxQuestion; onBack(): void }) {
  const t = useTranslations('consultantPortal.academy.inbox');
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ questions: Thread[] }>(`/consultant/academy/lessons/${q.courseId}/${q.lessonId}`);
      setThread(res.questions.find((x) => x.id === q.id) ?? null);
    } catch { setError(t('loadError')); }
  }, [q, t]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/consultant/academy/questions', { courseId: q.courseId, lessonId: q.lessonId, parentId: q.id, body: text.trim() });
      setText('');
      await load();
    } catch (err) { setError(err instanceof ApiClientError && err.code === 'RATE_LIMITED' ? t('rateLimited') : t('sendError')); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <GhostButton tone="light" onClick={onBack}>{t('back')}</GhostButton>
      <p className="text-xs text-muted-foreground">{q.courseTitle} · {q.lessonTitle}</p>
      {!thread ? <Spinner tone="dark" /> : (
        <>
          <div className="rounded-lg border border-border p-3 text-sm"><p dir="auto" className="font-semibold">{thread.author}</p><p dir="auto" className="mt-1 whitespace-pre-line">{thread.body}</p></div>
          {thread.answers.map((a) => (
            <div key={a.id} className="ms-4 border-s-2 border-border ps-3 text-sm">
              <p className="font-semibold">{a.author}{a.authorKind === 'MENTOR' && <span className="ms-1.5 text-xs text-primary">({t('you')})</span>}</p>
              <p dir="auto" className="mt-0.5 whitespace-pre-line">{a.body}</p>
            </div>
          ))}
        </>
      )}
      <Textarea value={text} maxLength={MAX} rows={3} placeholder={t('answerPlaceholder')} onChange={(e) => setText(e.target.value)} className="text-base sm:text-sm" />
      {error && <ErrorBanner tone="light" message={error} />}
      <BrandButton tone="light" loading={busy} disabled={!text.trim()} onClick={send}>{t('send')}</BrandButton>
    </div>
  );
}

function ReviewRow({ review, onDone }: { review: Review; onDone(): void }) {
  const t = useTranslations('consultantPortal.academy.inbox');
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post(`/consultant/academy/reviews/${review.id}/reply`, { text: text.trim() });
      setReplying(false);
      onDone();
    } catch (err) { setError(err instanceof ApiClientError && err.code === 'ALREADY_REPLIED' ? t('alreadyReplied') : t('sendError')); }
    finally { setBusy(false); }
  }

  return (
    <li className="space-y-2 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-2"><span dir="auto" className="font-semibold">{review.author}</span><Stars value={review.rating} label={t('stars', { n: review.rating })} /></p>
      <p className="text-xs text-muted-foreground">{review.courseTitle}</p>
      {review.text && <p dir="auto" className="whitespace-pre-line">{review.text}</p>}
      {review.reply ? (
        <p dir="auto" className="ms-4 border-s-2 border-primary/40 ps-3 text-muted-foreground">{review.reply.text}</p>
      ) : replying ? (
        <div className="space-y-2">
          <Textarea value={text} maxLength={1500} rows={3} placeholder={t('replyPlaceholder')} onChange={(e) => setText(e.target.value)} className="text-base sm:text-sm" />
          <p className="text-xs text-muted-foreground">{t('replyOnce')}</p>
          {error && <ErrorBanner tone="light" message={error} />}
          <div className="flex gap-2">
            <BrandButton tone="light" loading={busy} disabled={!text.trim()} onClick={send}>{t('publishReply')}</BrandButton>
            <GhostButton tone="light" onClick={() => setReplying(false)}>{t('cancel')}</GhostButton>
          </div>
        </div>
      ) : (
        <GhostButton tone="light" onClick={() => setReplying(true)}>{t('reply')}</GhostButton>
      )}
    </li>
  );
}
