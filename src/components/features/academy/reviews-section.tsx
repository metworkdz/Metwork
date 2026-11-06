'use client';

/**
 * Course reviews: the visible list, and the signed-in learner's own review
 * (stars + text) when they may write one — learners who watched a quarter of
 * the course. Loaded client-side so the course page stays cacheable.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Stars } from './stars';

interface Review {
  id: string;
  author: string;
  rating: number;
  text: string | null;
  createdAt: string;
  reply: { mentorName: string; text: string; at: string } | null;
}
interface Eligibility { canReview: boolean; reason: 'NOT_LEARNER' | 'WATCH_MORE' | null; mine: { rating: number; text: string | null } | null }

const TEXT_MAX = 2000;

export function ReviewsSection({ courseId, average: cachedAverage, count: cachedCount }: { courseId: string; average: number | null; count: number }) {
  let average = cachedAverage;
  let count = cachedCount;
  const t = useTranslations('academy.learning.reviews');
  const locale = useLocale();
  const [data, setData] = useState<{ reviews: Review[]; eligibility: Eligibility | null } | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ reviews: Review[]; eligibility: Eligibility | null }>(`/academy/reviews/${courseId}`);
      setData(res);
      if (res.eligibility?.mine) { setRating(res.eligibility.mine.rating); setText(res.eligibility.mine.text ?? ''); }
    } catch { setData({ reviews: [], eligibility: null }); }
  }, [courseId]);
  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (rating < 1) return;
    setBusy(true);
    setMsg(null);
    try {
      await apiClient.post(`/academy/reviews/${courseId}`, { rating, text: text.trim() || null });
      setEditing(false);
      setMsg(t('saved'));
      await load();
    } catch { setMsg(t('error')); }
    finally { setBusy(false); }
  }

  const date = (iso: string) => new Intl.DateTimeFormat(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
  // The page's numbers are cached for a minute; the loaded list is fresh (it holds up to 50 reviews).
  if (data && data.reviews.length < 50) {
    count = data.reviews.length;
    average = count ? Math.round((data.reviews.reduce((n, r) => n + r.rating, 0) / count) * 10) / 10 : null;
  }
  const elig = data?.eligibility;
  const showForm = elig?.canReview && (editing || !elig.mine);

  return (
    <section id="reviews" className="scroll-mt-24">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl font-extrabold">{t('title')}</h2>
        {count > 0 && average !== null && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Stars value={average} label={t('average', { average })} />
            {t('summary', { average, count })}
          </p>
        )}
      </div>

      {elig?.canReview && elig.mine && !editing && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
          <span className="flex items-center gap-2">{t('yours')} <Stars value={elig.mine.rating} label={t('stars', { n: elig.mine.rating })} /></span>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>{t('edit')}</Button>
        </div>
      )}

      {showForm && (
        <div className="mt-4 space-y-3 rounded-2xl border border-border p-4">
          <p className="text-sm font-semibold">{t('formTitle')}</p>
          <div className="flex gap-1" role="radiogroup" aria-label={t('ratingLabel')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={t('stars', { n })}
                onClick={() => setRating(n)} className="rounded p-1.5 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30">
                <Star className={cn('size-7', n <= rating ? 'fill-current' : 'fill-transparent text-muted-foreground/50')} aria-hidden />
              </button>
            ))}
          </div>
          <Textarea value={text} maxLength={TEXT_MAX} rows={3} placeholder={t('placeholder')} onChange={(e) => setText(e.target.value)} className="text-base sm:text-sm" />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || rating < 1} onClick={save}>{busy && <Loader2 className="me-1 size-4 animate-spin" />}{t('publish')}</Button>
            {editing && <Button variant="ghost" onClick={() => setEditing(false)}>{t('cancel')}</Button>}
          </div>
        </div>
      )}
      {elig && !elig.canReview && elig.reason === 'WATCH_MORE' && <p className="mt-3 text-sm text-muted-foreground">{t('watchMore')}</p>}
      {msg && <p className="mt-2 text-sm text-muted-foreground" role="status">{msg}</p>}

      {!data ? (
        <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label={t('loading')} /></div>
      ) : data.reviews.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {data.reviews.map((r) => (
            <li key={r.id} className="py-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span dir="auto" className="font-semibold">{r.author}</span>
                <Stars value={r.rating} label={t('stars', { n: r.rating })} />
                <span className="text-xs text-muted-foreground">{date(r.createdAt)}</span>
              </div>
              {r.text && <p dir="auto" className="mt-2 whitespace-pre-line text-pretty text-sm leading-relaxed">{r.text}</p>}
              {r.reply && (
                <div className="ms-4 mt-3 border-s-2 border-primary/40 ps-3 text-sm">
                  <p className="font-semibold text-primary">{t('reply', { name: r.reply.mentorName })}</p>
                  <p dir="auto" className="mt-1 whitespace-pre-line text-muted-foreground">{r.reply.text}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
