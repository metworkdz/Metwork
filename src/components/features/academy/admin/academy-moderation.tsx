'use client';

/**
 * Admin moderation of the Academy's learner content: hide or show a review or
 * a question (reviews go live at once — owner decision), and revoke or
 * restore a certificate (its number never changes).
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Stars } from '../stars';

interface Review { id: string; courseTitle: string; author: string; rating: number; text: string | null; createdAt: string; hidden: boolean }
interface Question { id: string; courseTitle: string; lessonTitle: string; author: string; body: string; createdAt: string; answers: number; hidden: boolean }
interface Certificate { id: string; number: string; fullName: string; courseTitle: string; issuedAt: string; revoked: boolean }
interface Data { reviews: Review[]; questions: Question[]; certificates: Certificate[] }

export function AcademyModeration() {
  const t = useTranslations('academyAdmin.moderation');
  const locale = useLocale();
  const [tab, setTab] = useState<'reviews' | 'questions' | 'certificates'>('reviews');
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setData(await apiClient.get<Data>(`/admin/academy/moderation?locale=${locale}`)); setError(null); }
    catch { setError(t('loadError')); }
  }, [locale, t]);
  useEffect(() => { void load(); }, [load]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    try { await fn(); await load(); } catch { setError(t('actionError')); } finally { setBusy(null); }
  }
  const hide = (kind: 'REVIEW' | 'POST', id: string, hidden: boolean) => act(id, () => apiClient.post('/admin/academy/moderation', { kind, id, hidden }));
  const revoke = (id: string, revoked: boolean) => act(id, () => apiClient.patch(`/admin/academy/certificates/${id}`, { revoked }));
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-DZ' : locale === 'en' ? 'en-GB' : 'fr-DZ', { day: 'numeric', month: 'short', year: 'numeric' });

  const tabs = [
    { id: 'reviews' as const, label: t('reviews', { count: data?.reviews.length ?? 0 }) },
    { id: 'questions' as const, label: t('questions', { count: data?.questions.length ?? 0 }) },
    { id: 'certificates' as const, label: t('certificates', { count: data?.certificates.length ?? 0 }) },
  ];

  const toggle = (id: string, hidden: boolean, onClick: () => void, labels: [string, string]) => (
    <Button size="sm" variant={hidden ? 'outline' : 'ghost'} disabled={busy === id} onClick={onClick} className="shrink-0">
      {busy === id && <Loader2 className="me-1 size-3.5 animate-spin" />}{hidden ? labels[1] : labels[0]}
    </Button>
  );

  return (
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-display text-base font-extrabold">{t('title')}</h2>
      <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      <div role="tablist" className="mt-3 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-semibold', tab === x.id ? 'border-primary' : 'border-transparent text-muted-foreground')}>{x.label}</button>
        ))}
      </div>
      {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
      {!data ? (
        <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <ul className="divide-y divide-border">
          {tab === 'reviews' && (data.reviews.length ? data.reviews.map((r) => (
            <li key={r.id} className={cn('flex items-start gap-3 py-3 text-sm', r.hidden && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2"><span dir="auto" className="font-semibold">{r.author}</span><Stars value={r.rating} label={t('stars', { n: r.rating })} /><span className="text-xs text-muted-foreground">{day(r.createdAt)}</span></p>
                <p className="text-xs text-muted-foreground">{r.courseTitle}{r.hidden && ` · ${t('hidden')}`}</p>
                {r.text && <p dir="auto" className="mt-1 whitespace-pre-line">{r.text}</p>}
              </div>
              {toggle(r.id, r.hidden, () => void hide('REVIEW', r.id, !r.hidden), [t('hide'), t('show')])}
            </li>
          )) : <li className="py-4 text-sm text-muted-foreground">{t('empty')}</li>)}
          {tab === 'questions' && (data.questions.length ? data.questions.map((q) => (
            <li key={q.id} className={cn('flex items-start gap-3 py-3 text-sm', q.hidden && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{q.courseTitle} · {q.lessonTitle} · {day(q.createdAt)}{q.hidden && ` · ${t('hidden')}`}</p>
                <p dir="auto" className="mt-1"><span className="font-semibold">{q.author} : </span><span className="whitespace-pre-line">{q.body}</span></p>
                <p className="text-xs text-muted-foreground">{t('answers', { count: q.answers })}</p>
              </div>
              {toggle(q.id, q.hidden, () => void hide('POST', q.id, !q.hidden), [t('hide'), t('show')])}
            </li>
          )) : <li className="py-4 text-sm text-muted-foreground">{t('empty')}</li>)}
          {tab === 'certificates' && (data.certificates.length ? data.certificates.map((c) => (
            <li key={c.id} className={cn('flex items-start gap-3 py-3 text-sm', c.revoked && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p dir="auto" className="font-semibold">{c.fullName}</p>
                <p className="text-xs text-muted-foreground"><span dir="ltr">{c.number}</span> · {c.courseTitle} · {day(c.issuedAt)}{c.revoked && ` · ${t('revoked')}`}</p>
              </div>
              {toggle(c.id, c.revoked, () => void revoke(c.id, !c.revoked), [t('revoke'), t('restore')])}
            </li>
          )) : <li className="py-4 text-sm text-muted-foreground">{t('empty')}</li>)}
        </ul>
      )}
    </section>
  );
}
